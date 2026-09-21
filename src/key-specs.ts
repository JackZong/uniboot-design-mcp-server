import type { SemNode } from './budget.js'
import type { LayoutOutline } from './layout-outline.js'

export type InventoryForSpecs = {
  texts: Array<{ content: string; sourceNodeId?: string; nodeId?: string }>
  buttons: Array<{ props: Record<string, unknown>; sourceNodeId?: string; nodeId?: string }>
  icons: Array<{ sourceNodeId?: string; nodeId?: string }>
}

export type GeomNode = {
  id: string
  name?: string
  type?: string
  box?: { x?: number; y?: number; width?: number; height?: number }
  style?: Record<string, unknown>
  children?: GeomNode[]
}

export type KeySpec = {
  sourceNodeId: string
  role: string
  component?: string
  name?: string
  box: {
    x: number | null
    y: number | null
    width: number | null
    height: number | null
  }
  /**
   * Parent-relative offsets (CSS-friendly). Prefer these over absolute box.x/y
   * when writing left/top/margin inside a card.
   */
  relative?: {
    parentId: string | null
    offsetLeft: number | null
    offsetTop: number | null
    /** Horizontal gap to paired same-row title (button after title). */
    gapAfterTitle: number | null
    titleSourceNodeId: string | null
  }
  spacing: {
    paddingTop: unknown
    paddingRight: unknown
    paddingBottom: unknown
    paddingLeft: unknown
    gap: unknown
  }
  typography: {
    fontSize: unknown
    fontWeight: unknown
    fontFamily: unknown
    lineHeight: unknown
    letterSpacing: unknown
    textAlign: unknown
    color: unknown
  }
  fills: {
    backgroundColor: unknown
    opacity: unknown
  }
  border: {
    borderColor: unknown
    borderWidth: unknown
    borderRadius: unknown
  }
  /** Ready-to-paste CSS fragments for pixel alignment */
  cssHints: string[]
  /**
   * Derived layout intent from absolute coordinates (x/y).
   * Agents MUST prefer this over admin-UI defaults like space-between.
   */
  layoutIntent?: {
    horizontal: 'start' | 'end' | 'unknown'
    note: string
  }
}

function findGeomById(root: GeomNode | undefined, id: string): GeomNode | null {
  if (!root) return null
  if (root.id === id) return root
  for (const child of root.children ?? []) {
    const hit = findGeomById(child, id)
    if (hit) return hit
  }
  return null
}

function findParentOf(root: GeomNode | undefined, id: string): GeomNode | null {
  if (!root?.children) return null
  for (const child of root.children) {
    if (child.id === id) return root
    const deeper = findParentOf(child, id)
    if (deeper) return deeper
  }
  return null
}

