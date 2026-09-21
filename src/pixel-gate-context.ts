import { api } from './api.js'
import type { SemDoc } from './budget.js'
import { collectDesignInventory } from './open-delivery.js'
import { collectLayoutOutline } from './layout-outline.js'
import { collectKeySpecs, type GeomNode } from './key-specs.js'
import { buildPixelChecklist, type PixelChecklist } from './pixel-checklist.js'
import { inferAcceptanceState, type AcceptanceState } from './acceptance-state.js'

type SemanticRow = {
  status: string
  document: SemDoc | null
}

/**
 * Rebuild pixelChecklist + acceptanceState for compare_design_code
 * so Agents do not have to re-pass open_delivery gate fields.
 */
export async function loadPixelGateContext(
  token: string,
  opts: { fileId: string; artboardId: string; version?: number },
): Promise<{
  pixelChecklist: PixelChecklist | null
  acceptanceState: AcceptanceState | null
  cardCount: number
}> {
  try {
    const row = await api<SemanticRow>(
      token,
      `/files/${opts.fileId}/artboards/${opts.artboardId}/semantic`,
    )
    if (row.status !== 'ready' || !row.document) {
      return { pixelChecklist: null, acceptanceState: null, cardCount: 0 }
    }
    const inventory = collectDesignInventory(row.document)
    const layoutOutline = collectLayoutOutline(row.document)
    const pageMeta = row.document.page as { width?: number } | undefined
    let keySpecs = null
    try {
      const geom = await api<{ root?: GeomNode }>(
        token,
        `/files/${opts.fileId}/artboards/${opts.artboardId}/document${
          opts.version != null ? `?version=${opts.version}` : ''
        }`,
      )
      keySpecs = collectKeySpecs({
        geomRoot: geom.root,
        layoutOutline,
        inventory,
      })
    } catch {
      /* geometry optional */
    }
    const pixelChecklist = buildPixelChecklist({
      layoutOutline,
      keySpecs: keySpecs?.specs ?? null,
      inventory,
      pageWidth: pageMeta?.width ?? null,
    })
    return {
      pixelChecklist,
      acceptanceState: inferAcceptanceState(inventory),
      cardCount: layoutOutline.cardCount,
    }
  } catch {
    return { pixelChecklist: null, acceptanceState: null, cardCount: 0 }
  }
}
