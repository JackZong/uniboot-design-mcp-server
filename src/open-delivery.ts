import { api } from './api.js'
import {
  pruneSemanticDocument,
  type SemDoc,
  type SemNode,
} from './budget.js'
import { collectKeySpecs, type GeomNode, type KeySpecsBundle } from './key-specs.js'
import { collectLayoutOutline, type LayoutOutline } from './layout-outline.js'
import { buildPixelChecklist, type PixelChecklist } from './pixel-checklist.js'
import { inferAcceptanceState, inferAcceptanceStateFromProductBrief, type AcceptanceState } from './acceptance-state.js'
import { resolveDeliveryProjectConfig } from './stack-detect.js'
import { fetchArtboardPreview, previewResourceUri, type PreviewBlob } from './resources.js'
import { resolveLinkWithFile } from './resolve.js'
import {
  BUTTON_LABEL_RE,
  isPageLevelTable,
  isTableCellNode,
} from './semantic-heuristics.js'

export type OpenDeliveryInput = {
  link: string
  /** Optional local uniboot-design.json object; else example / stack-detected defaults. */
  config?: unknown
  /**
   * Optional consumer package.json object. When config is omitted and deps include
   * element-plus, auto-select Element Plus defaults instead of uniboot-ui.
   */
  packageJson?: unknown
  maxDepth?: number
  maxNodes?: number
  /** Fetch raster preview for visual QA (default true). */
  includePreview?: boolean
}

type SemanticRow = {
  artboardId: string
  rev: number
  status: string
  tokenSetId: string | null
  document: SemDoc | null
  error: string | null
  pipelineRev?: number
}

type PrdListItem = {
  id: string
  title: string
  status: string
  updatedAt?: string
}

export type DesignInventory = {
  texts: Array<{ content: string; sourceNodeId?: string; nodeId?: string }>
  buttons: Array<{ props: Record<string, unknown>; sourceNodeId?: string; nodeId?: string }>
  icons: Array<{ sourceNodeId?: string; nodeId?: string }>
  components: Array<{ name: string; count: number }>
  tables: number
  stubbedNodes: number
}

/** Prefer `link`, accept Agent footgun `url`. */
export function pickDeliveryLink(args: {
  link?: string
  url?: string
}): string | undefined {
  const raw = (args.link ?? args.url ?? '').trim()
  return raw || undefined
}

export function looksLikeDeliveryUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const s = value.trim()
  if (!/^https?:\/\//i.test(s)) return false
  return /\/project\/(design|product)\//i.test(s) || /[?&](fileId|artboardId)=/i.test(s)
}

export type EmptyProductShellReport = {
  empty: boolean
  reasons: string[]
  warnings: string[]
  hints: string[]
}

/**
 * Product / Axure pages sometimes ingest with 0 widgets (CSS-only geometry missed).
 * Agents must NOT treat empty Box + pixelChecklist as implementable design.
 */
export function detectEmptyProductShell(opts: {
  contentTab?: string | null
  fileType?: string | null
  inventory?: DesignInventory | null
  layoutOutline?: LayoutOutline | null
  /** Geometry document root (from /document). */
  geomRoot?: { children?: unknown[] | null; type?: string } | null
  axureMeta?: { widgetCount?: number | null; htmlPath?: string | null } | null
}): EmptyProductShellReport {
  const isProduct =
    opts.contentTab === 'product' ||
    opts.fileType === 'product' ||
    opts.axureMeta != null
  if (!isProduct) {
    return { empty: false, reasons: [], warnings: [], hints: [] }
  }

  const reasons: string[] = []
  const inv = opts.inventory
  const texts = inv?.texts?.length ?? 0
  const buttons = inv?.buttons?.length ?? 0
  const comps = inv?.components ?? []
  const onlyEmptyBox =
    comps.length > 0 &&
    comps.every((c) => c.name === 'Box') &&
    (comps[0]?.count ?? 0) <= 1 &&
    texts === 0 &&
    buttons === 0
  if (onlyEmptyBox) reasons.push('semantic inventory is empty (single Box, no texts/buttons)')

  const cardCount = opts.layoutOutline?.cardCount ?? 0
  if (cardCount === 0 && texts === 0) reasons.push('layoutOutline.cardCount=0 with no copy')

  const geomKids = opts.geomRoot?.children
  if (Array.isArray(geomKids) && geomKids.length === 0) {
    reasons.push('geometry document root has no children')
  }

  const widgetCount = opts.axureMeta?.widgetCount
  if (typeof widgetCount === 'number' && widgetCount === 0) {
    reasons.push('meta.axure.widgetCount=0')
  }

  if (!reasons.length) {
    return { empty: false, reasons: [], warnings: [], hints: [] }
  }

  const htmlPath = opts.axureMeta?.htmlPath
  const warnings = [
    `PRODUCT SHELL EMPTY: ${reasons.join('; ')}. Do NOT implement from pixelChecklist / compare_design_code as if this were a MasterGo design tree.`,
  ]
  const hints = [
    'This is an Axure/product page — read data.productBrief first (keyTexts / structure / styles / interactions).',
    htmlPath
      ? `Axure HTML at meta.axure.htmlPath=${htmlPath}. If geometry empty, call API reparse-axure or re-import; still use productBrief for product understanding.`
      : 'Re-import the Axure package after upgrading the HTML→geometry adapter (data-* / CSS #uN geometry).',
    'Skip space-between / sticky-footer / single-shell pixel bans until widgetCount > 0.',
  ]
  return { empty: true, reasons, warnings, hints }
}

