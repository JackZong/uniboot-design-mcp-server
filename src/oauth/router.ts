import type { Request, Response, Router } from 'express'
import express from 'express'
import { randomToken } from './pkce.js'
import { verifyS256 } from './pkce.js'
import { isAllowedRedirectUri, redirectUrisMatch } from './redirects.js'
import {
  authorizationServerMetadata,
  getIssuer,
  protectedResourceMetadata,
} from './metadata.js'
import { renderConsentPage } from './consent.js'
import { createMcpPat, listTeams, loginWithPassword } from './api-login.js'
import { DEFAULT_SCOPES, parseScopes, formatScopes, type ScopeId } from './scopes.js'
import { oauthStore, type OAuthClient } from './store.js'

const SESSION_COOKIE = 'ubd_oauth_session'

export function createOAuthRouter(): Router {
  const router = express.Router()
  router.use(express.urlencoded({ extended: false }))
  router.use(express.json())

  const cors: express.RequestHandler = (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    next()
  }
  router.use(cors)
  router.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
    next()
  })

  const sendAs = (_req: Request, res: Response) => {
    res.json(authorizationServerMetadata())
  }
  const sendPr = (_req: Request, res: Response) => {
    res.json(protectedResourceMetadata())
  }

  router.get('/.well-known/oauth-authorization-server', sendAs)
  router.get('/.well-known/oauth-authorization-server/mcp', sendAs)
  router.get('/.well-known/openid-configuration', sendAs)
  router.get('/.well-known/openid-configuration/mcp', sendAs)
  router.get('/.well-known/oauth-protected-resource', sendPr)
  router.get('/.well-known/oauth-protected-resource/mcp', sendPr)

  router.post('/register', async (req, res) => {
    try {
      const body = req.body ?? {}
      const redirectUris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : []
      if (!redirectUris.length) {
        res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris required' })
        return
      }
      if (!redirectUris.every(isAllowedRedirectUri)) {
        res.status(400).json({
          error: 'invalid_redirect_uri',
          error_description: 'Only loopback and official AI client callback URIs are allowed',
        })
        return
      }
      const client: OAuthClient = {
        client_id: randomToken(16),
        client_name: String(body.client_name || 'Cursor'),
        redirect_uris: redirectUris,
        token_endpoint_auth_method: 'none',
        createdAt: Date.now(),
      }
      oauthStore.putClient(client)
      res.status(201).json({
        client_id: client.client_id,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        client_id_issued_at: Math.floor(client.createdAt / 1000),
      })
    } catch (err) {
      console.error('DCR error', err)
      res.status(500).json({ error: 'server_error' })
    }
  })

  router.get('/authorize', async (req, res) => {
    const query = pickQuery(req)
    const error = await validateAuthorizeRequest(query)
    if (error) {
      if (query.redirect_uri && isAllowedRedirectUri(query.redirect_uri) && error.redirect) {
        res.redirect(buildRedirect(query.redirect_uri, {
          error: error.code,
          error_description: error.description,
          state: query.state,
          iss: getIssuer(),
        }))
        return
      }
      res.status(400).type('html').send(renderConsentPage({
        clientName: 'Cursor',
        redirectUri: query.redirect_uri || '',
        query,
        scopes: parseScopes(query.scope),
        error: error.description,
      }))
      return
    }
    const client = await resolveClient(query.client_id)
    const session = oauthStore.getSession(readCookie(req, SESSION_COOKIE))
    res.type('html').send(renderConsentPage({
      clientName: client?.client_name || 'Cursor',
      redirectUri: query.redirect_uri,
      query,
      user: session ? { name: session.name, email: session.email } : null,
      teams: session?.teams,
      scopes: parseScopes(query.scope),
    }))
  })

  router.post('/authorize', async (req, res) => {
    const body = pickQuery(req)
    const error = await validateAuthorizeRequest(body)
    if (error) {
      res.status(400).type('html').send(renderConsentPage({
        clientName: 'Cursor',
        redirectUri: body.redirect_uri || '',
        query: body,
        scopes: parseScopes(body.scope),
        error: error.description,
      }))
      return
    }

    let session = oauthStore.getSession(readCookie(req, SESSION_COOKIE))
    if (!session) {
      const email = String(req.body?.email ?? '').trim()
      const password = String(req.body?.password ?? '')
      if (!email || !password) {
        res.status(401).type('html').send(renderConsentPage({
          clientName: (await resolveClient(body.client_id))?.client_name || 'Cursor',
          redirectUri: body.redirect_uri,
          query: body,
          scopes: parseScopes(body.scope),
          error: '请输入邮箱和密码',
        }))
        return
      }
      try {
        const login = await loginWithPassword(email, password)
        const teams = await listTeams(login.accessToken)
        session = oauthStore.createSession({
          accessToken: login.accessToken,
          userId: login.user.id,
          email: login.user.email,
          name: login.user.name,
          teams,
        })
        setCookie(res, SESSION_COOKIE, session.id)
        res.type('html').send(renderConsentPage({
          clientName: (await resolveClient(body.client_id))?.client_name || 'Cursor',
          redirectUri: body.redirect_uri,
          query: body,
          user: { name: session.name, email: session.email },
          teams: session.teams,
          scopes: parseScopes(body.scope),
        }))
        return
      } catch (err) {
        const message = err instanceof Error ? err.message : '登录失败'
        res.status(401).type('html').send(renderConsentPage({
          clientName: (await resolveClient(body.client_id))?.client_name || 'Cursor',
          redirectUri: body.redirect_uri,
          query: body,
          scopes: parseScopes(body.scope),
          error: message,
        }))
        return
      }
    }

    const selectedScopes = parsePostedScopes(req.body)
    const teamId = String(req.body?.teamId || session.teams[0]?.id || '')
    const team = session.teams.find((t) => t.id === teamId) ?? session.teams[0]
    if (!team) {
      res.status(400).type('html').send(renderConsentPage({
        clientName: (await resolveClient(body.client_id))?.client_name || 'Cursor',
        redirectUri: body.redirect_uri,
        query: body,
        user: { name: session.name, email: session.email },
        teams: session.teams,
        scopes: selectedScopes,
        error: '当前账号没有可授权的团队',
      }))
      return
    }

    try {
      const client = await resolveClient(body.client_id)
      const pat = await createMcpPat(session.accessToken, client?.client_name || 'Cursor')
      const code = oauthStore.createCode({
        clientId: body.client_id,
        redirectUri: body.redirect_uri,
        codeChallenge: body.code_challenge,
        scopes: selectedScopes,
        resource: body.resource,
        userId: session.userId,
        email: session.email,
        name: session.name,
        teamId: team.id,
        teamName: team.name,
        pat,
      })
      res.redirect(buildRedirect(body.redirect_uri, {
        code: code.code,
        state: body.state,
        iss: getIssuer(),
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : '授权失败'
      res.status(500).type('html').send(renderConsentPage({
        clientName: (await resolveClient(body.client_id))?.client_name || 'Cursor',
        redirectUri: body.redirect_uri,
        query: body,
        user: { name: session.name, email: session.email },
        teams: session.teams,
        scopes: selectedScopes,
        error: message,
      }))
    }
  })

  router.post('/token', async (req, res) => {
    const grant = String(req.body?.grant_type || '')
    if (grant === 'refresh_token') {
      const row = oauthStore.takeRefresh(String(req.body?.refresh_token || ''))
      if (!row) {
        res.status(400).json({ error: 'invalid_grant' })
        return
      }
      const next = oauthStore.createRefresh({
        clientId: row.clientId,
        scopes: row.scopes,
        pat: row.pat,
        userId: row.userId,
        teamId: row.teamId,
      })
      res.json(tokenPayload(row.pat, row.scopes, next.token))
      return
    }

    if (grant !== 'authorization_code') {
      res.status(400).json({ error: 'unsupported_grant_type' })
      return
    }

    const code = oauthStore.takeCode(String(req.body?.code || ''))
    if (!code) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'code expired or already used' })
      return
    }
    if (code.clientId !== String(req.body?.client_id || code.clientId)) {
      res.status(400).json({ error: 'invalid_client' })
      return
    }
    if (code.redirectUri !== String(req.body?.redirect_uri || '')) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' })
      return
    }
    const verifier = String(req.body?.code_verifier || '')
    if (!verifier || !verifyS256(verifier, code.codeChallenge)) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' })
      return
    }
    const refresh = oauthStore.createRefresh({
      clientId: code.clientId,
      scopes: code.scopes,
      pat: code.pat,
      userId: code.userId,
      teamId: code.teamId,
    })
    res.json(tokenPayload(code.pat, code.scopes, refresh.token))
  })

  router.post('/revoke', (req, res) => {
    const token = String(req.body?.token || '')
    oauthStore.takeRefresh(token)
    res.status(200).json({ revoked: true })
  })

  return router
}

