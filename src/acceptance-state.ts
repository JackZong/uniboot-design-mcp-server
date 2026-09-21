import { STRONG_EDIT_TEXT_RE, WEAK_EDIT_TEXT_RE } from './semantic-heuristics.js'

export type AcceptanceInventory = {
  texts: Array<{ content: string }>
  buttons: Array<{ props: Record<string, unknown> }>
}

export type AcceptanceState = {
  mode: 'edit' | 'readonly' | 'unknown'
  confidence: 'high' | 'medium' | 'low'
  evidence: string[]
  note: string
  /** How Agent should open the page for visual QA */
  qaHint: string
  /** Prototype canvas zones Agents must not collapse into one "edit" verdict. */
  canvasZones?: Array<{
    kind: 'default' | 'dialog' | 'state' | 'annotation'
    label: string
    acceptance?: 'edit' | 'readonly' | 'n/a'
  }>
}

const EDIT_BUTTON_HINTS =
  /批量|确认|保存|提交|裁决|处理|新增|编辑|删除|通过|驳回|确定/i
const READONLY_ONLY = /返回|关闭|详情|查看/i

/**
 * Infer whether the artboard is an edit/adjudication surface vs readonly detail.
 * Stops Agents from QA'ing mode=detail and claiming MCP missed buttons.
 * Filter placeholders like「请选择」alone must NOT force edit mode.
 */
export function inferAcceptanceState(
  inventory: AcceptanceInventory | null | undefined,
): AcceptanceState {
  const texts = inventory?.texts ?? []
  const buttons = inventory?.buttons ?? []
  const evidence: string[] = []

  const buttonLabels = buttons
    .map((b) => {
      const p = b.props ?? {}
      const label =
        (typeof p.label === 'string' && p.label) ||
        (typeof p.content === 'string' && p.content) ||
        (typeof p.text === 'string' && p.text) ||
        ''
      return label.trim()
    })
    .filter(Boolean)

  const textJoined = texts.map((t) => t.content).join(' ')
  const detailTitled = /详情|明细/.test(textJoined)

  let editHits = 0
  for (const label of buttonLabels) {
    if (EDIT_BUTTON_HINTS.test(label)) {
      editHits += 1
      evidence.push(`button:${label}`)
    }
  }

  // Strong copy only — ignore weak filter placeholders (请选择月份 / 请输入)
  if (STRONG_EDIT_TEXT_RE.test(textJoined)) {
    editHits += 1
    const hit = texts.find((t) => STRONG_EDIT_TEXT_RE.test(t.content))
    if (hit) evidence.push(`text:${hit.content.slice(0, 32)}`)
  } else if (WEAK_EDIT_TEXT_RE.test(textJoined) && editHits === 0 && !detailTitled) {
    // Weak placeholders alone → unknown (not edit)
  }

  const onlyReadonlyButtons =
    buttonLabels.length > 0 &&
    buttonLabels.every((l) => READONLY_ONLY.test(l) && !EDIT_BUTTON_HINTS.test(l))

  // Detail pages with chart filters still say「请选择」but only「返回」matters
  if (detailTitled && onlyReadonlyButtons && editHits === 0) {
    return {
      mode: 'readonly',
      confidence: 'medium',
      evidence: [...buttonLabels.map((l) => `button:${l}`), 'text:详情'].slice(0, 6),
      note: 'Design looks readonly detail (title/详情 + return).',
      qaHint: 'Match readonly/detail entry for visual QA.',
    }
  }

  if (editHits >= 1) {
    return {
      mode: 'edit',
      confidence: editHits >= 2 ? 'high' : 'medium',
      evidence: evidence.slice(0, 6),
      note: 'Design is an edit/action surface — do not QA in mode=detail readonly.',
      qaHint:
        'Open the same product entry as the design (e.g. 解析冲突 / edit). mode=detail with only 返回 is NOT acceptance.',
    }
  }

  if (onlyReadonlyButtons) {
    return {
      mode: 'readonly',
      confidence: 'medium',
      evidence: buttonLabels.map((l) => `button:${l}`).slice(0, 6),
      note: 'Design looks readonly (return/close only).',
      qaHint: 'Match readonly/detail entry for visual QA.',
    }
  }

  return {
    mode: 'unknown',
    confidence: 'low',
    evidence: [],
    note: 'Could not infer edit vs readonly — ask user which product state matches the artboard.',
    qaHint: 'Confirm entry URL matches the design state before compare_design_code.',
  }
}

export type ProductBriefAcceptanceHint = {
  buttons?: string[]
  keyTexts?: string[]
  interactions?: Array<{ kind?: string; label?: string; detail?: string }>
  structure?: Array<{ kind?: string; label?: string }>
  fields?: Array<{ name?: string; required?: boolean }>
  pageName?: string
  states?: Array<{ id?: string; kind?: string; label?: string }>
  canvasZones?: Array<{ kind?: string; label?: string }>
}

/**
 * Product/Axure brief → acceptance state when inventory-based inference is unknown.
 * Never stamp every Axure page as high-confidence edit — dashboards stay readonly;
 * dialogs/chart states are listed as separate canvasZones.
 */