const EXAMPLE_FIDELITY_NOTES = [
  'Put uniboot-design.json in the consumer repo (target/style/paths matching the real stack, e.g. element-plus + apps/operation/src/views).',
  'execute_code_plan is scaffold only — never ship its empty tables/placeholder copy.',
  'Visual QA: get_artboard_preview is the acceptance image; match layout, icons, colors, spacing — do not approximate with default el-alert / generic EP icons.',
  'Export icons via export_artboard_assets({ mode: "icons", nodeIds: keySpecs.iconNodeIds }).',
  'Apply keySpecs cssHints literally for pixel alignment.',
  'Finish with compare_design_code(implementedComponents + screenshot) — screenshot required.',
]

/** Walk full semantic tree (before prune) for copy / component inventory. */
export function collectDesignInventory(doc: SemDoc | null | undefined): DesignInventory {
  const texts: DesignInventory['texts'] = []
  const buttons: DesignInventory['buttons'] = []
  const icons: DesignInventory['icons'] = []
  const componentCounts = new Map<string, number>()
  let tables = 0
  let stubbedNodes = 0
  const buttonKeys = new Set<string>()

  const pushButton = (
    props: Record<string, unknown>,
    sourceNodeId?: string,
    nodeId?: string,
  ) => {
    const label =
      (typeof props.label === 'string' && props.label) ||
      (typeof props.content === 'string' && props.content) ||
      (typeof props.text === 'string' && props.text) ||
      ''
    const key = `${sourceNodeId ?? nodeId ?? ''}:${label}`
    if (buttonKeys.has(key)) return
    buttonKeys.add(key)
    buttons.push({ props, sourceNodeId, nodeId })
  }

  const walk = (node: SemNode | undefined) => {
    if (!node) return
    if (node.childrenStub) stubbedNodes += 1
    const name = node.component ?? 'Box'
    // Don't inflate component histogram with table cells as full Tables
    if (!(name === 'Table' && isTableCellNode(node))) {
      componentCounts.set(name, (componentCounts.get(name) ?? 0) + 1)
    } else {
      componentCounts.set('TableCell', (componentCounts.get('TableCell') ?? 0) + 1)
    }
    if (name === 'Text') {
      const content = node.props?.content
      if (typeof content === 'string' && content.trim()) {
        const trimmed = content.trim()
        // Drop SVG/path/HTML leaks that Axure sometimes embeds as "text"
        if (/^</.test(trimmed) || /<svg\b|<path\b|xmlns|stroke-width|fill-rule/i.test(trimmed)) {
          /* skip */
        } else {
          texts.push({
            content: trimmed,
            sourceNodeId: node.sourceNodeId,
            nodeId: node.id,
          })
          // MasterGo often paints CTA labels as Text — surface them as buttons
          if (BUTTON_LABEL_RE.test(trimmed)) {
            pushButton(
              { label: trimmed, inferred: true },
              node.sourceNodeId,
              node.id,
            )
          }
        }
      }
    } else if (name === 'Button') {
      pushButton({ ...(node.props ?? {}) }, node.sourceNodeId, node.id)
    } else if (name === 'Icon') {
      icons.push({ sourceNodeId: node.sourceNodeId, nodeId: node.id })
    } else if (isPageLevelTable(node)) {
      tables += 1
    }
    for (const kids of Object.values(node.slots ?? {})) {
      if (!Array.isArray(kids)) continue
      for (const k of kids) walk(k)
    }
  }

  walk(doc?.root)
  const components = [...componentCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  return { texts, buttons, icons, components, tables, stubbedNodes }
}

export const VISUAL_FIDELITY_STEPS = [
  '1. Treat data.preview as the acceptance screenshot — match it pixel-wise; do not approximate with existing page patterns.',
  '2. Obey data.layoutOutline.structureContract AND tick every data.pixelChecklist.acceptance item.',
  '3. Before toolbar/footer CSS: read keySpecs box.x/y + layoutIntent — FORBIDDEN default space-between or sticky white footer unless checklist/fills allow.',
  '4. Apply data.keySpecs[].cssHints / box / spacing / typography literally (px values) — do not invent Element Plus defaults.',
  '5. export_artboard_assets({ mode: "icons", nodeIds: data.keySpecs.iconNodeIds }) → get_assets → save under paths.assets.',
  '6. Hand-write against repo conventions. execute_code_plan is scaffold only.',
  '7. QA in the SAME product state as the design (usually edit, not mode=detail readonly).',
  '8. REQUIRED: screenshot + implementedSource (page Vue/CSS) → compare_design_code — screenshot required; source enables hard ban lint (space-between / sticky white footer / single shell).',
]

/**
 * One-shot: resolve delivery URL + semantic page + inventory + project defaults.
 * Agents should call this when the user pastes a UniBoot Design link.
 */
export async function openDelivery(token: string, input: OpenDeliveryInput) {
  const warnings: string[] = []
  const hints: string[] = []
  const includePreview = input.includePreview !== false

  const resolved = await resolveLinkWithFile(token, input.link)

  const deliveryConfig = resolveDeliveryProjectConfig({
    config: input.config,
    packageJson: input.packageJson,
  })
  const projectConfig = {
    filename: deliveryConfig.filename,
    config: deliveryConfig.config,
    warnings: deliveryConfig.warnings,
    defaults: {
      ...deliveryConfig.defaults,
      notes: [
        ...(deliveryConfig.defaults.notes ?? []),
        ...(deliveryConfig.source !== 'provided' ? EXAMPLE_FIDELITY_NOTES : []),
      ],
    },
    source: deliveryConfig.source,
    stackHint: deliveryConfig.stackHint,
  }
  warnings.push(...deliveryConfig.warnings)

  let page: {
    status: string
    artboardId: string
    rev?: number
    pipelineRev?: number
    tokenSetId?: string | null
    previewResourceUri?: string
    document?: SemDoc
    error?: string | null
    truncated?: boolean
    width?: number
    height?: number
  } | null = null
  let inventory: DesignInventory | null = null
  let layoutOutline: LayoutOutline | null = null
  let keySpecs: KeySpecsBundle | null = null
  let pixelChecklist: PixelChecklist | null = null
  let acceptanceState: AcceptanceState | null = null
  let productBrief: Record<string, unknown> | null = null
  let emptyProductShell = false

  if (resolved.artboardId) {
    try {
      const row = await api<SemanticRow>(
        token,
        `/files/${resolved.fileId}/artboards/${resolved.artboardId}/semantic`,
      )
      if (row.status === 'ready' && row.document) {
        inventory = collectDesignInventory(row.document)
        layoutOutline = collectLayoutOutline(row.document)
        acceptanceState = inferAcceptanceState(inventory)
        warnings.push(...layoutOutline.warnings)
        const pruned = pruneSemanticDocument(row.document, {
          maxDepth: input.maxDepth ?? 6,
          maxNodes: input.maxNodes ?? 180,
        })
        const pageMeta = row.document.page as { name?: string; width?: number; height?: number } | undefined
        page = {
          status: row.status,
          artboardId: row.artboardId,
          rev: row.rev,
          pipelineRev: row.pipelineRev,
          tokenSetId: row.tokenSetId,
          previewResourceUri: previewResourceUri(resolved.fileId, resolved.artboardId),
          document: pruned.document,
          truncated: pruned.truncated,
          width: pageMeta?.width,
          height: pageMeta?.height,
        }
        hints.push(...pruned.hints)
        if (pruned.truncated) {
          hints.push(
            'Tree was pruned — use data.inventory + data.layoutOutline + data.keySpecs for structure/pixels; get_design_node for stubbed sections.',
          )
        }
        if (layoutOutline.cardCount >= 2) {
          hints.push(
            `STRUCTURE: ${layoutOutline.cardCount} cards/sections required — ${layoutOutline.contentFlow.map((c) => c.suggestedName).join(' → ')}`,
          )
        }

        try {
          const geom = await api<{
            root?: GeomNode
            meta?: { axure?: { widgetCount?: number; htmlPath?: string | null } }
          }>(
            token,
            `/files/${resolved.fileId}/artboards/${resolved.artboardId}/document${
              resolved.version != null ? `?version=${resolved.version}` : ''
            }`,
          )
          const emptyShell = detectEmptyProductShell({
            contentTab: resolved.contentTab,
            fileType: resolved.fileType,
            inventory,
            layoutOutline,
            geomRoot: geom.root ?? null,
            axureMeta: geom.meta?.axure ?? null,
          })
          if (emptyShell.empty) {
            emptyProductShell = true
            warnings.push(...emptyShell.warnings)
            hints.push(...emptyShell.hints)
            // Soft gate: keep outline for diagnostics but clear hard pixel bans
            pixelChecklist = {
              items: [
                {
                  id: 'product-shell-empty',
                  severity: 'must',
                  check: 'Axure/product geometry is non-empty (widgetCount > 0) before pixel implement',
                  rule: 'Use data.productBrief for product understanding; reparse-axure or re-import for geometry',
                  evidence: emptyShell.reasons.join('; '),
                },
              ],
              acceptance: [
                'Read data.productBrief (keyTexts / structure / styles / interactions) before coding flows',
                'Do not ship UI from empty product shell geometry',
              ],
              bans: [
                'FORBIDDEN: pretend empty Box is the full page design',
                'FORBIDDEN: invent layout from Element Plus defaults when widgetCount=0',
              ],
              requiredReads: [
                'data.productBrief',
                'data.warnings (PRODUCT SHELL EMPTY)',
                'meta.axure.htmlPath / POST /files/:id/reparse-axure',
              ],
            }
            keySpecs = {
              specs: [],
              iconNodeIds: [],
              note: 'keySpecs skipped: empty Axure/product geometry — use productBrief',
            }
          } else {
            keySpecs = collectKeySpecs({
              geomRoot: geom.root,
              layoutOutline,
              inventory,
            })
            pixelChecklist = buildPixelChecklist({
              layoutOutline,
              keySpecs: keySpecs.specs,
              inventory,
              pageWidth: pageMeta?.width ?? null,
            })
            if (keySpecs.specs.length) {
              hints.push(
                `PIXEL SPECS: ${keySpecs.specs.length} landmark cssHints ready — apply literally before styling with component library defaults.`,
              )
            } else {
              warnings.push(keySpecs.note)
            }
            if (pixelChecklist.bans.length) {
              hints.push(
                `HARD BANS: ${pixelChecklist.bans.slice(0, 4).join('; ')}${
                  pixelChecklist.bans.length > 4 ? '…' : ''
                }`,
              )
            }
            hints.push(
              `CHECKLIST: ${pixelChecklist.acceptance.length} must-pass items in data.pixelChecklist — do not ship until all ticked.`,
            )
            if (acceptanceState) {
              hints.push(
                `ACCEPTANCE STATE: ${acceptanceState.mode} (${acceptanceState.confidence}) — ${acceptanceState.qaHint}`,
              )
            }
          }
        } catch (err) {
          warnings.push(
            `keySpecs unavailable: ${err instanceof Error ? err.message : String(err)}; use get_design_spec per node`,
          )
          const emptyShell = detectEmptyProductShell({
            contentTab: resolved.contentTab,
            fileType: resolved.fileType,
            inventory,
            layoutOutline,
          })
          if (emptyShell.empty) {
            emptyProductShell = true
            warnings.push(...emptyShell.warnings)
            hints.push(...emptyShell.hints)
          }
          pixelChecklist = buildPixelChecklist({
            layoutOutline,
            inventory,
            pageWidth: pageMeta?.width ?? null,
          })
        }
      } else {
        page = {
          status: row.status,
          artboardId: row.artboardId,
          rev: row.rev,
          pipelineRev: row.pipelineRev,
          error: row.error,
        }
        hints.push(
          row.status === 'pending' || row.status === 'processing'
            ? 'Semantic pipeline still running; retry open_delivery in a few seconds'
            : 'Semantic unavailable; retry later or call get_design_context for legacy geometry',
        )
      }
    } catch (err) {
      warnings.push(
        `get_design_page failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  } else {
    hints.push(
      'Overview link (no artboardId). Call list_artboards and ask the user which page — do not guess.',
    )
  }

  let prds: PrdListItem[] = []
  try {
    const rows = await api<PrdListItem[]>(
      token,
      `/projects/${encodeURIComponent(resolved.projectId)}/prds`,
    )
    prds = (rows ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      updatedAt: r.updatedAt,
    }))
  } catch {
    /* optional */
  }

  let preview: {
    mimeType: string
    byteLength: number
    resourceUri: string
    sourceUrl: string
    blob?: string
    skippedImage?: boolean
    placeholder?: boolean
    previewSource?: string | null
    pixelAcceptable?: boolean
    previewGen?: number | null
    previewStale?: boolean
    canvasViews?: PreviewBlob['canvasViews']
    canvas?: PreviewBlob['canvas']
  } | null = null
  if (includePreview && resolved.artboardId) {
    try {
      const blob = await fetchArtboardPreview(token, resolved.fileId, resolved.artboardId, {
        version: resolved.version,
      })
      const raster = /^(image\/(png|jpe?g|gif|webp))$/i.test(blob.mimeType)
      preview = {
        mimeType: blob.mimeType,
        byteLength: blob.byteLength,
        resourceUri: previewResourceUri(resolved.fileId, resolved.artboardId, resolved.version),
        sourceUrl: blob.sourceUrl,
        placeholder: blob.placeholder,
        previewSource: blob.previewSource,
        pixelAcceptable: blob.pixelAcceptable,
        previewGen: blob.previewGen,
        previewStale: blob.previewStale,
        canvasViews: blob.canvasViews,
        canvas: blob.canvas,
        ...(raster ? { blob: blob.blob } : { skippedImage: true }),
      }
      if (!raster) {
        hints.push('Preview is not raster; open deliveryDetailUrl in browser for visual QA.')
      } else if (blob.pixelAcceptable === false || blob.previewSource === 'placeholder') {
        hints.unshift(
          `PREVIEW NOT PIXEL-ACCEPTABLE (source=${blob.previewSource ?? 'unknown'}) — do NOT use as compare_design_code acceptance image. Call POST /files/{fileId}/refresh-axure-previews or reparse-axure.`,
        )
        // Avoid attaching placeholder PNGs as multimodal "acceptance" images
        if (blob.previewSource === 'placeholder') {
          delete preview.blob
          preview.skippedImage = true
        }
      } else if (blob.previewStale) {
        hints.unshift(
          `Preview gen is stale (gen=${blob.previewGen ?? 'missing'}) — POST /files/{fileId}/refresh-axure-previews to regenerate full-canvas PNGs.`,
        )
        hints.push(
          'Preview image attached — this is the visual acceptance standard. Do not replace designed icons with generic Element Plus icons without exporting slices.',
        )
      } else {
        hints.push(
          'Preview image attached — this is the visual acceptance standard. Do not replace designed icons with generic Element Plus icons without exporting slices.',
        )
      }
      if (blob.canvasViews?.length) {
        hints.unshift(
          `CANVAS VIEWS (${blob.canvasViews.length}): ${blob.canvasViews
            .map(
              (v) =>
                `${v.kind}:${v.label}@(${v.clip.x},${v.clip.y},${v.clip.width}×${v.clip.height})`,
            )
            .join(' | ')} — inspect regions separately; full_canvas is the delivery PNG.`,
        )
      }
    } catch (err) {
      warnings.push(
        `preview fetch failed: ${err instanceof Error ? err.message : String(err)}; call get_artboard_preview`,
      )
    }
  }

  // Product / Axure: always try to attach productBrief (works even when geometry empty)
  const isProductDelivery =
    resolved.contentTab === 'product' ||
    resolved.fileType === 'product' ||
    emptyProductShell
  if (isProductDelivery && resolved.artboardId && resolved.fileId) {
    try {
      const brief = await api<Record<string, unknown>>(
        token,
        `/files/${resolved.fileId}/artboards/${resolved.artboardId}/product-brief${
          resolved.version != null ? `?version=${resolved.version}` : ''
        }`,
      )
      productBrief = brief
      const texts = Array.isArray(brief.keyTexts) ? brief.keyTexts.length : 0
      const structs = Array.isArray(brief.structure) ? brief.structure.length : 0
      hints.unshift(
        `PRODUCT BRIEF: ${texts} keyTexts, ${structs} structure sections — use for flows/fields before pixel work.`,
      )
      if (emptyProductShell) {
        hints.unshift(
          'Geometry empty: implement/review from data.productBrief; POST /files/{fileId}/reparse-axure to recover widgets.',
        )
      }

      // Dampen inflated Axure white-rect cardCount using productBrief.suggestedCardCount
      const suggested =
        typeof brief.suggestedCardCount === 'number' ? brief.suggestedCardCount : null
      const denseOutline = Boolean(layoutOutline && layoutOutline.contentFlow.length > 40)
      const shouldDampen =
        layoutOutline &&
        suggested != null &&
        suggested >= 0 &&
        (layoutOutline.cardCount > Math.max(suggested * 2, 6) || denseOutline)

      if (shouldDampen && layoutOutline) {
        const prev = layoutOutline.cardCount
        const dampenedCount = Math.max(suggested ?? 1, 1)
        layoutOutline = {
          ...layoutOutline,
          cardCount: dampenedCount,
          warnings: layoutOutline.warnings.filter((w) => !/separate content cards/i.test(w)),
          structureContract: [
            `Product structure (use productBrief): ${(Array.isArray(brief.structure) ? brief.structure : [])
              .map((s: { label?: string; kind?: string }) => s.label || s.kind)
              .filter(Boolean)
              .join(' → ')}`,
            `Prefer suggestedCardCount=${dampenedCount} over raw layoutOutline cardCount=${prev} (Axure white-rects inflate counts).`,
            'Validate structure against open_delivery preview before finishing.',
            ...layoutOutline.structureContract.filter(
              (c) =>
                !/Render \d+ separate content sections/i.test(c) &&
                !/Validate structure against open_delivery preview/i.test(c),
            ),
          ],
        }
        // Outer warnings were copied before dampen — keep them in sync
        for (let i = warnings.length - 1; i >= 0; i--) {
          if (/separate content cards/i.test(warnings[i]!)) warnings.splice(i, 1)
        }
        warnings.push(
          `CARD COUNT dampened ${prev} → ${dampenedCount} (productBrief.suggestedCardCount; ignore Axure white-rect inflation).`,
        )
        hints.unshift(
          `CARD COUNT: dampened ${prev} → ${layoutOutline.cardCount} via productBrief.suggestedCardCount (ignore white-rect inflation).`,
        )

        // Rebuild pixel checklist so acceptance count matches dampened cardCount
        if (!emptyProductShell && keySpecs) {
          pixelChecklist = buildPixelChecklist({
            layoutOutline,
            keySpecs: keySpecs.specs,
            inventory,
            pageWidth: page?.width ?? null,
          })
        }
      }

      if (denseOutline && isProductDelivery) {
        warnings.push(
          'Semantic outline is dense/noisy for Axure — prefer data.preview + data.productBrief; treat keySpecs/contentFlow as hints only.',
        )
        hints.unshift(
          'PRODUCT MODE: implement from preview + productBrief (+ notes); do not invent N cards from raw contentFlow length.',
        )
      }

      // Prefer productBrief acceptance for Axure — inventory alone over-labels edit
      if (isProductDelivery) {
        const fromBrief = inferAcceptanceStateFromProductBrief({
          buttons: Array.isArray(brief.buttons) ? (brief.buttons as string[]) : [],
          keyTexts: Array.isArray(brief.keyTexts) ? (brief.keyTexts as string[]) : [],
          interactions: Array.isArray(brief.interactions)
            ? (brief.interactions as Array<{ kind?: string; label?: string; detail?: string }>)
            : [],
          structure: Array.isArray(brief.structure)
            ? (brief.structure as Array<{ kind?: string; label?: string }>)
            : [],
          fields: Array.isArray(brief.fields)
            ? (brief.fields as Array<{ name?: string; required?: boolean }>)
            : [],
          pageName: typeof brief.pageName === 'string' ? brief.pageName : undefined,
          states: Array.isArray(brief.states)
            ? (brief.states as Array<{ id?: string; kind?: string; label?: string }>)
            : undefined,
        })
        if (fromBrief) {
          acceptanceState = fromBrief
          hints.unshift(
            `ACCEPTANCE STATE: ${fromBrief.mode} (${fromBrief.confidence}) — ${fromBrief.qaHint}`,
          )
          if (fromBrief.canvasZones?.length) {
            hints.unshift(
              `CANVAS ZONES: ${fromBrief.canvasZones.map((z) => `${z.kind}:${z.label}`).join(' | ')}`,
            )
          }
        }
      } else if (!acceptanceState || acceptanceState.mode === 'unknown') {
        const fromBrief = inferAcceptanceStateFromProductBrief({
          buttons: Array.isArray(brief.buttons) ? (brief.buttons as string[]) : [],
          keyTexts: Array.isArray(brief.keyTexts) ? (brief.keyTexts as string[]) : [],
          interactions: Array.isArray(brief.interactions)
            ? (brief.interactions as Array<{ kind?: string; label?: string; detail?: string }>)
            : [],
          structure: Array.isArray(brief.structure)
            ? (brief.structure as Array<{ kind?: string; label?: string }>)
            : [],
          fields: Array.isArray(brief.fields)
            ? (brief.fields as Array<{ name?: string; required?: boolean }>)
            : [],
          pageName: typeof brief.pageName === 'string' ? brief.pageName : undefined,
        })
        if (fromBrief) {
          acceptanceState = fromBrief
          hints.unshift(
            `ACCEPTANCE STATE: ${fromBrief.mode} (${fromBrief.confidence}) — ${fromBrief.qaHint}`,
          )
        }
      }
    } catch (err) {
      warnings.push(
        `productBrief unavailable: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  if (!emptyProductShell) {
    hints.push(...VISUAL_FIDELITY_STEPS)
  } else {
    hints.push(
      'Product mode (empty geometry): do NOT run compare_design_code pixel QA until reparse yields widgetCount>0.',
    )
  }
  hints.push(
    'Skip get_prd unless the user gave a prdId or you pick one from data.prds.',
  )

  const assetsHint = {
    tool: 'export_artboard_assets',
    fileId: resolved.fileId,
    artboardId: resolved.artboardId,
    mode: 'icons' as const,
    nodeIds: keySpecs?.iconNodeIds ?? [],
    note: 'Prefer mode=icons with nodeIds from keySpecs.iconNodeIds; then get_assets({ jobId })',
  }

  const keySpecsSummary =
    keySpecs?.specs.map((s) => ({
      sourceNodeId: s.sourceNodeId,
      role: s.role,
      box: s.box,
      relative: s.relative,
      layoutIntent: s.layoutIntent ?? null,
      cssHints: s.cssHints,
      fills: s.fills,
    })) ?? null

  const next = !resolved.artboardId
    ? {
        tool: 'list_artboards',
        fileId: resolved.fileId,
        note: 'Ask user which page; do not guess',
      }
    : page?.status !== 'ready'
      ? {
          tool: 'open_delivery',
          note: 'Retry when semantic ready, or get_design_context as fallback',
        }
      : emptyProductShell
        ? {
            action: 'product-understand',
            steps: [
              '1. Read data.productBrief (keyTexts, buttons, structure, styles, interactions).',
              '2. Map fields/flows/dialogs from brief — treat like PRD, not MasterGo pixels.',
              '3. POST /api/v1/files/{fileId}/reparse-axure then re-open_delivery for geometry.',
              '4. Only after widgetCount>0: follow pixel checklist + compare_design_code.',
            ],
            productBriefSummary: productBrief
              ? {
                  keyTextCount: Array.isArray(productBrief.keyTexts)
                    ? productBrief.keyTexts.length
                    : 0,
                  structure: productBrief.structure,
                  buttonCount: Array.isArray(productBrief.buttons)
                    ? productBrief.buttons.length
                    : 0,
                  interactionCount: Array.isArray(productBrief.interactions)
                    ? productBrief.interactions.length
                    : 0,
                  widgetCount: productBrief.widgetCount ?? 0,
                }
              : null,
            reparse: {
              method: 'POST',
              path: `/files/${resolved.fileId}/reparse-axure`,
            },
          }
        : {
            action: 'implement-with-pixel-qa',
            steps: VISUAL_FIDELITY_STEPS,
            structureContract: layoutOutline?.structureContract ?? [],
            contentFlow: layoutOutline?.contentFlow ?? [],
            keySpecCount: keySpecs?.specs.length ?? 0,
            acceptanceState,
            pixelChecklist: pixelChecklist
              ? {
                  bans: pixelChecklist.bans,
                  acceptance: pixelChecklist.acceptance,
                  mustCount: pixelChecklist.items.filter((i) => i.severity === 'must').length,
                }
              : null,
            compareRequired: {
              tool: 'compare_design_code',
              requireScreenshot: true,
              requireImplementedSource: true,
              note: 'Pixel QA incomplete without screenshot; ban lint incomplete without implementedSource',
            },
            assets: assetsHint,
            productBrief: productBrief
              ? {
                  keyTextCount: Array.isArray(productBrief.keyTexts)
                    ? productBrief.keyTexts.length
                    : 0,
                  structure: productBrief.structure,
                }
              : null,
          }

  /** Gate fields first so Agents see bans even if response is truncated. */
  return {
    /** Read first — hard acceptance before implementing */
    gate: {
      pixelChecklist,
      acceptanceState,
      structureContract: layoutOutline?.structureContract ?? [],
      keySpecsSummary,
      bans: pixelChecklist?.bans ?? [],
      productMode: isProductDelivery,
      emptyProductShell,
      compareRequired: emptyProductShell
        ? {
            tool: 'compare_design_code',
            require: [],
            note: 'Skip pixel compare until geometry recovered; use productBrief first',
          }
        : {
            tool: 'compare_design_code',
            require: ['screenshot', 'implementedComponents', 'implementedSource'],
            note: 'screenshot for pixels; implementedSource for ban lint (space-between / sticky footer / shell)',
          },
    },
    projectId: resolved.projectId,
    fileId: resolved.fileId,
    version: resolved.version ?? null,
    artboardId: resolved.artboardId ?? null,
    pageName: resolved.pageName ?? (page?.document?.page as { name?: string } | undefined)?.name ?? null,
    deliveryMode: resolved.deliveryMode,
    deliveryDetailUrl: resolved.deliveryDetailUrl ?? null,
    contentTab: resolved.contentTab,
    fileType: resolved.fileType,
    files: resolved.files.map((f) => ({ id: f.id, name: f.name, type: f.type })),
    projectConfig,
    acceptanceState,
    pixelChecklist,
    keySpecs,
    layoutOutline,
    inventory,
    productBrief,
    page,
    preview: preview
      ? {
          mimeType: preview.mimeType,
          byteLength: preview.byteLength,
          resourceUri: preview.resourceUri,
          sourceUrl: preview.sourceUrl,
          skippedImage: preview.skippedImage ?? false,
          hasImagePayload: Boolean(preview.blob),
          placeholder: preview.placeholder ?? false,
          previewSource: preview.previewSource ?? null,
          pixelAcceptable: preview.pixelAcceptable ?? false,
          previewGen: preview.previewGen ?? null,
          previewStale: preview.previewStale ?? false,
          canvas: preview.canvas ?? null,
          canvasViews: preview.canvasViews ?? null,
        }
      : null,
    /** Internal: base64 for multimodal MCP content (stripped from JSON text if attached). */
    _previewBlob: preview?.blob,
    _previewMime: preview?.mimeType,
    prds,
    assets: assetsHint,
    visualFidelity: emptyProductShell ? [] : VISUAL_FIDELITY_STEPS,
    warnings: [...resolved.warnings, ...warnings],
    next,
    hints,
  }
}
