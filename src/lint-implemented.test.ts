import { describe, expect, it } from 'vitest'
import { lintImplementedAgainstChecklist, mergeCompareFindings } from './lint-implemented'
import type { PixelChecklist } from './pixel-checklist'

const checklist: PixelChecklist = {
  items: [
    {
      id: 'toolbar-left-btn1',
      severity: 'must',
      check: 'left toolbar',
      rule: 'flex-start',
    },
    {
      id: 'footer-no-white-card',
      severity: 'must',
      check: 'no white footer',
      rule: 'plain flex',
    },
    {
      id: 'card-count',
      severity: 'must',
      check: 'White content cards/sections count === 2',
      rule: 'separate cards',
    },
  ],
  bans: [
    'justify-content: space-between on title+batch toolbars unless box.x proves right alignment',
    'sticky white footer card without backgroundColor in keySpecs',
    'single page-body white card / conflict-shell wrapping stats+alert+table+footer',
  ],
  requiredReads: [],
  acceptance: [],
}

describe('lintImplementedAgainstChecklist', () => {
  it('errors on space-between when left toolbar is required', () => {
    const findings = lintImplementedAgainstChecklist(
      '.toolbar { display:flex; justify-content: space-between; }',
      checklist,
    )
    expect(findings.some((f) => f.code === 'ban_space_between' && f.severity === 'error')).toBe(
      true,
    )
  })

  it('errors on conflict-shell and sticky white footer', () => {
    const source = `
      .conflict-shell { background:#fff }
      .page-footer { position: sticky; background: #ffffff; }
    `
    const findings = lintImplementedAgainstChecklist(source, checklist)
    expect(findings.some((f) => f.code === 'ban_single_shell')).toBe(true)
    expect(findings.some((f) => f.code === 'ban_sticky_white_footer')).toBe(true)
  })

  it('warns when source empty', () => {
    const findings = lintImplementedAgainstChecklist('', checklist)
    expect(findings[0]?.code).toBe('implemented_source_empty')
  })

  it('merges findings into summary', () => {
    const merged = mergeCompareFindings(
      [{ severity: 'info', code: 'ok', message: 'x' }],
      [{ severity: 'error', code: 'ban_space_between', message: 'y' }],
    )
    expect(merged.summary.errors).toBe(1)
    expect(merged.summary.total).toBe(2)
  })
})
