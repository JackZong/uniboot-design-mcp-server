import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import express from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOAuthRouter } from './router.js'
import { oauthStore } from './store.js'
import { sha256Base64Url, verifyS256 } from './pkce.js'
import { isAllowedRedirectUri } from './redirects.js'
import { parseScopes } from './scopes.js'

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

describe('pkce / redirects / scopes', () => {
  it('verifies S256', () => {
    const { verifier, challenge } = pkce()
    expect(sha256Base64Url(verifier)).toBe(challenge)
    expect(verifyS256(verifier, challenge)).toBe(true)
    expect(verifyS256('nope', challenge)).toBe(false)
  })

  it('allows official AI client and loopback redirects', () => {
    expect(isAllowedRedirectUri('http://localhost:8787/callback')).toBe(true)
    expect(isAllowedRedirectUri('https://www.cursor.com/agents/mcp/oauth/callback')).toBe(true)
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true)
    expect(isAllowedRedirectUri('https://chatgpt.com/aip/mcp/oauth/callback')).toBe(true)
    expect(isAllowedRedirectUri('https://evil.example/callback')).toBe(false)
  })

  it('defaults scopes to read write search', () => {
    expect(parseScopes('')).toEqual(['read', 'write', 'search'])
    expect(parseScopes('read write')).toEqual(['read', 'write'])
  })
})

describe('oauth http', () => {
  const app = express()
  const oauth = createOAuthRouter()
  app.use(oauth)
  app.use('/mcp', oauth)
  const server = createServer(app)
  let base = ''

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('no addr')
    base = `http://127.0.0.1:${addr.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  })

  it('serves protected resource and AS metadata', async () => {
    const pr = await fetch(`${base}/.well-known/oauth-protected-resource`).then((r) => r.json())
    const as = await fetch(`${base}/.well-known/oauth-authorization-server`).then((r) => r.json())
    expect(pr.authorization_servers.length).toBeGreaterThan(0)
    expect(as.authorization_endpoint).toContain('/authorize')
    expect(as.code_challenge_methods_supported).toContain('S256')
    expect(as.registration_endpoint).toContain('/register')

    const prMcp = await fetch(`${base}/mcp/.well-known/oauth-protected-resource`).then((r) => r.json())
    const asMcp = await fetch(`${base}/mcp/.well-known/oauth-authorization-server`).then((r) => r.json())
    const oidcMcp = await fetch(`${base}/mcp/.well-known/openid-configuration`).then((r) => r.json())
    expect(prMcp.resource).toContain('/mcp')
    expect(prMcp.authorization_servers[0]).toContain('/mcp')
    expect(asMcp.registration_endpoint).toContain('/register')
    expect(asMcp.issuer).toContain('/mcp')
    expect(oidcMcp.authorization_endpoint).toContain('/authorize')
  })

  it('registers a public client and completes PKCE token exchange', async () => {
    const { verifier, challenge } = pkce()
    const mcpRegistered = await fetch(`${base}/mcp/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Cursor',
        redirect_uris: ['http://localhost:8787/callback'],
      }),
    })
    expect(mcpRegistered.status).toBe(201)

    const registered = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Cursor',
        redirect_uris: ['http://localhost:8787/callback'],
      }),
    }).then(async (r) => {
      expect(r.status).toBe(201)
      return r.json() as Promise<{ client_id: string }>
    })

    oauthStore.createCode({
      clientId: registered.client_id,
      redirectUri: 'http://localhost:8787/callback',
      codeChallenge: challenge,
      scopes: ['read', 'write', 'search'],
      userId: 'u1',
      email: 'dev@example.com',
      name: 'Dev',
      teamId: 't1',
      teamName: 'Team',
      pat: 'ubd_pat_test_token',
      code: 'test-code',
    })

    const tokenRes = await fetch(`${base}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'test-code',
        redirect_uri: 'http://localhost:8787/callback',
        client_id: registered.client_id,
        code_verifier: verifier,
      }),
    })
    expect(tokenRes.status).toBe(200)
    const token = (await tokenRes.json()) as { access_token: string; token_type: string }
    expect(token.token_type).toBe('Bearer')
    expect(token.access_token).toBe('ubd_pat_test_token')
  })

  it('rejects disallowed redirect URIs at registration', async () => {
    const res = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Evil',
        redirect_uris: ['https://evil.example/callback'],
      }),
    })
    expect(res.status).toBe(400)
  })
})
