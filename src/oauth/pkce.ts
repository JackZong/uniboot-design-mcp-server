import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

export function sha256Base64Url(value: string) {
  return createHash('sha256').update(value).digest('base64url')
}

export function verifyS256(verifier: string, challenge: string) {
  const computed = Buffer.from(sha256Base64Url(verifier))
  const expected = Buffer.from(challenge)
  if (computed.length !== expected.length) return false
  return timingSafeEqual(computed, expected)
}
