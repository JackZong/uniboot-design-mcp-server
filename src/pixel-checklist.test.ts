import { describe, expect, it } from 'vitest'
import { buildPixelChecklist } from './pixel-checklist'
import type { KeySpec } from './key-specs'
import type { LayoutOutline } from './layout-outline'

function spec(
  id: string,
  role: string,
  box: { x: number; y: number; width?: number; height?: number },
  fills?: { backgroundColor?: string | null },
): KeySpec {
  return {
    sourceNodeId: id,
    role,
    box: {
      x: box.x,
      y: box.y,
      width: box.width ?? 100,
      height: box.height ?? 32,
    },
    spacing: {
      paddingTop: null,
      paddingRight: null,
      paddingBottom: null,
      paddingLeft: null,
      gap: null,
    },
    typography: {
      fontSize: null,
      fontWeight: null,
      fontFamily: null,
      lineHeight: null,
      letterSpacing: null,
      textAlign: null,
      color: null,
    },
    fills: {
      backgroundColor: fills?.backgroundColor ?? null,
      opacity: null,
    },
    border: {
      borderColor: null,
      borderWidth: null,
      borderRadius: null,
    },
    cssHints: [],
  }
}

describe('buildPixelChecklist', () => {
  it('bans single shell when cardCount>=2 and left-aligned toolbar space-between', () => {
    const layoutOutline: LayoutOutline = {
      sections: [
        {
          role: 'stats',
          suggestedName: 'card-stats',
          label: '上卡',
          component: 'Card',
          sourceNodeId: 'c1',
          contains: ['Card'],
          textsSample: [],
          keepSeparate: true,
        },
        {
          role: 'alert',
          suggestedName: 'alert-rule',
          label: '规则',
          component: 'Alert',
          sourceNodeId: 'a1',
          contains: ['Alert'],
          textsSample: [],
          keepSeparate: true,
        },
        {
          role: 'table',
          suggestedName: 'card-table',
          label: '下卡',
          component: 'Card',
          sourceNodeId: 'c2',
          contains: ['Card', 'Table'],
          textsSample: [],
          keepSeparate: true,
        },
        {
          role: 'actions',
          suggestedName: 'footer-actions',
          label: '底栏',
          component: 'Button',
          sourceNodeId: 'f1',
          contains: ['Button'],
          textsSample: [],
          keepSeparate: false,
        },
      ],
      contentFlow: [
        { role: 'stats', suggestedName: 'card-stats', sourceNodeId: 'c1' },
        { role: 'alert', suggestedName: 'alert-rule', sourceNodeId: 'a1' },
        { role: 'table', suggestedName: 'card-table', sourceNodeId: 'c2' },
      ],
      structureContract: ['2 cards', 'alert standalone'],
      cardCount: 2,
      warnings: [],
    }

    const checklist = buildPixelChecklist({
      layoutOutline,
      keySpecs: [
        spec('title1', 'text', { x: 260, y: 200 }),
        spec('btn1', 'button', { x: 260, y: 204 }),
        spec('fbtn', 'button', { x: 280, y: 900 }),
      ],
      inventory: {
        texts: [{ content: '冲突列表', sourceNodeId: 'title1' }],
        buttons: [
          { props: { label: '批量处理' }, sourceNodeId: 'btn1' },
          { props: { label: '确认' }, sourceNodeId: 'fbtn' },
        ],
        icons: [],
      },
      pageWidth: 1440,
    })

    expect(checklist.bans.some((b) => /single page-body|shell/i.test(b))).toBe(true)
    expect(checklist.bans.some((b) => /space-between/i.test(b))).toBe(true)
    expect(checklist.bans.some((b) => /sticky white footer/i.test(b))).toBe(true)
    expect(checklist.items.some((i) => i.id.startsWith('toolbar-left'))).toBe(true)
    expect(checklist.items.some((i) => i.id === 'footer-no-white-card')).toBe(true)
    expect(checklist.acceptance.length).toBeGreaterThan(3)
  })

  it('allows end alignment when button is on the right', () => {
    const checklist = buildPixelChecklist({
      keySpecs: [spec('btn1', 'button', { x: 1200, y: 100 })],
      inventory: {
        texts: [],
        buttons: [{ props: {}, sourceNodeId: 'btn1' }],
        icons: [],
      },
      pageWidth: 1440,
    })
    expect(checklist.items.some((i) => i.id.startsWith('toolbar-right'))).toBe(true)
    expect(checklist.items.some((i) => i.id.startsWith('toolbar-left'))).toBe(false)
  })
})