function numBox(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function px(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}px`
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

function buildCssHints(node: GeomNode): string[] {
  const style = node.style ?? {}
  const box = node.box ?? {}
  const hints: string[] = []
  const w = px(box.width)
  const h = px(box.height)
  if (w) hints.push(`width: ${w}`)
  if (h) hints.push(`height: ${h}`)
  for (const [prop, key] of [
    ['padding-top', 'paddingTop'],
    ['padding-right', 'paddingRight'],
    ['padding-bottom', 'paddingBottom'],
    ['padding-left', 'paddingLeft'],
    ['gap', 'gap'],
    ['font-size', 'fontSize'],
    ['font-weight', 'fontWeight'],
    ['line-height', 'lineHeight'],
    ['letter-spacing', 'letterSpacing'],
    ['color', 'color'],
    ['background-color', 'backgroundColor'],
    ['border-radius', 'borderRadius'],
    ['border-width', 'borderWidth'],
    ['border-color', 'borderColor'],
  ] as const) {
    const v = px(style[key] ?? (key === 'gap' ? style.itemSpacing : undefined))
    if (v) hints.push(`${prop}: ${v}`)
  }
  return hints
}

function toKeySpec(
  sourceNodeId: string,
  role: string,
  node: GeomNode,
  root: GeomNode | undefined,
  component?: string,
): KeySpec {
  const style = node.style ?? {}
  const box = node.box ?? {}
  const parent = findParentOf(root, sourceNodeId)
  const px_ = numBox(box.x)
  const py = numBox(box.y)
  const parentX = numBox(parent?.box?.x)
  const parentY = numBox(parent?.box?.y)
  const offsetLeft =
    px_ != null && parentX != null ? Math.round((px_ - parentX) * 100) / 100 : null
  const offsetTop =
    py != null && parentY != null ? Math.round((py - parentY) * 100) / 100 : null

  const cssHints = buildCssHints(node)
  if (offsetLeft != null) cssHints.push(`/* relative.offsetLeft: ${offsetLeft}px */`)
  if (offsetTop != null) cssHints.push(`/* relative.offsetTop: ${offsetTop}px */`)

  return {
    sourceNodeId,
    role,
    component,
    name: node.name,
    box: {
      x: px_,
      y: py,
      width: typeof box.width === 'number' ? box.width : null,
      height: typeof box.height === 'number' ? box.height : null,
    },
    relative: {
      parentId: parent?.id ?? null,
      offsetLeft,
      offsetTop,
      gapAfterTitle: null,
      titleSourceNodeId: null,
    },
    spacing: {
      paddingTop: style.paddingTop ?? null,
      paddingRight: style.paddingRight ?? null,
      paddingBottom: style.paddingBottom ?? null,
      paddingLeft: style.paddingLeft ?? null,
      gap: style.gap ?? style.itemSpacing ?? null,
    },
    typography: {
      fontSize: style.fontSize ?? null,
      fontWeight: style.fontWeight ?? null,
      fontFamily: style.fontFamily ?? null,
      lineHeight: style.lineHeight ?? null,
      letterSpacing: style.letterSpacing ?? null,
      textAlign: style.textAlign ?? null,
      color: style.color ?? null,
    },
    fills: {
      backgroundColor: style.backgroundColor ?? null,
      opacity: style.opacity ?? null,
    },
    border: {
      borderColor: style.borderColor ?? null,
      borderWidth: style.borderWidth ?? null,
      borderRadius: style.borderRadius ?? null,
    },
    cssHints,
  }
}

export type KeySpecsBundle = {
  specs: KeySpec[]
  /** Icon geometry node ids for export_artboard_assets(mode=icons) */
  iconNodeIds: string[]
  note: string
}

/**
 * Build pixel-alignment specs for landmark layout sections + buttons/icons.
 * Uses geometry Document keyed by sourceNodeId (== geom node id in UniBoot).
 */
export function collectKeySpecs(opts: {
  geomRoot?: GeomNode | null
  layoutOutline?: LayoutOutline | null
  inventory?: InventoryForSpecs | null
  maxSpecs?: number
}): KeySpecsBundle {
  const maxSpecs = opts.maxSpecs ?? 24
  const root = opts.geomRoot ?? undefined
  const specs: KeySpec[] = []
  const seen = new Set<string>()

  const add = (sourceNodeId: string | undefined, role: string, component?: string) => {
    if (!sourceNodeId || seen.has(sourceNodeId) || specs.length >= maxSpecs) return
    const node = findGeomById(root, sourceNodeId)
    if (!node) return
    seen.add(sourceNodeId)
    specs.push(toKeySpec(sourceNodeId, role, node, root, component))
  }

  for (const section of opts.layoutOutline?.sections ?? []) {
    if (section.role === 'chrome') continue
    add(section.sourceNodeId, section.suggestedName || section.role, section.component)
  }

  for (const btn of opts.inventory?.buttons ?? []) {
    add(btn.sourceNodeId, 'button', 'Button')
  }

  const iconNodeIds: string[] = []
  for (const icon of opts.inventory?.icons ?? []) {
    if (icon.sourceNodeId && iconNodeIds.length < 30) {
      iconNodeIds.push(icon.sourceNodeId)
    }
    add(icon.sourceNodeId, 'icon', 'Icon')
  }

  // Important text (badges, titles) — first few unique
  for (const t of opts.inventory?.texts ?? []) {
    if (specs.length >= maxSpecs) break
    if (!t.content || t.content.length > 60) continue
    add(t.sourceNodeId, 'text', 'Text')
  }

  annotateButtonLayoutIntent(specs, opts.inventory)

  return {
    specs,
    iconNodeIds,
    note:
      specs.length === 0
        ? 'No geometry matched — call get_design_spec(nodeId) per landmark; ensure artboard document is hydrated.'
        : 'Apply cssHints / box / spacing / layoutIntent literally. FORBIDDEN: space-between or sticky white footer unless layoutIntent/fills say so.',
  }
}

/** Infer start vs end from button x vs nearby title x (same row). */
function annotateButtonLayoutIntent(
  specs: KeySpec[],
  inventory?: InventoryForSpecs | null,
): void {
  const byId = new Map(specs.map((s) => [s.sourceNodeId, s]))
  for (const btn of inventory?.buttons ?? []) {
    if (!btn.sourceNodeId) continue
    const bSpec = byId.get(btn.sourceNodeId)
    if (!bSpec || bSpec.box.x == null || bSpec.box.y == null) continue
    let titleX: number | null = null
    let titleW: number | null = null
    let titleId: string | null = null
    for (const t of inventory?.texts ?? []) {
      if (!t.sourceNodeId) continue
      const tSpec = byId.get(t.sourceNodeId)
      if (!tSpec || tSpec.box.x == null || tSpec.box.y == null) continue
      if (Math.abs(tSpec.box.y - bSpec.box.y) > 40) continue
      if (tSpec.box.x <= bSpec.box.x + 8) {
        titleX = tSpec.box.x
        titleW = tSpec.box.width
        titleId = t.sourceNodeId
        break
      }
    }
    if (titleX != null && Math.abs(titleX - bSpec.box.x) <= 120) {
      const titleRight = titleW != null ? titleX + titleW : titleX
      const rawGap = Math.round((bSpec.box.x - titleRight) * 100) / 100
      // Same left edge (stacked / shared x) → no horizontal gap; only true when button sits right of title
      const gapAfterTitle = rawGap >= 0 ? rawGap : null
      if (bSpec.relative) {
        bSpec.relative.gapAfterTitle = gapAfterTitle
        bSpec.relative.titleSourceNodeId = titleId
      }
      bSpec.layoutIntent = {
        horizontal: 'start',
        note:
          gapAfterTitle == null
            ? `Same left edge as title (title.x≈${titleX}, button.x≈${bSpec.box.x}) → flex-start; FORBIDDEN space-between`
            : `Same row as title (title.x≈${titleX}, button.x≈${bSpec.box.x}, gapAfterTitle≈${gapAfterTitle}px) → flex-start + gap; FORBIDDEN space-between`,
      }
      bSpec.cssHints.push('justify-content: flex-start /* layoutIntent:start — not space-between */')
      if (gapAfterTitle != null && gapAfterTitle > 0) {
        bSpec.cssHints.push(`gap: ${gapAfterTitle}px /* relative.gapAfterTitle to title */`)
      }
    } else if (bSpec.box.x > 800) {
      bSpec.layoutIntent = {
        horizontal: 'end',
        note: `button.x≈${bSpec.box.x} on right half → flex-end / margin-left:auto OK`,
      }
      bSpec.cssHints.push('margin-left: auto /* layoutIntent:end */')
    } else {
      bSpec.layoutIntent = {
        horizontal: 'unknown',
        note: 'Use relative.offsetLeft / box.x relative to parent; do not default to space-between',
      }
    }
  }
}

/** Collect sourceNodeIds from a semantic subtree (for tests / callers). */
export function listSourceNodeIds(node: SemNode | undefined, out: string[] = []): string[] {
  if (!node) return out
  if (node.sourceNodeId) out.push(node.sourceNodeId)
  for (const kids of Object.values(node.slots ?? {})) {
    if (!Array.isArray(kids)) continue
    for (const k of kids) listSourceNodeIds(k, out)
  }
  return out
}
