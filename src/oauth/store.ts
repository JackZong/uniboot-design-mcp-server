import { randomToken } from './pkce.js'
import type { ScopeId } from './scopes.js'

export type OAuthClient = {
  client_id: string
  client_name: string
  redirect_uris: string[]
  token_endpoint_auth_method: 'none' | 'client_secret_post' | 'client_secret_basic'
  client_secret?: string
  createdAt: number
}

export type AuthCode = {
  code: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  scopes: ScopeId[]
  resource?: string
  userId: string
  email: string
  name: string
  teamId: string
  teamName: string
  pat: string
  expiresAt: number
}

export type RefreshRow = {
  token: string
  clientId: string
  scopes: ScopeId[]
  pat: string
  userId: string
  teamId: string
  expiresAt: number
}

export type LoginSession = {
  id: string
  accessToken: string
  userId: string
  email: string
  name: string
  teams: Array<{ id: string; name: string }>
  expiresAt: number
}

const TTL_CODE_MS = 10 * 60 * 1000
const TTL_SESSION_MS = 20 * 60 * 1000
const TTL_REFRESH_MS = 365 * 24 * 60 * 60 * 1000

export class OAuthStore {
  private clients = new Map<string, OAuthClient>()
  private codes = new Map<string, AuthCode>()
  private refresh = new Map<string, RefreshRow>()
  private sessions = new Map<string, LoginSession>()

  getClient(clientId: string) {
    this.gc()
    return this.clients.get(clientId)
  }

  putClient(client: OAuthClient) {
    this.clients.set(client.client_id, client)
    return client
  }

  createCode(input: Omit<AuthCode, 'code' | 'expiresAt'> & { code?: string }) {
    const code = input.code ?? randomToken(32)
    const row: AuthCode = { ...input, code, expiresAt: Date.now() + TTL_CODE_MS }
    this.codes.set(code, row)
    return row
  }

  takeCode(code: string) {
    this.gc()
    const row = this.codes.get(code)
    if (!row) return undefined
    this.codes.delete(code)
    if (row.expiresAt < Date.now()) return undefined
    return row
  }

  createRefresh(input: Omit<RefreshRow, 'token' | 'expiresAt'>) {
    const token = randomToken(32)
    const row: RefreshRow = { ...input, token, expiresAt: Date.now() + TTL_REFRESH_MS }
    this.refresh.set(token, row)
    return row
  }

  takeRefresh(token: string) {
    this.gc()
    const row = this.refresh.get(token)
    if (!row) return undefined
    this.refresh.delete(token)
    if (row.expiresAt < Date.now()) return undefined
    return row
  }

  createSession(input: Omit<LoginSession, 'id' | 'expiresAt'>) {
    const id = randomToken(24)
    const row: LoginSession = { ...input, id, expiresAt: Date.now() + TTL_SESSION_MS }
    this.sessions.set(id, row)
    return row
  }

  getSession(id: string) {
    this.gc()
    const row = this.sessions.get(id)
    if (!row || row.expiresAt < Date.now()) {
      if (row) this.sessions.delete(id)
      return undefined
    }
    return row
  }

  deleteSession(id: string) {
    this.sessions.delete(id)
  }

  private gc() {
    const now = Date.now()
    for (const [k, v] of this.codes) if (v.expiresAt < now) this.codes.delete(k)
    for (const [k, v] of this.refresh) if (v.expiresAt < now) this.refresh.delete(k)
    for (const [k, v] of this.sessions) if (v.expiresAt < now) this.sessions.delete(k)
  }
}

export const oauthStore = new OAuthStore()
