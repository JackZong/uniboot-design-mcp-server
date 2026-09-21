import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getApiBase, ApiError } from './api.js'

export type TokenProvider = () => string

export const PREVIEW_URI_TEMPLATE =
  'ubd://files/{fileId}/artboards/{artboardId}/preview'

export function previewResourceUri(fileId: string, artboardId: string, version?: number | string) {
  const base = `ubd://files/${fileId}/artboards/${artboardId}/preview`
  return version != null && version !== '' ? `${base}?version=${version}` : base
}

export type PreviewBlob = {
  mimeType: string
  blob: string
  byteLength: number
  sourceUrl: string
  placeholder?: boolean
  previewSource?: 'html' | 'geometry' | 'placeholder' | null
  pixelAcceptable?: boolean
  previewGen?: number | null
  previewStale?: boolean
  canvasViews?: Array<{
    id: string
    label: string
    kind: string
    clip: { x: number; y: number; width: number; height: number }
  }> | null
  canvas?: { width: number; height: number } | null
}

/**
 * Resolve a signed preview URL via API, then download bytes.
 * Caps payload size so Agents don't blow context (default 2MB).
 */
export async function fetchArtboardPreview(
  token: string,
  fileId: string,
  artboardId: string,
  opts: { version?: number | string; maxBytes?: number } = {},
): Promise<PreviewBlob> {
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024
  const q =
    opts.version != null && opts.version !== ''
      ? `?version=${encodeURIComponent(String(opts.version))}`
      : ''

  // Prefer list-style signed preview-img (same-origin, works for fixtures via API).
  // Fall back to preview-url (S3 signed) when needed.
  const previewMeta = await fetchJson<{
    url: string
    fixture?: boolean
    placeholder?: boolean
    previewSource?: 'html' | 'geometry' | 'placeholder' | null
    pixelAcceptable?: boolean
    previewGen?: number | null
    previewStale?: boolean
    canvasViews?: PreviewBlob['canvasViews']
    canvas?: PreviewBlob['canvas']
  }>(token, `/files/${fileId}/artboards/${artboardId}/preview-url${q}`)

  let url = previewMeta.url
  if (url.startsWith('/')) {
    // Relative API path — fetch with Bearer (preview-fixture) or absolute against API host
    const apiOrigin = getApiBase().replace(/\/api\/v1\/?$/, '')
    url = `${apiOrigin}${url}`
  }

  const res = await fetch(url, {
    headers: url.includes('/api/v1/')
      ? { Authorization: `Bearer ${token}` }
      : undefined,
  })
  if (!res.ok) {
    throw new ApiError(
      res.status === 403 ? 40300 : res.status === 404 ? 40400 : 50000,
      `Failed to download preview (${res.status})`,
    )
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > maxBytes) {
    throw new ApiError(
      42200,
      `Preview too large (${buf.byteLength} bytes > ${maxBytes}); open previewUrl in browser instead`,
    )
  }

  const mimeType =
    res.headers.get('content-type')?.split(';')[0]?.trim() ||
    guessMime(url, buf) ||
    'image/png'

  const placeholder = Boolean(previewMeta.placeholder || previewMeta.fixture)
  const previewSource = previewMeta.previewSource ?? (placeholder ? 'placeholder' : null)
  const pixelAcceptable =
    previewMeta.pixelAcceptable === true && previewSource === 'html' && !placeholder

  return {
    mimeType,
    blob: buf.toString('base64'),
    byteLength: buf.byteLength,
    sourceUrl: previewMeta.url,
    placeholder,
    previewSource,
    pixelAcceptable,
    previewGen: previewMeta.previewGen ?? null,
    previewStale: Boolean(previewMeta.previewStale),
    canvasViews: previewMeta.canvasViews ?? null,
    canvas: previewMeta.canvas ?? null,
  }
}

async function fetchJson<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-UBD-Client': 'mcp',
    },
  })
  const json = (await res.json()) as { code: number; message?: string; data: T }
  if (json.code !== 0) {
    throw new ApiError(json.code || 50000, json.message || 'API error')
  }
  return json.data
}

function guessMime(url: string, buf: Buffer): string | null {
  const lower = url.toLowerCase()
  if (lower.includes('.svg') || buf.slice(0, 5).toString() === '<?xml' || buf.slice(0, 4).toString() === '<svg') {
    return 'image/svg+xml'
  }
  if (lower.includes('.jpg') || lower.includes('.jpeg') || (buf[0] === 0xff && buf[1] === 0xd8)) {
    return 'image/jpeg'
  }
  if (lower.includes('.webp') || buf.slice(0, 4).toString() === 'RIFF') return 'image/webp'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  return null
}

export function registerResources(server: McpServer, getToken: TokenProvider) {
  server.registerResource(
    'artboard-preview',
    new ResourceTemplate(PREVIEW_URI_TEMPLATE, {
      list: undefined,
    }),
    {
      title: 'Artboard preview image',
      description:
        'PNG/JPEG/WebP/SVG preview of a design artboard. URI: ubd://files/{fileId}/artboards/{artboardId}/preview?version=',
      mimeType: 'image/png',
    },
    async (uri, vars) => {
      const fileId = String(vars.fileId ?? '')
      const artboardId = String(vars.artboardId ?? '')
      if (!fileId || !artboardId) {
        throw new Error('fileId and artboardId required in resource URI')
      }
      const version = uri.searchParams.get('version') ?? undefined
      const preview = await fetchArtboardPreview(getToken(), fileId, artboardId, { version })
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: preview.mimeType,
            blob: preview.blob,
          },
        ],
      }
    },
  )
}
