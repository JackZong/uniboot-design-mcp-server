import { api, ApiError, parseLink, getWebBase, buildDeliveryDetailUrl } from './api.js'

export type ResolvedFile = {
  projectId: string
  fileId: string
  version?: number
  pageId?: string
  /** Preferred artboard for get_design_page (from ?artboardId=). */
  artboardId?: string
  artboardIds?: string[]
  pageName?: string
  deliveryDetailUrl?: string | null
  previewUrl?: string | null
  contentTab?: 'product' | 'design'
  deliveryMode?: 'detail' | 'overview'
  fileType?: 'product' | 'design'
}

type FileListItem = {
  id: string
  name: string
  type?: string
  updatedAt?: string
}

export type ArtboardResolveItem = {
  id: string
  name: string
  pageName?: string | null
  width?: number
  height?: number
  groupName?: string | null
  /** Axure sitemap page id — product URLs pin this as ?pageId= */
  axurePageId?: string | null
}

/**
 * Map delivery pageId (+ optional ?artboard=) to concrete artboard id(s).
 * pageId formats from Web: board:{artboardId} | cluster:{rootId} | page:{name} | axurePageId | bare artboard id
 */
export function resolvePageToArtboards(
  pageId: string | undefined,
  artboards: ArtboardResolveItem[],
  preferredArtboardId?: string,
): {
  artboardId: string | null
  artboardIds: string[]
  pageName: string | null
  warnings: string[]
} {
  const warnings: string[] = []
  const byId = new Map(artboards.map((a) => [a.id, a]))

  const pickPreferred = (ids: string[]): string | null => {
    if (preferredArtboardId && ids.includes(preferredArtboardId)) return preferredArtboardId
    if (!ids.length) return null
    // Prefer largest frame (same heuristic as Web pageCoverArtboardId, sans layerType).
    let best = ids[0]!
    let bestArea = -1
    for (const id of ids) {
      const a = byId.get(id)
      const area = (a?.width ?? 0) * (a?.height ?? 0)
      if (area > bestArea) {
        bestArea = area
        best = id
      }
    }
    return best
  }

  if (preferredArtboardId && byId.has(preferredArtboardId)) {
    const hit = byId.get(preferredArtboardId)!
    if (!pageId) {
      return {
        artboardId: preferredArtboardId,
        artboardIds: [preferredArtboardId],
        pageName: hit.name,
        warnings,
      }
    }
  }

  if (!pageId) {
    // Detail URL may pin a stale artboardId from an older file version (re-import).
    if (preferredArtboardId) {
      warnings.push(
        `artboardId=${preferredArtboardId} not in current version list (possibly stale). Prefer open_delivery / get_design_page with this id; if geometry 404s, list_artboards and match by name.`,
      )
      return {
        artboardId: preferredArtboardId,
        artboardIds: [preferredArtboardId],
        pageName: null,
        warnings,
      }
    }
    return { artboardId: null, artboardIds: [], pageName: null, warnings }
  }

  if (pageId.startsWith('board:')) {
    const id = pageId.slice('board:'.length)
    const hit = byId.get(id)
    if (!hit) {
      warnings.push(`pageId board:${id} not found in artboards; do not guess another page`)
      return { artboardId: null, artboardIds: [], pageName: null, warnings }
    }
    return {
      artboardId: pickPreferred([id]),
      artboardIds: [id],
      pageName: hit.name,
      warnings,
    }
  }

  if (pageId.startsWith('cluster:')) {
    const root = pageId.slice('cluster:'.length)
    // Cluster root is an artboard id; include it. Sibling boards may share the page
    // on Web but are not recoverable without proximity clustering — prefer root / ?artboard=.
    const ids = byId.has(root) ? [root] : []
    if (preferredArtboardId && byId.has(preferredArtboardId) && !ids.includes(preferredArtboardId)) {
      ids.push(preferredArtboardId)
    }
    if (!ids.length) {
      warnings.push(`cluster pageId root ${root} not found in artboards`)
      return { artboardId: null, artboardIds: [], pageName: null, warnings }
    }
    if (!preferredArtboardId) {
      warnings.push(
        'cluster page may contain multiple frames; pass ?artboard= in the detail URL or confirm with list_artboards',
      )
    }
    const primary = pickPreferred(ids)
    return {
      artboardId: primary,
      artboardIds: ids,
      pageName: primary ? (byId.get(primary)?.name ?? null) : null,
      warnings,
    }
  }

  if (pageId.startsWith('page:')) {
    const name = pageId.slice('page:'.length)
    const matched = artboards.filter(
      (a) => a.pageName === name || a.name === name || a.pageName === pageId || a.name === pageId,
    )
    const ids = matched.map((a) => a.id)
    if (!ids.length) {
      warnings.push(`page:${name} matched no artboards by pageName/name`)
      return { artboardId: null, artboardIds: [], pageName: name, warnings }
    }
    const primary = pickPreferred(ids)
    if (ids.length > 1 && !preferredArtboardId) {
      warnings.push(
        `page:${name} maps to ${ids.length} artboards; using largest (${primary}). Pass ?artboard= if wrong.`,
      )
    }
    return {
      artboardId: primary,
      artboardIds: ids,
      pageName: name,
      warnings,
    }
  }

  // Bare id: treat as artboardId when present
  if (byId.has(pageId)) {
    const hit = byId.get(pageId)!
    return {
      artboardId: pickPreferred([pageId]),
      artboardIds: [pageId],
      pageName: hit.name,
      warnings,
    }
  }

  // Lanhu / Axure: ?pageId=<axurePageId>
  const byAxure = artboards.filter((a) => a.axurePageId === pageId)
  if (byAxure.length) {
    const ids = byAxure.map((a) => a.id)
    const primary = pickPreferred(ids)
    return {
      artboardId: primary,
      artboardIds: ids,
      pageName: primary ? (byId.get(primary)?.name ?? null) : null,
      warnings,
    }
  }

  warnings.push(`unrecognized pageId "${pageId}"; call list_artboards and match by name`)
  return { artboardId: null, artboardIds: [], pageName: null, warnings }
}

