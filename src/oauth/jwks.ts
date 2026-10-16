import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto'

/**
 * RSA key for OIDC discovery / Cursor metadata validation.
 * Access tokens remain opaque UniBoot PATs; this key is not used to mint them.
 */
let privateKey: KeyObject | undefined
let publicJwk: Record<string, unknown> | undefined

function loadOrGenerateKey(): KeyObject {
  if (privateKey) return privateKey

  const pem = process.env.MCP_OAUTH_JWKS_PRIVATE_KEY?.replace(/\\n/g, '\n')?.trim()
  if (pem) {
    privateKey = createPrivateKey(pem)
  } else {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    privateKey = createPrivateKey(pair.privateKey)
  }
  return privateKey
}

export function getSigningPublicJwk(): Record<string, unknown> {
  if (publicJwk) return publicJwk
  const pub = createPublicKey(loadOrGenerateKey())
  const jwk = pub.export({ format: 'jwk' }) as Record<string, unknown>
  publicJwk = {
    ...jwk,
    kid: 'ubd-mcp-1',
    use: 'sig',
    alg: 'RS256',
  }
  return publicJwk
}

export function jwksDocument() {
  return { keys: [getSigningPublicJwk()] }
}

/** Test helper: clear cached key between cases. */
export function resetJwksCacheForTests() {
  privateKey = undefined
  publicJwk = undefined
}
