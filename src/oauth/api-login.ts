import { getApiBase } from '../api.js'

type ApiEnvelope<T> = { code: number; message?: string; data: T }

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  let json: ApiEnvelope<T>
  try {
    json = (await res.json()) as ApiEnvelope<T>
  } catch {
    throw new Error(`API ${res.status}: non-JSON response`)
  }
  if (!res.ok || json.code !== 0) {
    const err = new Error(json.message || `API ${res.status}`) as Error & {
      status: number
      code: number
    }
    err.status = res.status
    err.code = json.code
    throw err
  }
  return json.data
}

export type LoginResult = {
  accessToken: string
  user: { id: string; name: string; email: string }
}

export async function loginWithPassword(email: string, password: string): Promise<LoginResult> {
  return apiJson('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function listTeams(accessToken: string) {
  const rows = await apiJson<Array<{ id: string; name: string }>>('/teams', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return rows.map((t) => ({ id: t.id, name: t.name }))
}

export async function createMcpPat(accessToken: string, clientName: string) {
  const data = await apiJson<{ token: string; id: string; name: string }>('/auth/tokens', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      name: `UniBoot Design MCP (${clientName || 'Cursor'})`.slice(0, 80),
    }),
  })
  return data.token
}