/** Resolve delivery link → projectId + fileId (design or product by contentTab). */
export async function resolveLinkWithFile(
  token: string,
  link: string,
): Promise<
  ResolvedFile & {
    files: FileListItem[]
    warnings: string[]
    hints: string[]
  }
> {
  const parsed = parseLink(link)
  const warnings: string[] = []
  const hints: string[] = []
  if (!parsed.projectId) {
    throw new ApiError(42200, 'Could not parse projectId from link')
  }

  const preferredType = parsed.contentTab === 'product' ? 'product' : 'design'
  const files = await api<FileListItem[]>(
    token,
    `/files?projectId=${encodeURIComponent(parsed.projectId)}&type=${preferredType}`,
  )
  let fileId = parsed.fileId && files.some((f) => f.id === parsed.fileId)
    ? parsed.fileId
    : (files[0]?.id ?? '')
  if (parsed.fileId && fileId !== parsed.fileId) {
    warnings.push(
      `link docId/fileId=${parsed.fileId} not in project ${preferredType} files; using ${fileId || 'none'}`,
    )
  }
  if (files.length > 1 && !parsed.fileId) {
    warnings.push(
      `project has ${files.length} ${preferredType} files; using first (${files[0]!.name}). Pass docId/fileId in the URL if wrong.`,
    )
  }
  if (!fileId) {
    const all = await api<FileListItem[]>(
      token,
      `/files?projectId=${encodeURIComponent(parsed.projectId)}`,
    )
    fileId = all[0]?.id ?? ''
    if (fileId) warnings.push(`no ${preferredType} file; fell back to first file of any type`)
  }
  if (!fileId) {
    throw new ApiError(40400, 'No files found for project')
  }

  let artboardId: string | undefined = parsed.artboardId
  let artboardIds: string[] | undefined
  let pageName: string | undefined
  let previewUrl: string | null | undefined
  let resolvedAxurePageId: string | undefined
  let resolvedParentId: string | undefined = parsed.parentId
  let resolvedDocType: string | undefined = parsed.docType

  const needsPageResolve = Boolean(parsed.pageId || parsed.artboardId)
  if (needsPageResolve || parsed.deliveryMode === 'detail') {
    try {
      const artboards = await api<
        (ArtboardResolveItem & {
          previewUrl?: string
          folderPath?: string[] | null
        })[]
      >(token, `/files/${fileId}/artboards${qs({ version: parsed.version })}`)
      const resolved = resolvePageToArtboards(parsed.pageId, artboards, parsed.artboardId)
      warnings.push(...resolved.warnings)
      artboardId = resolved.artboardId ?? undefined
      artboardIds = resolved.artboardIds.length ? resolved.artboardIds : undefined
      pageName = resolved.pageName ?? undefined
      if (artboardId) {
        const hit = artboards.find((a) => a.id === artboardId)
        previewUrl = hit?.previewUrl ?? null
        if (hit?.axurePageId) resolvedAxurePageId = hit.axurePageId
        if (!resolvedDocType && hit?.axurePageId) resolvedDocType = 'axure'
        if (!resolvedParentId && Array.isArray(hit?.folderPath) && hit.folderPath.length) {
          resolvedParentId = `folder:${hit.folderPath.join('/')}`
        }
      }
    } catch (err) {
      warnings.push(
        `could not resolve artboardId: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const deliveryDetailUrl = buildDeliveryDetailUrl({
    webBase: getWebBase(),
    projectId: parsed.projectId,
    fileId,
    artboardId,
    pageId:
      preferredType === 'product'
        ? (() => {
            const axure = resolvedAxurePageId
            if (axure && !/[^\x00-\x7F]/.test(axure) && /^[\w.:-]+$/.test(axure)) return axure
            if (parsed.pageId && !/[^\x00-\x7F]/.test(parsed.pageId)) return parsed.pageId
            return artboardId ? `board:${artboardId}` : null
          })()
        : parsed.pageId,
    parentId: preferredType === 'product' ? resolvedParentId : null,
    docType: preferredType === 'product' ? resolvedDocType : null,
    contentTab: preferredType,
    version: parsed.version ?? null,
  })

  if (parsed.deliveryMode === 'overview' && !artboardId) {
    hints.push(
      preferredType === 'product'
        ? 'Link is product OVERVIEW (no page_id). Call list_artboards and ask the user which page — do not guess. Detail URL: /project/product/{projectId}?doc_id=&doc_type=axure&page_id=&version_id='
        : 'Link is design OVERVIEW (no artboardId). Do NOT pick a random artboard. Call list_artboards and ask the user which page, or require a detail URL: /project/design/{projectId}?fileId=&artboardId=&v=',
    )
  } else if (artboardId) {
    hints.push(
      `Use artboardId=${artboardId} with get_design_page. Open deliveryDetailUrl in the browser to verify the page online — do not download preview images for page identity.`,
    )
  } else if (parsed.deliveryMode === 'detail') {
    hints.push(
      `Detail link did not resolve to an artboard. Call list_artboards and match by name; do not guess.`,
    )
  }

  return {
    projectId: parsed.projectId,
    contentTab: parsed.contentTab,
    pageId: parsed.pageId,
    artboardId,
    artboardIds,
    pageName,
    deliveryDetailUrl,
    previewUrl: previewUrl ?? null,
    deliveryMode: parsed.deliveryMode,
    fileType: parsed.fileType as 'product' | 'design' | undefined,
    version: parsed.version,
    fileId,
    files,
    warnings,
    hints,
  }
}

export async function resolveFileId(
  token: string,
  opts: { fileId?: string; projectId?: string; link?: string },
): Promise<{ fileId: string; projectId?: string; version?: number; warnings: string[] }> {
  if (opts.fileId) {
    return { fileId: opts.fileId, projectId: opts.projectId, warnings: [] }
  }
  if (opts.link) {
    const resolved = await resolveLinkWithFile(token, opts.link)
    return {
      fileId: resolved.fileId,
      projectId: resolved.projectId,
      version: resolved.version,
      warnings: resolved.warnings,
    }
  }
  if (opts.projectId) {
    const files = await api<FileListItem[]>(
      token,
      `/files?projectId=${encodeURIComponent(opts.projectId)}&type=design`,
    )
    if (!files[0]) throw new ApiError(40400, 'No design file for project')
    const warnings =
      files.length > 1
        ? [`project has ${files.length} design files; using first (${files[0].name})`]
        : []
    return { fileId: files[0].id, projectId: opts.projectId, warnings }
  }
  throw new ApiError(42200, 'fileId, projectId, or link required')
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}