function tokenPayload(accessToken: string, scopes: ScopeId[], refreshToken: string) {
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 31536000,
    refresh_token: refreshToken,
    scope: formatScopes(scopes),
  }
}

const OAUTH_QUERY_KEYS = [
  'client_id',
  'redirect_uri',
  'state',
  'scope',
  'code_challenge',
  'code_challenge_method',
  'response_type',
  'resource',
  'client_name',
] as const

function pickQuery(req: Request): Record<string, string> {
  const src = { ...(req.query as Record<string, unknown>), ...(req.body ?? {}) }
  const out: Record<string, string> = {}
  for (const key of OAUTH_QUERY_KEYS) {
    const v = src[key]
    if (typeof v === 'string' && v) out[key] = v
    else if (Array.isArray(v)) out[key] = v.filter((x) => typeof x === 'string').join(' ')
  }
  return out
}

async function validateAuthorizeRequest(query: Record<string, string>) {
  if (!query.client_id) return { code: 'invalid_request', description: 'client_id required', redirect: false }
  if (!query.redirect_uri) return { code: 'invalid_request', description: 'redirect_uri required', redirect: false }
  if (!isAllowedRedirectUri(query.redirect_uri)) {
    return { code: 'invalid_request', description: 'redirect_uri is not allowed', redirect: false }
  }
  const client = await resolveClient(query.client_id)
  if (!client) return { code: 'unauthorized_client', description: 'unknown client_id', redirect: true }
  if (!redirectUrisMatch(client.redirect_uris, query.redirect_uri)) {
    return { code: 'invalid_request', description: 'redirect_uri does not match registration', redirect: false }
  }
  if ((query.response_type || 'code') !== 'code') {
    return { code: 'unsupported_response_type', description: 'only response_type=code is supported', redirect: true }
  }
  if (!query.code_challenge) {
    return { code: 'invalid_request', description: 'PKCE code_challenge required', redirect: true }
  }
  if ((query.code_challenge_method || 'S256') !== 'S256') {
    return { code: 'invalid_request', description: 'only S256 PKCE is supported', redirect: true }
  }
  return null
}

