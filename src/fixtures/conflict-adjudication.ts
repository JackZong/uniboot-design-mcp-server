/**
 * Golden fixture: conflict-adjudication style page (2 cards, left batch button,
 * no white footer fill, edit-state copy). Used to regress gate / lint / layoutIntent.
 */
import type { LayoutOutline } from '../layout-outline.js'
import type { GeomNode, InventoryForSpecs } from '../key-specs.js'

export const CONFLICT_ADJUDICATION_INVENTORY: InventoryForSpecs = {
  texts: [
    { content: '还有 3 项冲突未裁决', sourceNodeId: 'text-banner' },
    { content: '冲突列表', sourceNodeId: 'text-title' },
    { content: '规则说明', sourceNodeId: 'text-rule' },
  ],
  buttons: [
    { props: { label: '批量处理' }, sourceNodeId: 'btn-batch' },
    { props: { label: '确认' }, sourceNodeId: 'btn-confirm' },
    { props: { label: '返回' }, sourceNodeId: 'btn-back' },
  ],
  icons: [{ sourceNodeId: 'icon-warn' }],
}

export const CONFLICT_ADJUDICATION_LAYOUT: LayoutOutline = {
  sections: [
    {
      role: 'stats',
      suggestedName: 'card-stats',
      label: '上卡',
      component: 'Card',
      sourceNodeId: 'card-stats',
      contains: ['Card', 'StatisticCard'],
      textsSample: ['还有 3 项冲突未裁决'],
      keepSeparate: true,
    },
    {
      role: 'alert',
      suggestedName: 'alert-rule',
      label: '规则条',
      component: 'Alert',
      sourceNodeId: 'alert-rule',
      contains: ['Alert'],
      textsSample: ['规则说明'],
      keepSeparate: true,
    },
    {
      role: 'table',
      suggestedName: 'card-table',
      label: '下卡',
      component: 'Card',
      sourceNodeId: 'card-table',
      contains: ['Card', 'Table', 'Button'],
      textsSample: ['冲突列表'],
      keepSeparate: true,
    },
    {
      role: 'actions',
      suggestedName: 'footer-actions',
      label: '底栏',
      component: 'Button',
      sourceNodeId: 'btn-confirm',
      contains: ['Button'],
      textsSample: ['确认', '返回'],
      keepSeparate: false,
    },
  ],
  contentFlow: [
    { role: 'stats', suggestedName: 'card-stats', label: '上卡', sourceNodeId: 'card-stats' },
    { role: 'alert', suggestedName: 'alert-rule', label: '规则条', sourceNodeId: 'alert-rule' },
    { role: 'table', suggestedName: 'card-table', label: '下卡', sourceNodeId: 'card-table' },
  ],
  structureContract: [
    'Keep 2 separate white cards (stats + table)',
    'Alert strip standalone between cards',
    'Footer actions inside lower card — not a third card',
  ],
  cardCount: 2,
  warnings: [],
}

/** Artboard absolute geometry matching the known failure modes. */
export const CONFLICT_ADJUDICATION_GEOM: GeomNode = {
  id: 'page',
  box: { x: 0, y: 0, width: 1440, height: 1024 },
  children: [
    {
      id: 'card-stats',
      name: 'stats',
      box: { x: 260, y: 80, width: 1120, height: 120 },
      style: {
        backgroundColor: '#ffffff',
        borderRadius: 8,
        paddingTop: 16,
        paddingLeft: 24,
      },
      children: [
        {
          id: 'text-banner',
          box: { x: 284, y: 100, width: 200, height: 22 },
          style: { fontSize: 14, color: '#333333' },
        },
        {
          id: 'icon-warn',
          box: { x: 284, y: 130, width: 20, height: 20 },
          style: {},
        },
      ],
    },
    {
      id: 'alert-rule',
      name: 'rule',
      box: { x: 260, y: 220, width: 1120, height: 48 },
      style: { backgroundColor: '#fff7e6', borderRadius: 4 },
      children: [
        {
          id: 'text-rule',
          box: { x: 284, y: 234, width: 300, height: 20 },
          style: { fontSize: 13 },
        },
      ],
    },
    {
      id: 'card-table',
      name: 'table',
      box: { x: 260, y: 288, width: 1120, height: 600 },
      style: {
        backgroundColor: '#ffffff',
        borderRadius: 8,
        paddingTop: 16,
        paddingLeft: 24,
      },
      children: [
        {
          id: 'text-title',
          box: { x: 284, y: 304, width: 80, height: 22 },
          style: { fontSize: 16, fontWeight: 600 },
        },
        {
          id: 'btn-batch',
          box: { x: 284, y: 304, width: 96, height: 32 },
          style: { backgroundColor: '#039fff', borderRadius: 4 },
        },
        {
          id: 'btn-confirm',
          box: { x: 284, y: 820, width: 88, height: 36 },
          style: { backgroundColor: '#039fff' },
        },
        {
          id: 'btn-back',
          box: { x: 388, y: 820, width: 72, height: 36 },
          style: {},
        },
      ],
    },
  ],
}

export const CONFLICT_BAD_IMPLEMENTATION = `
.conflict-shell {
  background: #fff;
  border-radius: 8px;
}
.toolbar {
  display: flex;
  justify-content: space-between;
}
.page-footer {
  position: sticky;
  bottom: 0;
  background: #ffffff;
  border-radius: 8px;
}
`

export const CONFLICT_GOOD_IMPLEMENTATION = `
.card-stats { background: #fff; border-radius: 8px; }
.alert-rule { background: #fff7e6; }
.card-table { background: #fff; border-radius: 8px; }
.toolbar {
  display: flex;
  justify-content: flex-start;
  gap: 12px;
}
.footer-actions {
  display: flex;
  gap: 12px;
}
`
