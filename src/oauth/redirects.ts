const OFFICIAL_HTTPS_HOSTS = new Set([
  'cursor.com',
  'www.cursor.com',
  'claude.ai',
  'claude.com',
  'chatgpt.com',
  'platform.openai.com',
  'vscode.dev',
  'insiders.vscode.dev',
])

export function isAllowedRedirectUri(uri: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return false
  }
  if (parsed.username || parsed.password || parsed.hash) return false
  if (parsed.protocol === 'https:' && OFFICIAL_HTTPS_HOSTS.has(parsed.hostname.toLowerCase())) {
    return true
  }
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
