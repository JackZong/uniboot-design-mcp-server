import { getWebBase } from '../api.js'
import { DEFAULT_SCOPES, formatScopes } from './scopes.js'

export function getPublicBase() {
  return (
    process.env.MCP_PUBLIC_URL ??
    process.env.UBD_MCP_PUBLIC_URL ??
    `http://localhost:${process.env.MCP_PORT ?? 8070}`
  ).replace(/\/$/, '')
}

export function getIssuer() {
  // Path-aware issuer so AS discovery prefers /mcp/.well-known/* when
  // reverse proxies intercept origin /.well-known for ACME.
  return `${getPublicBase()}/mcp`
}

export function getResourceUrl() {
  return `${getPublicBase()}/mcp`
}

export function authorizationServerMetadata() {
  const issuer = getIssuer()
  const origin = getPublicBase()
  return {
    issuer,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    revocation_endpoint: `${origin}/revoke`,
    scopes_supported: [...DEFAULT_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    resource_indicators_supported: true,
    service_documentation: `${getWebBase()}/docs` ,
  }
}

export function protectedResourceMetadata() {
  const resource = getResourceUrl()
  return {
    resource,
    authorization_servers: [getIssuer()],
    bearer_methods_supported: ['header'],
    scopes_supported: [...DEFAULT_SCOPES],
    resource_name: 'UniBoot Design MCP',
    resource_documentation: getWebBase(),
  }
}

export function wwwAuthenticate(error?: string, description?: string) {
  // Prefer /mcp/.well-known so discovery still works when a reverse proxy
  // intercepts origin /.well-known (common 宝塔 / ACME configs).
  const metadata = `${getPublicBase()}/mcp/.well-known/oauth-protected-resource`
  const parts = [
    `Bearer realm="UniBoot Design"`,
    `resource_metadata="${metadata}"`,
    `scope="${formatScopes(DEFAULT_SCOPES)}"`,
  ]
  if (error) parts.push(`error="${error}"`)
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`)
  return parts.join(', ')
}
