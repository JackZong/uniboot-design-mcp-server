import { describe, expect, it } from 'vitest'
import { collectLayoutOutline } from './layout-outline'
import type { SemDoc } from './budget'
import {
  BUTTON_LABEL_RE,
  isTableCellNode,
  looksLikeStepsForm,
  subtreeHasPageTable,
} from './semantic-heuristics'

describe('collectLayoutOutline', () => {
  it('keeps stats card, alert, and table card separate', () => {
    const doc: SemDoc = {
      id: 'sem',
      artboardId: 'ab',
      root: {
        id: 'root',
        component: 'Box',
        slots: {
          default: [
            { id: 'crumb', component: 'Text', props: { content: '卡BIN / 冲突裁决' } },
            { id: 'menu', component: 'Menu', confidence: 1, slots: { default: [] } },
            {
              id: 'main',
              component: 'Box',
              slots: {
                default: [
                  {
                    id: 'top',
                    component: 'Card',
                    confidence: 0.6,
                    style: { tokens: { backgroundColor: 'color.bg' }, raw: {} },
                    slots: {
                      default: [
                        { id: 'fn', component: 'Text', props: { content: 'bin.csv' } },
                        { id: 'st', component: 'StatisticCard', props: { title: '冲突' } },
                      ],
                    },
                  },
                  {
                    id: 'rule',
                    component: 'Alert',
                    confidence: 0.95,
                    slots: {
                      default: [
                        {
                          id: 'rt',
                          component: 'Text',
                          props: { content: '以FirstData为准' },
                        },
                      ],
                    },
                  },
                  {
                    id: 'bottom',
                    component: 'Box',
                    style: { tokens: { backgroundColor: 'color.bg' }, raw: {} },
                    slots: {
                      default: [
                        { id: 'title', component: 'Text', props: { content: '冲突组明细' } },
                        { id: 'tbl', component: 'Table' },
                        { id: 'b1', component: 'Button', props: { type: 'default' } },
                        { id: 'b2', component: 'Button', props: { type: 'primary' } },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    }

    const outline = collectLayoutOutline(doc)
    expect(outline.cardCount).toBeGreaterThanOrEqual(2)
    expect(outline.sections.some((s) => s.role === 'alert')).toBe(true)
    expect(outline.structureContract.join(' ')).toMatch(/separate/i)
    expect(outline.structureContract.join(' ')).toMatch(/alert|strip|standalone/i)
    expect(outline.contentFlow.map((c) => c.role)).toEqual(expect.arrayContaining(['alert']))
  })

  it('warns when multiple cards detected', () => {
    const doc: SemDoc = {
      root: {
        id: 'r',
        component: 'Box',
        slots: {
          default: [
            {
              id: 'a',
              component: 'Card',
              confidence: 0.8,
              slots: { default: [{ id: 't', component: 'Table' }] },
            },
            {
              id: 'b',
              component: 'Card',
              confidence: 0.8,
              slots: {
                default: [
                  { id: 's', component: 'StatisticCard' },
                  { id: 'tx', component: 'Text', props: { content: '统计' } },
                ],
              },
            },
          ],
        },
      },
    }
    const outline = collectLayoutOutline(doc)
    expect(outline.warnings.some((w) => /Do NOT merge/i.test(w))).toBe(true)
  })

  it('does not count pagination-only or decorative white rect as cards', () => {
    const doc: SemDoc = {
      root: {
        id: 'r',
        component: 'Box',
        slots: {
          default: [
            {
              id: 'main',
              component: 'Box',
              slots: {
                default: [
                  {
                    id: 'decor',
                    component: 'Box',
                    style: { tokens: { backgroundColor: 'color.bg' }, raw: {} },
                    slots: {},
                  },
                  {
                    id: 'tbl',
                    component: 'Box',
                    style: { tokens: { backgroundColor: 'color.bg' }, raw: {} },
                    slots: {
                      default: [
                        { id: 'h', component: 'Text', props: { content: '渠道名称' } },
                        { id: 't', component: 'Table' },
                        {
                          id: 'c1',
                          component: 'Table',
                          props: { 表格类型: '文字', '表格类型[Zz]': '文字' },
                        },
                        {
                          id: 'c2',
                          component: 'Table',
                          props: { 表格类型: '状态', '表格类型[Zzl]': '状态' },
                        },
                      ],
                    },
                  },
                  { id: 'pager', component: 'Pagination', confidence: 0.95 },
                ],
              },
            },
          ],
        },
      },
    }
    const outline = collectLayoutOutline(doc)
    const tableSections = outline.sections.filter((s) => s.role === 'table')
    expect(tableSections.length).toBe(1)
    expect(outline.sections.every((s) => s.component !== 'Pagination' || s.role !== 'table')).toBe(
      true,
    )
    expect(outline.cardCount).toBe(1)
  })

  it('detects steps/sectioned audit form', () => {
    const doc: SemDoc = {
      root: {
        id: 'r',
        component: 'Box',
        slots: {
          default: [
            {
              id: 'body',
              component: 'Box',
              slots: {
                default: [
                  { id: 'n1', component: 'Text', props: { content: '1' } },
                  { id: 't1', component: 'Text', props: { content: '基础信息' } },
                  { id: 'n2', component: 'Text', props: { content: '2' } },
                  { id: 't2', component: 'Text', props: { content: '营业执照信息' } },
                  { id: 'n3', component: 'Text', props: { content: '3' } },
                  { id: 't3', component: 'Text', props: { content: '法人信息' } },
                  { id: 'n4', component: 'Text', props: { content: '4' } },
                  { id: 't4', component: 'Text', props: { content: '结算信息' } },
                  { id: 'f', component: 'Form' },
                  { id: 'i', component: 'Input' },
                ],
              },
            },
          ],
        },
      },
    }
    expect(looksLikeStepsForm(doc.root!.slots!.default![0]!)).toBe(true)
    const outline = collectLayoutOutline(doc)
    expect(outline.sections.some((s) => s.role === 'steps')).toBe(true)
    expect(outline.structureContract.join(' ')).toMatch(/stepper|sectioned|基础信息/i)
  })

  it('emits actions from button-like texts', () => {
    const doc: SemDoc = {
      root: {
        id: 'r',
        component: 'Box',
        slots: {
          default: [
            {
              id: 'card',
              component: 'Card',
              confidence: 0.9,
              slots: {
                default: [
                  { id: 't', component: 'Text', props: { content: '基础信息' } },
                  { id: 'a', component: 'Text', props: { content: '取消' } },
                  { id: 'b', component: 'Text', props: { content: '提交' } },
                ],
              },
            },
          ],
        },
      },
    }
    const outline = collectLayoutOutline(doc)
    expect(outline.sections.some((s) => s.role === 'actions')).toBe(true)
  })

  it('treats datetime Input top bar as chrome header', () => {
    const doc: SemDoc = {
      root: {
        id: 'r',
        component: 'Box',
        slots: {
          default: [
            {
              id: 'top',
              component: 'Input',
              confidence: 0.7,
              props: {
                type: 'text',
                placeholder: '2025-06-18 11:37:25 星期三',
              },
              style: { raw: { localWidth: '1220px', localHeight: '48px' } },
              slots: {},
            },
            {
              id: 'side',
              component: 'Menu',
              slots: {
                default: [{ id: 'm', component: 'Text', props: { content: '监控' } }],
              },
            },
          ],
        },
      },
    }
    const outline = collectLayoutOutline(doc)
    const top = outline.sections.find((s) => s.nodeId === 'top')
    expect(top?.role).toBe('chrome')
    expect(top?.suggestedName).toBe('layout-header')
    expect(outline.sections.some((s) => s.suggestedName === 'layout-aside')).toBe(true)
  })

  it('splits 关键规则 alert + Settement Date status cards', () => {
    const status = (id: string) => ({
      id,
      component: 'Box' as const,
      slots: {
        default: [
          {
            id: `${id}-t`,
            component: 'Text' as const,
            props: { content: 'Settement Date：2026-09-03' },
          },
          {
            id: `${id}-f`,
            component: 'Text' as const,
            props: { content: 'KlondPay_80_20260903_001001.dat' },
          },
          { id: `${id}-tag`, component: 'Tag' as const },
        ],
      },
    })
    const doc: SemDoc = {
      root: {
        id: 'r',
        component: 'Box',
        slots: {
          default: [
            {
              id: 'main',
              component: 'Box',
              slots: {
                default: [
                  {
                    id: 'rule',
                    component: 'Box',
                    slots: {
                      default: [
                        {
                          id: 'rt',
                          component: 'Text',
                          props: { content: '关键规则：' },
                        },
                      ],
                    },
                  },
                  {
                    id: 'filters',
                    component: 'Box',
                    slots: {
                      default: [
                        { id: 'dp', component: 'DatePicker' },
                        { id: 'q', component: 'Text', props: { content: '查询' } },
                      ],
                    },
                  },
                  status('c1'),
                  status('c2'),
                  status('c3'),
                  status('c4'),
                ],
              },
            },
          ],
        },
      },
    }
    const outline = collectLayoutOutline(doc)
    expect(outline.sections.some((s) => s.role === 'alert')).toBe(true)
    const cards = outline.sections.filter((s) => s.role === 'card')
    expect(cards.length).toBe(4)
    expect(outline.cardCount).toBeGreaterThanOrEqual(4)
    expect(outline.structureContract.join(' ')).toMatch(/alert|strip|standalone/i)
  })
})

describe('semantic-heuristics', () => {
  it('classifies table cell props', () => {
    expect(
      isTableCellNode({
        component: 'Table',
        props: { 表格类型: '文字', '表格类型[Zz]': '文字' },
      }),
    ).toBe(true)
    expect(isTableCellNode({ component: 'Table', props: {} })).toBe(false)
    expect(BUTTON_LABEL_RE.test('查询')).toBe(true)
    expect(BUTTON_LABEL_RE.test('请选择')).toBe(false)
  })

  it('page table from cell cluster + pagination', () => {
    const node = {
      component: 'Box',
      slots: {
        default: [
          { component: 'Table', props: { 表格类型: '文字' } },
          { component: 'Table', props: { 表格类型: '文字' } },
          { component: 'Table', props: { 表格类型: '文字' } },
          { component: 'Pagination' },
        ],
      },
    }
    expect(subtreeHasPageTable(node)).toBe(true)
  })

  it('does not treat filter label Settement Date as a status card', async () => {
    const { looksLikeStatusCard, looksLikeFilterToolbar } = await import('./semantic-heuristics')
    expect(
      looksLikeStatusCard({
        component: 'Form',
        slots: {
          default: [{ component: 'Text', props: { content: 'Settement Date' } }],
        },
      }),
    ).toBe(false)
    expect(
      looksLikeStatusCard({
        component: 'Box',
        slots: {
          default: [
            { component: 'Text', props: { content: 'Settement Date：2026-09-03' } },
            { component: 'Text', props: { content: 'KlondPay_80.dat' } },
          ],
        },
      }),
    ).toBe(true)
    expect(
      looksLikeFilterToolbar({
        component: 'Box',
        style: { raw: { localHeight: '56px' } },
        slots: {
          default: [
            { component: 'Form', slots: { default: [{ component: 'DatePicker' }] } },
            { component: 'Text', props: { content: 'Settement Date' } },
            { component: 'Text', props: { content: '重置' } },
            { component: 'Text', props: { content: '查询' } },
          ],
        },
      }),
    ).toBe(true)
  })

  it('excludes filter toolbar from cardCount', () => {
    const status = (id: string) => ({
      id,
      component: 'Box' as const,
      style: { tokens: { backgroundColor: 'color.bg' } },
      slots: {
        default: [
          {
            id: `${id}-t`,
            component: 'Text' as const,
            props: { content: 'Settement Date：2026-09-03' },
          },
          {
            id: `${id}-f`,
            component: 'Text' as const,
            props: { content: 'KlondPay_80.dat' },
          },
          { id: `${id}-tag`, component: 'Tag' as const },
        ],
      },
    })
    const doc: SemDoc = {
      root: {
        id: 'r',
        component: 'Box',
        slots: {
          default: [
            {
              id: 'main',
              component: 'Box',
              slots: {
                default: [
                  {
                    id: 'filters',
                    component: 'Box',
                    style: {
                      tokens: { backgroundColor: 'color.bg' },
                      raw: { localHeight: '56px' },
                    },
                    slots: {
                      default: [
                        {
                          id: 'f1',
                          component: 'Form',
                          slots: {
                            default: [
                              {
                                id: 'fl',
                                component: 'Text',
                                props: { content: 'Settement Date' },
                              },
                              { id: 'fd', component: 'DatePicker' },
                            ],
                          },
                        },
                        { id: 'r', component: 'Text', props: { content: '重置' } },
                        { id: 'q', component: 'Text', props: { content: '查询' } },
                      ],
                    },
                  },
                  status('c1'),
                  status('c2'),
                  status('c3'),
                  status('c4'),
                ],
              },
            },
          ],
        },
      },
    }
    const outline = collectLayoutOutline(doc)
    const cards = outline.sections.filter((s) => s.role === 'card')
    expect(cards.length).toBe(4)
    expect(outline.cardCount).toBe(4)
    expect(cards.every((c) => /Settement Date：/.test(c.label))).toBe(true)
  })
})
