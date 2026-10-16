import { describe, expect, it } from 'vitest'
import { extractBearer, extractQueryToken, resolveClientToken } from './api.js'

describe('resolveClientToken', () => {
  it('reads Authorization Bearer', () => {
    expect(extractBearer('Bearer ubd_pat_abc')).toBe('ubd_pat_abc')
    expect(extractBearer('bearer  ubd_pat_abc  ')).toBe('ubd_pat_abc')
    expect(extractBearer('ubd_pat_abc')).toBe('')
  })

  it('reads Penpot-style userToken query', () => {
    expect(extractQueryToken({ userToken: 'ubd_pat_from_url' })).toBe('ubd_pat_from_url')
    expect(extractQueryToken({ token: 'ubd_pat_alias' })).toBe('ubd_pat_alias')
    expect(extractQueryToken({ userToken: ['ubd_pat_first', 'other'] })).toBe('ubd_pat_first')
    expect(extractQueryToken({})).toBe('')
  })

  it('prefers Authorization header over query', () => {
    expect(
      resolveClientToken({
        headers: { authorization: 'Bearer header-pat' },
        query: { userToken: 'query-pat' },
      }),
    ).toBe('header-pat')
  })

  it('falls back to query when header is missing', () => {
    expect(
      resolveClientToken({
        headers: {},
        query: { userToken: 'ubd_pat_576d4e37' },
      }),
    ).toBe('ubd_pat_576d4e37')
  })
})
