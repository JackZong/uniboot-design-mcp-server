import { describe, expect, it } from 'vitest'
import { collectKeySpecs } from './key-specs'
import { buildPixelChecklist } from './pixel-checklist'
import { inferAcceptanceState } from './acceptance-state'
import { lintImplementedAgainstChecklist } from './lint-implemented'
import {
  CONFLICT_ADJUDICATION_GEOM,
  CONFLICT_ADJUDICATION_INVENTORY,
  CONFLICT_ADJUDICATION_LAYOUT,
  CONFLICT_BAD_IMPLEMENTATION,
  CONFLICT_GOOD_IMPLEMENTATION,
} from './fixtures/conflict-adjudication'

/**
 * Regression lock for the conflict-adjudication failure modes:
 * single shell, space-between batch button, sticky white footer, wrong product state.
 */
describe('golden: conflict-adjudication gate', () => {
  const keySpecs = collectKeySpecs({
    geomRoot: CONFLICT_ADJUDICATION_GEOM,
    layoutOutline: CONFLICT_ADJUDICATION_LAYOUT,
    inventory: CONFLICT_ADJUDICATION_INVENTORY,
  })
  const checklist = buildPixelChecklist({
    layoutOutline: CONFLICT_ADJUDICATION_LAYOUT,
    keySpecs: keySpecs.specs,
    inventory: CONFLICT_ADJUDICATION_INVENTORY,
    pageWidth: 1440,
  })
  const acceptance = inferAcceptanceState(CONFLICT_ADJUDICATION_INVENTORY)

  it('requires 2 cards and standalone alert', () => {
    expect(CONFLICT_ADJUDICATION_LAYOUT.cardCount).toBe(2)
    expect(checklist.bans.join(' ')).toMatch(/shell|single page-body/i)
    expect(checklist.items.some((i) => i.id === 'alert-standalone')).toBe(true)
  })

  it('batch button is layoutIntent start (same left as title)', () => {
    const btn = keySpecs.specs.find((s) => s.sourceNodeId === 'btn-batch')
    expect(btn?.layoutIntent?.horizontal).toBe('start')
    expect(btn?.box.x).toBe(284)
    expect(checklist.items.some((i) => i.id.startsWith('toolbar-left'))).toBe(true)
  })

  it('footer has no fill → bans sticky white footer', () => {
    expect(checklist.items.some((i) => i.id === 'footer-no-white-card')).toBe(true)
    expect(checklist.bans.join(' ')).toMatch(/sticky white footer/i)
  })

  it('acceptance state is edit (not detail-only)', () => {
    expect(acceptance.mode).toBe('edit')
    expect(acceptance.qaHint).toMatch(/mode=detail/i)
  })

  it('bad implementation hard-fails ban lint', () => {
    const findings = lintImplementedAgainstChecklist(CONFLICT_BAD_IMPLEMENTATION, checklist)
    const codes = findings.map((f) => f.code)
    expect(codes).toContain('ban_space_between')
    expect(codes).toContain('ban_single_shell')
    expect(codes).toContain('ban_sticky_white_footer')
  })

  it('good implementation has no ban errors', () => {
    const findings = lintImplementedAgainstChecklist(CONFLICT_GOOD_IMPLEMENTATION, checklist)
    expect(findings.filter((f) => f.severity === 'error')).toHaveLength(0)
  })
})
