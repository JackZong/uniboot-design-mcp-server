const API_BASE = process.env.UBD_API_BASE ?? 'http://localhost:8060/api/v1'

export function getApiBase() {
  return API_BASE.replace(/\/$/, '')
}

export class ApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Mirrors @ubd/shared ErrorCode / ErrorMessage (avoid ESM↔CJS friction at runtime). */
const ErrorCode = {
  UNAUTHORIZED: 40100,
  FORBIDDEN: 40300,
  NOT_FOUND: 40400,
  VALIDATION: 42200,
  INTERNAL: 50000,
} as const

const ErrorMessage: Record<number, string> = {
  [ErrorCode.UNAUTHORIZED]: 'Unauthorized: missing or invalid OAuth token',
  [ErrorCode.FORBIDDEN]:
    'Forbidden: your account does not have access to this team or project. Ask a team owner to invite you.',
  [ErrorCode.NOT_FOUND]: 'Not found: resource does not exist or is not visible to your account',
  [ErrorCode.VALIDATION]: 'Validation failed: check request parameters',
  [ErrorCode.INTERNAL]: 'Internal server error',
}

function mapApiError(code: number, message?: string): ApiError {
  const fallback = ErrorMessage[code] || ErrorMessage[ErrorCode.INTERNAL]!
  const text =
    message && message !== 'API error' && message !== 'Forbidden' && message !== 'Not found'
      ? message
      : fallback
  if (code === ErrorCode.FORBIDDEN) {
    return new ApiError(
      code,
      text.includes('team') || text.includes('account') ? text : ErrorMessage[ErrorCode.FORBIDDEN]!,
    )
  }
  return new ApiError(code, text)
}

export function getWebBase() {
  return (process.env.UBD_WEB_BASE ?? process.env.WEB_BASE_URL ?? 'http://localhost:5173').replace(
    /\/$/,
    '',
  )
}

function requestHeaders(token: string, init?: RequestInit): Headers {
  const headers = new Headers()
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('X-UBD-Client', 'mcp')
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  }
  const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData
  if (isForm) {
    headers.delete('Content-Type')
  } else if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return headers
}

export async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  if (!token) {
    throw mapApiError(ErrorCode.UNAUTHORIZED)
  }
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: requestHeaders(token, init),
  })
  let json: { code: number; message?: string; data: T }
  try {
    json = (await res.json()) as { code: number; message?: string; data: T }
  } catch {
    throw mapApiError(
      res.status === 403
        ? ErrorCode.FORBIDDEN
        : res.status === 401
          ? ErrorCode.UNAUTHORIZED
          : ErrorCode.INTERNAL,
      `API ${res.status}: non-JSON response`,
    )
  }
  if (json.code !== 0) {
    const code =
      json.code ||
      (res.status === 403
        ? ErrorCode.FORBIDDEN
        : res.status === 404
          ? ErrorCode.NOT_FOUND
          : res.status === 401
            ? ErrorCode.UNAUTHORIZED
            : ErrorCode.INTERNAL)
    throw mapApiError(code, json.message)
  }
  return json.data
}

/** Best-effort audit; never throws into tool handlers. */
export function auditMcp(
  token: string,
  payload: {
    tool: string
    resourceType?: string
    resourceId?: string
    meta?: Record<string, unknown>
  },
): void {
  if (!token) return
  void api(token, '/mcp/audit', {
    method: 'POST',
    body: JSON.stringify(payload),
  }).catch(() => undefined)
}

/** Parse design / product delivery links.
 * Design detail: /project/design/{projectId}?fileId=&artboardId=&v=
 * Product detail: /project/product/{projectId}?doc_id=&doc_type=axure&page_id=&parent_id=&version_id=
 * Overview: /project/{design|product}/{projectId}?v= or ?version_id=
 */
