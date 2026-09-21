import { describe, expect, it } from 'vitest'
import { inferAcceptanceState, inferAcceptanceStateFromProductBrief } from './acceptance-state'

describe('inferAcceptanceState', () => {
  it('detects edit surface from batch/confirm buttons', () => {
    const state = inferAcceptanceState({
      texts: [{ content: '还有 3 项冲突未裁决' }],
      buttons: [
        { props: { label: '批量处理' } },
        { props: { label: '确认' } },
        { props: { label: '返回' } },
      ],
    })
    expect(state.mode).toBe('edit')
    expect(state.qaHint).toMatch(/mode=detail/i)
  })

  it('detects readonly when only return/close', () => {
    const state = inferAcceptanceState({
      texts: [{ content: '详情' }],
      buttons: [{ props: { label: '返回' } }],
    })
    expect(state.mode).toBe('readonly')
  })

  it('does not treat filter placeholder 请选择 as edit on detail pages', () => {
    const state = inferAcceptanceState({
      texts: [
        { content: '商户详情' },
        { content: '请选择月份' },
        { content: '请选择币种' },
      ],
      buttons: [{ props: { label: '返回' } }],
    })
    expect(state.mode).toBe('readonly')
  })

  it('keeps unknown when only weak placeholders and no buttons', () => {
    const state = inferAcceptanceState({
      texts: [{ content: '请选择月份' }],
      buttons: [],
    })
    expect(state.mode).toBe('unknown')
  })
})

describe('inferAcceptanceStateFromProductBrief', () => {
  it('marks login/form pages as edit', () => {
    const state = inferAcceptanceStateFromProductBrief({
      pageName: '登录界面',
      buttons: ['登录', '忘记密码？'],
      keyTexts: ['请填写用户账号', '请填写登录密码'],
      fields: [{ name: '用户账号', required: true }],
      structure: [{ kind: 'form', label: '表单' }],
      interactions: [{ kind: 'validate', label: '登录校验' }],
    })
    expect(state?.mode).toBe('edit')
    expect(state?.confidence).toMatch(/high|medium/)
  })

  it('marks dashboard as readonly', () => {
    const state = inferAcceptanceStateFromProductBrief({
      pageName: '集群概览',
      buttons: [],
      keyTexts: ['消息流入速率'],
      structure: [
        { kind: 'cards', label: 'KPI' },
        { kind: 'chart', label: '趋势' },
      ],
      interactions: [],
    })
    expect(state?.mode).toBe('readonly')
  })

  it('does not stamp dashboard+dialog as high-confidence edit', () => {
    const state = inferAcceptanceStateFromProductBrief({
      pageName: '集群概览-概述',
      buttons: ['刷新', '退出登录'],
      keyTexts: ['消息流入', '过去7天'],
      structure: [
        { kind: 'nav', label: '侧栏' },
        { kind: 'form', label: '筛选' },
        { kind: 'cards', label: 'KPI' },
        { kind: 'chart', label: '趋势' },
        { kind: 'dialog', label: '改密' },
      ],
      interactions: [
        { kind: 'dialog', label: '改密弹窗' },
        { kind: 'state', label: '趋势时间窗' },
        { kind: 'action', label: '刷新' },
      ],
    })
    expect(state?.mode).toBe('readonly')
    expect(state?.confidence).not.toBe('high')
    expect(state?.canvasZones?.some((z) => z.kind === 'dialog')).toBe(true)
    expect(state?.canvasZones?.some((z) => z.kind === 'state')).toBe(true)
  })

  it('keeps client detail at medium with blacklist dialog zones', () => {
    const state = inferAcceptanceStateFromProductBrief({
      pageName: '客户端-基本信息',
      buttons: ['查询', '重置', '下线', '加入黑名单'],
      keyTexts: ['客户端ID', '基本信息'],
      structure: [
        { kind: 'nav', label: '侧栏' },
        { kind: 'form', label: '筛选' },
        { kind: 'table', label: '详情' },
        { kind: 'tabs', label: 'Tabs' },
        { kind: 'dialog', label: '黑名单' },
      ],
      interactions: [{ kind: 'dialog', label: '黑名单确认' }],
      fields: [{ name: '客户端ID' }],
    })
    expect(state?.mode).toBe('edit')
    expect(state?.confidence).toBe('medium')
    expect(state?.canvasZones?.some((z) => z.kind === 'dialog')).toBe(true)
  })
})
