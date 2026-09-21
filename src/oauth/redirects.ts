const CURSOR_CALLBACKS = new Set([
  'http://localhost:8787/callback',
  'https://www.cursor.com/agents/mcp/oauth/callback',
  'https://cursor.com/agents/mcp/oauth/callback',
])

export function isAllowedRedirectUri(uri: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return false
  }
  if (parsed.username || parsed.password || parsed.hash) return false
  if (CURSOR_CALLBACKS.has(uri)) return true
  if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) return true
  if (parsed.protocol === 'https:' && isLoopbackHost(parsed.hostname)) return true
  return false
}

export function redirectUrisMatch(registered: string[], requested: string) {
  return registered.includes(requested)
}

function isLoopbackHost(host: string) {
  const h = host.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
}
