import type { KeySpec } from './key-specs.js'
import type { LayoutOutline } from './layout-outline.js'
import type { InventoryForSpecs } from './key-specs.js'

export type ChecklistItem = {
  id: string
  severity: 'must' | 'should'
  check: string
  /** Concrete ban / required CSS or structure */
  rule: string
  evidence?: string
}

export type PixelChecklist = {
  items: ChecklistItem[]
  bans: string[]
  requiredReads: string[]
  acceptance: string[]
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function hasFill(spec: KeySpec | undefined): boolean {
  const bg = spec?.fills.backgroundColor
  if (bg == null || bg === '' || bg === 'transparent' || bg === 'none') return false
  if (typeof bg === 'string' && /transparent|rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0/i.test(bg)) {
    return false
  }
  return true
}

/**
 * Derive hard acceptance checklist so Agents cannot fall back to common admin
 * patterns (space-between toolbars, sticky white footers, single shell).
 */
export function buildPixelChecklist(opts: {
  layoutOutline?: LayoutOutline | null
  keySpecs?: KeySpec[] | null
  inventory?: InventoryForSpecs | null
  pageWidth?: number | null
}): PixelChecklist {
  const items: ChecklistItem[] = []
  const bans: string[] = []
  const specs = opts.keySpecs ?? []
  const byId = new Map(specs.map((s) => [s.sourceNodeId, s]))
  const pageW = opts.pageWidth ?? 1440

  const cardCount = opts.layoutOutline?.cardCount ?? 0
  if (cardCount >= 2) {
    items.push({
      id: 'card-count',
      severity: 'must',
      check: `White content cards/sections count === ${cardCount}`,
      rule: `Do NOT wrap page body in one .xxx-shell / single Card. Use separate nodes: ${
        opts.layoutOutline?.contentFlow
          .filter(
            (c) =>
              c.role === 'card' ||
              c.role === 'stats' ||
              c.role === 'table' ||
              c.role === 'steps',
          )
          .map((c) => c.suggestedName)
          .join(', ') || 'per layoutOutline'
      }`,
      evidence: `layoutOutline.cardCount=${cardCount}`,
    })
    bans.push('single page-body white card / conflict-shell wrapping stats+alert+table+footer')
  }

  if (opts.layoutOutline?.sections.some((s) => s.role === 'alert')) {
    items.push({
      id: 'alert-standalone',
      severity: 'must',
      check: 'Rule/alert strip is NOT nested inside a white Card',
      rule: 'Place alert between cards as its own row; do not put it in card padding',
      evidence: 'layoutOutline has role=alert',
    })
    bans.push('alert inside card')
  }

  // Toolbar / batch button alignment from coordinates
  const texts = opts.inventory?.texts ?? []
  const buttons = opts.inventory?.buttons ?? []
  for (const btn of buttons) {
    const bSpec = btn.sourceNodeId ? byId.get(btn.sourceNodeId) : undefined
    const bx = num(bSpec?.box.x)
    if (bx == null) continue
    // Find a nearby title text on roughly same row (dy small) with smaller or similar x
    let pairedTitle: { content: string; x: number; sourceNodeId?: string } | null = null
    for (const t of texts) {
      const tSpec = t.sourceNodeId ? byId.get(t.sourceNodeId) : undefined
      const tx = num(tSpec?.box.x)
      const ty = num(tSpec?.box.y)
      const by = num(bSpec?.box.y)
      if (tx == null || ty == null || by == null) continue
      if (Math.abs(ty - by) > 40) continue
      if (tx <= bx + 8) {
        pairedTitle = { content: t.content, x: tx, sourceNodeId: t.sourceNodeId }
        break
      }
    }
    if (pairedTitle && Math.abs(pairedTitle.x - bx) <= 120) {
      items.push({
        id: `toolbar-left-${btn.sourceNodeId}`,
        severity: 'must',
        check: `Toolbar control near "${pairedTitle.content.slice(0, 24)}" stays LEFT-aligned (flex-start)`,
        rule: `justify-content: flex-start; gap from keySpecs — FORBIDDEN justify-content: space-between (title left / button right). Button x≈${bx}, title x≈${pairedTitle.x}`,
        evidence: `box.x button=${bx}, title=${pairedTitle.x}`,
      })
      bans.push('justify-content: space-between on title+batch toolbars unless box.x proves right alignment')
    } else if (bx > pageW * 0.55) {
      items.push({
        id: `toolbar-right-${btn.sourceNodeId}`,
        severity: 'should',
        check: 'Button is on the right half of the artboard — end alignment OK',
        rule: 'margin-left: auto or justify-content: flex-end is allowed for this control',
        evidence: `box.x=${bx} > ${Math.round(pageW * 0.55)}`,
      })
    }
  }

  // Footer chrome: button fills (primary blue) do NOT count as footer bar background
  const actionSections = (opts.layoutOutline?.sections ?? []).filter((s) => s.role === 'actions')
  const actionContainerSpecs = actionSections
    .map((s) => (s.sourceNodeId ? byId.get(s.sourceNodeId) : undefined))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
  const footerHasBg = actionContainerSpecs.some((s) => {
    if (s.role === 'button' || s.component === 'Button') return false
    return hasFill(s)
  })
  if (actionSections.length || actionContainerSpecs.length) {
    if (!footerHasBg) {
      items.push({
        id: 'footer-no-white-card',
        severity: 'must',
        check: 'Footer action row has NO white card / rounded white background',
        rule: 'Footer is plain flex row inside lower card (or page). FORBIDDEN sticky white bar, el-card footer, background:#fff + border-radius unless a footer container keySpecs.fills.backgroundColor is set (button primary fill does not count)',
        evidence: 'actions section has no non-button backgroundColor',
      })
      bans.push('sticky white footer card without backgroundColor in keySpecs')
    }
    items.push({
      id: 'footer-inside-lower-card',
      severity: 'must',
      check: 'Footer buttons belong to the lower table card, bottom area',
      rule: 'Do not promote footer to a third page-level card',
    })
  }

  // Absolute coords mandatory for landmarks
  items.push({
    id: 'read-keyspecs-before-layout',
    severity: 'must',
    check: 'Before writing toolbar/footer CSS, read open_delivery.keySpecs (box.x/y + cssHints)',
    rule: 'FORBIDDEN guessing admin defaults (space-between, sticky footer, single shell) without matching keySpecs',
  })

  items.push({
    id: 'edit-mode-acceptance',
    severity: 'must',
    check: 'Visual QA uses the same product state as the design (usually edit / conflict-resolve, NOT mode=detail readonly)',
    rule: 'If UI only shows 返回, you are in readonly — open the design-matching entry (e.g. 解析冲突), do not claim MCP missed buttons',
  })

  items.push({
    id: 'compare-with-screenshot',
    severity: 'must',
    check: 'compare_design_code with screenshot + implementedSource after implementation',
    rule: 'Without screenshot, pixel QA is incomplete; without implementedSource, ban lint is incomplete',
  })

  const requiredReads = [
    'open_delivery → layoutOutline.structureContract + keySpecs + pixelChecklist',
    'For any toolbar/footer/button: keySpecs.box.x/y (or get_design_spec) BEFORE CSS',
    'get_artboard_preview only for final eye-check — never override coordinates with prose',
  ]

  const acceptance = [
    ...items.filter((i) => i.severity === 'must').map((i) => `[ ] ${i.check}`),
    '[ ] No ban from pixelChecklist.bans appears in the implementation',
  ]

  // Dedupe bans
  const uniqBans = [...new Set(bans)]

  return { items, bans: uniqBans, requiredReads, acceptance }
}