export function parseLink(link: string) {
  const url = new URL(link)
  const parts = url.pathname.split('/').filter(Boolean)
  const projectIdx = parts.indexOf('project')
  const contentTab =
    projectIdx >= 0 && (parts[projectIdx + 1] === 'product' || parts[projectIdx + 1] === 'design')
      ? (parts[projectIdx + 1] as 'product' | 'design')
      : undefined
  const projectId = contentTab && projectIdx >= 0 ? (parts[projectIdx + 2] ?? '') : ''
  const reserved = new Set(['code', 'editor', 'prototype'])
  const detailSegment =
    contentTab === 'design' && projectIdx >= 0 ? parts[projectIdx + 3] : undefined
  // Prefer query page_id (product); legacy pageId / design path segment still supported
  const pageId =
    url.searchParams.get('page_id')?.trim() ||
    url.searchParams.get('pageId')?.trim() ||
    (detailSegment && !reserved.has(detailSegment) ? decodeURIComponent(detailSegment) : undefined) ||
    undefined
  const versionRaw =
    url.searchParams.get('version_id') ||
    url.searchParams.get('versionId') ||
    url.searchParams.get('v')
  const version = versionRaw
  const fileId =
    url.searchParams.get('doc_id')?.trim() ||
    url.searchParams.get('docId')?.trim() ||
    url.searchParams.get('fileId')?.trim() ||
    url.searchParams.get('image_id')?.trim() ||
    undefined
  const artboardId =
    url.searchParams.get('artboardId')?.trim() ||
    url.searchParams.get('artboard')?.trim() ||
    undefined
  const parentId =
    url.searchParams.get('parent_id')?.trim() ||
    url.searchParams.get('parentId')?.trim() ||
    undefined
  const docType =
    url.searchParams.get('doc_type')?.trim() ||
    url.searchParams.get('docType')?.trim() ||
    undefined
  const deliveryMode =
    artboardId || pageId
      ? ('detail' as const)
      : contentTab
        ? ('overview' as const)
        : undefined
  return {
    projectId,
    contentTab,
    pageId,
    fileId,
    artboardId,
    parentId,
    docType,
    deliveryMode,
    fileType: contentTab === 'product' ? 'product' : contentTab === 'design' ? 'design' : undefined,
    version: version ? Number(version) : undefined,
  }
}

export function buildDeliveryDetailUrl(opts: {
  webBase: string
  projectId: string
  fileId?: string | null
  artboardId?: string | null
  pageId?: string | null
  parentId?: string | null
  docType?: string | null
  contentTab?: 'product' | 'design' | null
  version?: number | null
}): string | null {
  if (!opts.projectId) return null
  const tab = opts.contentTab === 'product' ? 'product' : 'design'
  if (tab === 'product') {
    if (!opts.pageId && !opts.artboardId) return null
    const u = new URL(`/project/product/${encodeURIComponent(opts.projectId)}`, opts.webBase)
    if (opts.fileId) {
      u.searchParams.set('doc_id', opts.fileId)
      u.searchParams.set('image_id', opts.fileId)
    }
    if (opts.docType) u.searchParams.set('doc_type', opts.docType)
    const pagePin = opts.pageId || (opts.artboardId ? `board:${opts.artboardId}` : null)
    if (pagePin) u.searchParams.set('page_id', pagePin)
    // parent_id must be ASCII — never put CJK folder names in the link
    if (opts.parentId && !/[^\x00-\x7F]/.test(opts.parentId)) {
      u.searchParams.set('parent_id', opts.parentId)
    }
    if (opts.version != null) u.searchParams.set('version_id', String(opts.version))
    return u.toString()
  }
  if (!opts.artboardId) return null
  const u = new URL(`/project/design/${encodeURIComponent(opts.projectId)}`, opts.webBase)
  if (opts.fileId) u.searchParams.set('fileId', opts.fileId)
  u.searchParams.set('artboardId', opts.artboardId)
  if (opts.version != null) u.searchParams.set('v', String(opts.version))
  return u.toString()
}

export function extractBearer(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header
  if (!raw) return ''
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim())
  return m?.[1]?.trim() ?? ''
}