async function resolveClient(clientId: string): Promise<OAuthClient | undefined> {
  const existing = oauthStore.getClient(clientId)
  if (existing) return existing
  if (!/^https?:\/\//i.test(clientId)) return undefined
  try {
    const res = await fetch(clientId, { headers: { Accept: 'application/json' } })
    if (!res.ok) return undefined
    const json = (await res.json()) as {
      client_id?: string
      client_name?: string
      redirect_uris?: string[]
    }
    const redirectUris = (json.redirect_uris ?? []).filter(isAllowedRedirectUri)
    if (!redirectUris.length) return undefined
    return oauthStore.putClient({
      client_id: clientId,
      client_name: json.client_name || 'Cursor',
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      createdAt: Date.now(),
    })
  } catch {
    return undefined
  }
}

function parsePostedScopes(body: unknown): ScopeId[] {
  if (!body || typeof body !== 'object') return [...DEFAULT_SCOPES]
  const scope = (body as { scope?: unknown }).scope
  if (Array.isArray(scope)) return parseScopes(scope.map(String))
  if (typeof scope === 'string') return parseScopes(scope)
  return [...DEFAULT_SCOPES]
}

function buildRedirect(base: string, params: Record<string, string | undefined>) {
  const u = new URL(base)
  for (const [k, v] of Object.entries(params)) {
    if (v) u.searchParams.set(k, v)
  }
  return u.toString()
}

function readCookie(req: Request, name: string) {
  const header = req.headers.cookie
  if (!header) return ''
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}

function setCookie(res: Response, name: string, value: string) {
  const secure = getIssuer().startsWith('https:')
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=1200`)
}

export { SESSION_COOKIE }
