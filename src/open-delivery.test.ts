import { describe, expect, it } from 'vitest'
import {
  collectDesignInventory,
  detectEmptyProductShell,
  looksLikeDeliveryUrl,
  pickDeliveryLink,
  VISUAL_FIDELITY_STEPS,
} from './open-delivery'
import type { SemDoc } from './budget'

describe('pickDeliveryLink', () => {
  it('prefers link over url', () => {
    expect(
      pickDeliveryLink({
        link: 'http://a/project/design/p1?fileId=f1&artboardId=a1',
        url: 'http://b/project/design/p2',
      }),
    ).toContain('p1')
  })

  it('accepts url alias', () => {
    expect(pickDeliveryLink({ url: '  http://host/project/design/x  ' })).toBe(
      'http://host/project/design/x',
    )
  })

  it('returns undefined when empty', () => {
    expect(pickDeliveryLink({})).toBeUndefined()
    expect(pickDeliveryLink({ link: '  ' })).toBeUndefined()
  })
})

describe('looksLikeDeliveryUrl', () => {
  it('detects design delivery URLs', () => {
    expect(
      looksLikeDeliveryUrl(
        'http://192.168.10.68:5173/project/design/cmtl5zbk3000157rrpz5y8olv?artboardId=a&fileId=f',
      ),
    ).toBe(true)
  })

  it('rejects plain strings', () => {
    expect(looksLikeDeliveryUrl('not-a-url')).toBe(false)
    expect(looksLikeDeliveryUrl({ url: 'x' })).toBe(false)
  })
})

describe('collectDesignInventory', () => {
  it('collects texts buttons icons before prune', () => {
    const doc: SemDoc = {
      id: 'sem_1',
      artboardId: 'ab',
      root: {
        id: 'r',
        component: 'Box',
        slots: {
          default: [
            {
              id: 't1',
              component: 'Text',
              props: { content: '还有 3 项冲突未裁决' },
              sourceNodeId: 'n1',
            },
            {
              id: 'b1',
              component: 'Button',
              props: { type: 'primary' },
              sourceNodeId: 'n2',
            },
            { id: 'i1', component: 'Icon', sourceNodeId: 'n3' },
            { id: 'tb', component: 'Table', childrenStub: { count: 10 } },
          ],
        },
      },
    }
    const inv = collectDesignInventory(doc)
    expect(inv.texts.map((t) => t.content)).toContain('还有 3 项冲突未裁决')
    expect(inv.buttons).toHaveLength(1)
    expect(inv.icons).toHaveLength(1)
    expect(inv.tables).toBe(1)
    expect(inv.stubbedNodes).toBe(1)
    expect(inv.components.some((c) => c.name === 'Text')).toBe(true)
  })

  it('infers buttons from CTA text and ignores table cells in tables count', () => {
    const doc: SemDoc = {
      root: {
        id: 'r',
        component: 'Box',
        slots: {
          default: [
            { id: 'q', component: 'Text', props: { content: '查询' }, sourceNodeId: 'tq' },
            { id: 'z', component: 'Text', props: { content: '重置' }, sourceNodeId: 'tz' },
            { id: 'page', component: 'Table', sourceNodeId: 'tbl' },
            {
              id: 'cell',
              component: 'Table',
              props: { 表格类型: '文字', '表格类型[Zz]': '文字' },
              sourceNodeId: 'cell1',
            },
          ],
        },
      },
    }
    const inv = collectDesignInventory(doc)
    expect(inv.buttons.map((b) => b.props.label)).toEqual(
      expect.arrayContaining(['查询', '重置']),
    )
    expect(inv.tables).toBe(1)
    expect(inv.components.some((c) => c.name === 'TableCell')).toBe(true)
  })
})

describe('VISUAL_FIDELITY_STEPS', () => {
  it('includes preview, structure, keySpecs, checklist bans, and compare screenshot', () => {
    const joined = VISUAL_FIDELITY_STEPS.join(' ')
    expect(joined).toMatch(/preview/i)
    expect(joined).toMatch(/structureContract|layoutOutline|pixelChecklist/)
    expect(joined).toMatch(/keySpecs|cssHints|layoutIntent/)
    expect(joined).toMatch(/space-between|sticky white footer/)
    expect(joined).toMatch(/export_artboard_assets|icons/)
    expect(joined).toMatch(/compare_design_code/)
    expect(joined).toMatch(/screenshot/)
    expect(joined).toMatch(/implementedSource|ban/i)
    expect(joined).toMatch(/mode=detail|product state|edit/i)
  })
})

describe('detectEmptyProductShell', () => {
  it('flags product pages with empty inventory + empty geom', () => {
    const report = detectEmptyProductShell({
      contentTab: 'product',
      inventory: {
        texts: [],
        buttons: [],
        icons: [],
        components: [{ name: 'Box', count: 1 }],
        tables: 0,
        stubbedNodes: 0,
      },
      layoutOutline: {
        sections: [],
        contentFlow: [],
        structureContract: [],
        cardCount: 0,
        warnings: [],
      },
      geomRoot: { children: [], type: 'FRAME' },
      axureMeta: { widgetCount: 0, htmlPath: '登录界面.html' },
    })
    expect(report.empty).toBe(true)
    expect(report.warnings[0]).toMatch(/PRODUCT SHELL EMPTY/)
    expect(report.hints.some((h) => /htmlPath=登录界面/.test(h))).toBe(true)
  })

  it('does not flag design pages with content', () => {
    const report = detectEmptyProductShell({
      contentTab: 'design',
      inventory: {
        texts: [{ content: '查询' }],
        buttons: [],
        icons: [],
        components: [{ name: 'Text', count: 1 }],
        tables: 0,
        stubbedNodes: 0,
      },
      layoutOutline: {
        sections: [],
        contentFlow: [],
        structureContract: [],
        cardCount: 1,
        warnings: [],
      },
    })
    expect(report.empty).toBe(false)
  })
})
