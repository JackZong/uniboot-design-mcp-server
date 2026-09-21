import { describe, expect, it } from 'vitest'
import { collectKeySpecs, type GeomNode } from './key-specs'
import type { LayoutOutline } from './layout-outline'

describe('collectKeySpecs', () => {
  it('emits cssHints for layout landmarks', () => {
    const root: GeomNode = {
      id: 'root',
      children: [
        {
          id: 'card1',
          name: 'stats',
          box: { x: 260, y: 80, width: 1120, height: 160 },
          style: {
            backgroundColor: '#ffffff',
            borderRadius: 8,
            paddingTop: 16,
            paddingRight: 24,
            paddingBottom: 16,
            paddingLeft: 24,
            gap: 12,
          },
        },
        {
          id: 'icon1',
          box: { x: 280, y: 100, width: 40, height: 40 },
          style: {},
        },
      ],
    }
    const layoutOutline: LayoutOutline = {
      sections: [
        {
          role: 'stats',
          suggestedName: 'card-stats',
          label: '上卡',
          component: 'Card',
          sourceNodeId: 'card1',
          contains: ['Card'],
          textsSample: [],
          keepSeparate: true,
        },
      ],
      contentFlow: [],
      structureContract: [],
      cardCount: 1,
      warnings: [],
    }
    const bundle = collectKeySpecs({
      geomRoot: root,
      layoutOutline,
      inventory: {
        texts: [],
        buttons: [],
        icons: [{ sourceNodeId: 'icon1' }],
      },
    })
    expect(bundle.specs.length).toBeGreaterThanOrEqual(2)
    const card = bundle.specs.find((s) => s.sourceNodeId === 'card1')
    expect(card?.cssHints.join('; ')).toMatch(/width: 1120px/)
    expect(card?.cssHints.join('; ')).toMatch(/border-radius: 8px/)
    expect(card?.cssHints.join('; ')).toMatch(/padding-top: 16px/)
    expect(bundle.iconNodeIds).toContain('icon1')
  })

  it('annotates layoutIntent start when title and button share left x', () => {
    const root: GeomNode = {
      id: 'root',
      children: [
        {
          id: 'title1',
          box: { x: 260, y: 200, width: 80, height: 22 },
          style: {},
        },
        {
          id: 'btn1',
          box: { x: 260, y: 204, width: 96, height: 32 },
          style: { backgroundColor: '#039fff' },
        },
      ],
    }
    const bundle = collectKeySpecs({
      geomRoot: root,
      inventory: {
        texts: [{ content: '冲突列表', sourceNodeId: 'title1' }],
        buttons: [{ props: { label: '批量处理' }, sourceNodeId: 'btn1' }],
        icons: [],
      },
    })
    const btn = bundle.specs.find((s) => s.sourceNodeId === 'btn1')
    expect(btn?.layoutIntent?.horizontal).toBe('start')
    expect(btn?.cssHints.join(' ')).toMatch(/flex-start/)
    expect(btn?.cssHints.join(' ')).toMatch(/space-between/)
    expect(btn?.relative?.titleSourceNodeId).toBe('title1')
    expect(btn?.relative?.gapAfterTitle).toBeNull()
  })

  it('sets gapAfterTitle when button sits to the right of title', () => {
    const root: GeomNode = {
      id: 'root',
      children: [
        {
          id: 'title1',
          box: { x: 260, y: 200, width: 80, height: 22 },
          style: {},
        },
        {
          id: 'btn1',
          box: { x: 356, y: 196, width: 96, height: 32 },
          style: {},
        },
      ],
    }
    const bundle = collectKeySpecs({
      geomRoot: root,
      inventory: {
        texts: [{ content: '冲突列表', sourceNodeId: 'title1' }],
        buttons: [{ props: { label: '批量处理' }, sourceNodeId: 'btn1' }],
        icons: [],
      },
    })
    const btn = bundle.specs.find((s) => s.sourceNodeId === 'btn1')
    expect(btn?.layoutIntent?.horizontal).toBe('start')
    expect(btn?.relative?.gapAfterTitle).toBe(16)
  })

  it('computes parent-relative offsets', () => {
    const root: GeomNode = {
      id: 'card',
      box: { x: 200, y: 100, width: 1000, height: 400 },
      children: [
        {
          id: 'btn1',
          box: { x: 224, y: 116, width: 96, height: 32 },
          style: {},
        },
      ],
    }
    const bundle = collectKeySpecs({
      geomRoot: root,
      inventory: {
        texts: [],
        buttons: [{ props: {}, sourceNodeId: 'btn1' }],
        icons: [],
      },
    })
    const btn = bundle.specs.find((s) => s.sourceNodeId === 'btn1')
    expect(btn?.relative?.parentId).toBe('card')
    expect(btn?.relative?.offsetLeft).toBe(24)
    expect(btn?.relative?.offsetTop).toBe(16)
  })
})
