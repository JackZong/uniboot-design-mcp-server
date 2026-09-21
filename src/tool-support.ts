import { ApiError } from './api.js'
import { mcpText, wrapErr, type SemDoc } from './budget.js'

export function catchToolResult(err: unknown) {
  if (err instanceof ApiError) return mcpText(wrapErr(err.message, err.code))
  const message = err instanceof Error ? err.message : String(err)
  return mcpText(wrapErr(message))
}

export type ArtboardListItem = {
  id: string
  name: string
  width?: number
  height?: number
  previewUrl?: string
  groupName?: string | null
  pageName?: string | null
}

export type SemanticRow = {
  id: string
  artboardId: string
  rev: number
  status: string
  tokenSetId: string | null
  document: SemDoc | null
  error: string | null
  pipelineRev?: number
}

export type GeomNode = {
  id: string
  name?: string
  type?: string
  box?: { x?: number; y?: number; width?: number; height?: number }
  style?: Record<string, unknown>
  children?: GeomNode[]
}

export function findGeomNode(root: GeomNode | undefined, nodeId: string): GeomNode | null {
  if (!root) return null
  if (root.id === nodeId) return root
  for (const child of root.children ?? []) {
    const hit = findGeomNode(child, nodeId)
    if (hit) return hit
  }
  return null
}

function findParentGeom(root: GeomNode | undefined, nodeId: string): GeomNode | null {
  if (!root?.children) return null
  for (const child of root.children) {
    if (child.id === nodeId) return root
    const deeper = findParentGeom(child, nodeId)
    if (deeper) return deeper
  }
  return null
}

export function specFromGeom(node: GeomNode, root?: GeomNode) {
  const style = node.style ?? {}
  const box = node.box ?? {}
  const parent = root ? findParentGeom(root, node.id) : null
  const nx = typeof box.x === 'number' ? box.x : null
  const ny = typeof box.y === 'number' ? box.y : null
  const px = typeof parent?.box?.x === 'number' ? parent.box.x : null
  const py = typeof parent?.box?.y === 'number' ? parent.box.y : null
  return {
    nodeId: node.id,
    name: node.name,
    type: node.type,
    box,
    relative: {
      parentId: parent?.id ?? null,
      offsetLeft: nx != null && px != null ? Math.round((nx - px) * 100) / 100 : null,
      offsetTop: ny != null && py != null ? Math.round((ny - py) * 100) / 100 : null,
    },
    spacing: {
      paddingTop: style.paddingTop,
      paddingRight: style.paddingRight,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      gap: style.gap ?? style.itemSpacing,
    },
    typography: {
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontFamily: style.fontFamily,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      textAlign: style.textAlign,
      color: style.color,
    },
    fills: { backgroundColor: style.backgroundColor, opacity: style.opacity },
    border: {
      borderColor: style.borderColor,
      borderWidth: style.borderWidth,
      borderRadius: style.borderRadius,
    },
    tokenRefs: style.tokenRefs ?? null,
    autoLayout: style.autoLayout ?? null,
    note: 'Prefer relative.offsetLeft/Top for CSS inside parent; read box.x/y only for artboard-absolute alignment. Do not invent space-between.',
  }
}