export function inferAcceptanceStateFromProductBrief(
  brief: ProductBriefAcceptanceHint | null | undefined,
): AcceptanceState | null {
  if (!brief) return null
  const evidence: string[] = []
  const buttons = brief.buttons ?? []
  const texts = brief.keyTexts ?? []
  const interactions = brief.interactions ?? []
  const structure = brief.structure ?? []
  const blob = `${buttons.join(' ')} ${texts.join(' ')} ${interactions.map((i) => i.label ?? '').join(' ')} ${brief.pageName ?? ''}`

  const kinds = new Set(structure.map((s) => s.kind).filter(Boolean) as string[])
  const isLogin =
    kinds.has('hero') ||
    /登录界面|用户登录|USER LOGIN|校验码/.test(blob) ||
    (brief.fields ?? []).some((f) => /账号|密码|校验码/.test(f.name ?? ''))
  const isDashboard =
    (kinds.has('cards') || kinds.has('chart')) && !isLogin
  const isDetailList =
    (kinds.has('table') || kinds.has('tabs')) && kinds.has('nav') && !isLogin

  const hasLoginForm =
    isLogin &&
    ((brief.fields?.length ?? 0) > 0 ||
      interactions.some((i) => i.kind === 'validate') ||
      /请填写|登录密码|校验码/.test(blob))
  const hasDialog = interactions.some((i) => i.kind === 'dialog') || /弹窗|改密|黑名单/.test(blob)
  const hasStrongEditAction = buttons.some((b) =>
    /登录|保存|提交|确定|下线|加入黑名单|移除黑名单|Change Password|OK/i.test(b),
  )
  // Filter-only「查询/重置」must not force high-confidence edit on dashboards
  const filterOnly =
    buttons.some((b) => /查询|重置/.test(b)) &&
    !hasStrongEditAction &&
    !hasLoginForm

  const canvasZones: NonNullable<AcceptanceState['canvasZones']> = [
    {
      kind: 'default',
      label: isLogin ? '默认登录画面' : isDashboard ? '默认概览画面' : '默认页面',
      acceptance: hasLoginForm ? 'edit' : isDashboard || isDetailList ? 'readonly' : 'edit',
    },
  ]
  if (hasDialog) {
    for (const i of interactions.filter((x) => x.kind === 'dialog')) {
      canvasZones.push({
        kind: 'dialog',
        label: i.label || '弹窗态',
        acceptance: 'edit',
      })
    }
  }
  for (const i of interactions.filter((x) => x.kind === 'state')) {
    canvasZones.push({
      kind: 'state',
      label: i.label || '交互态',
      acceptance: 'readonly',
    })
  }
  if ((brief.states ?? []).some((s) => s.kind === 'annotation') || /说明|【趋势图】/.test(blob)) {
    canvasZones.push({
      kind: 'annotation',
      label: '画布外说明',
      acceptance: 'n/a',
    })
  }

  if (isLogin && hasLoginForm) {
    evidence.push('productBrief:login-form')
    if (hasDialog) evidence.push('productBrief:dialog-alternate')
    return {
      mode: 'edit',
      confidence: 'high',
      evidence: evidence.slice(0, 6),
      note: 'Login form is the default interactive state; change-password dialog is an alternate canvas zone — QA both separately.',
      qaHint: 'QA default login first; then open first-login change-password dialog state.',
      canvasZones,
    }
  }

  if (isDashboard) {
    evidence.push('productBrief:dashboard')
    if (hasDialog) evidence.push('productBrief:dialog-alternate')
    if (interactions.some((i) => /趋势/.test(i.label ?? ''))) evidence.push('productBrief:chart-states')
    return {
      mode: 'readonly',
      confidence: 'medium',
      evidence: evidence.slice(0, 6),
      note: 'Dashboard/overview default is readonly metrics. Dialogs and chart time-range variants are separate canvasZones — do not treat the whole page as high-confidence edit.',
      qaHint: 'Match overview entry for default QA; exercise refresh/filters and chart states separately.',
      canvasZones,
    }
  }

  if (isDetailList) {
    evidence.push('productBrief:detail-list')
    if (hasDialog) evidence.push('productBrief:dialog-alternate')
    return {
      mode: hasStrongEditAction ? 'edit' : 'readonly',
      confidence: 'medium',
      evidence: evidence.slice(0, 6),
      note: filterOnly
        ? 'List/detail page with filter toolbar — default is mostly readonly; blacklist/offline dialogs are alternate states.'
        : 'List/detail page — default view plus alternate dialog states; do not collapse to a single high-confidence edit verdict.',
      qaHint: 'QA default detail first; then blacklist add/remove dialog states if present.',
      canvasZones,
    }
  }

  if (hasLoginForm || (hasStrongEditAction && !filterOnly)) {
    if (hasLoginForm) evidence.push('productBrief:form')
    if (hasDialog) evidence.push('productBrief:dialog')
    if (buttons[0]) evidence.push(`button:${buttons[0]}`)
    return {
      mode: 'edit',
      confidence: hasLoginForm && hasStrongEditAction ? 'high' : 'medium',
      evidence: evidence.slice(0, 6),
      note: 'Inferred from productBrief (form/actions) — QA in the matching interactive product state.',
      qaHint: 'Open the interactive entry matching the prototype (login/form/actions visible).',
      canvasZones,
    }
  }

  if (kinds.has('cards') || kinds.has('chart') || kinds.has('table')) {
    return {
      mode: 'readonly',
      confidence: 'medium',
      evidence: ['productBrief:dashboard'],
      note: 'Dashboard/overview prototype — primarily readonly metrics; still exercise refresh/filters if present.',
      qaHint: 'Match overview/dashboard entry for visual QA.',
      canvasZones,
    }
  }

  return null
}
