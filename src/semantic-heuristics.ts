import type { SemNode } from './budget.js'

/** Action labels commonly painted as Text instead of Button in MasterGo. */
export const BUTTON_LABEL_RE =
  /^(返回|提交|取消|驳回|通过|查询|重置|确认|保存|关闭|确定|立即查看|新增[\w\u4e00-\u9fff]*|编辑|删除|批量[\w\u4e00-\u9fff]*|配置PSP)$/u

/** Filter / placeholder copy that must NOT alone mark acceptance as edit. */
export const WEAK_EDIT_TEXT_RE = /请选择|请输入|选择月份|选择币种|最近天数/u

/** Strong edit/adjudication copy (needs real action surface). */
export const STRONG_EDIT_TEXT_RE = /未裁决|冲突|解析冲突|可勾选|强制|待审核/u

const TABLE_CELL_PROP_KEYS = /表格类型|排序|筛选|对齐方式|↳激活/

/**
 * MasterGo table *cell* instances often bind to Table with cell variant props.
 * Page-level table counts / card roles must ignore these.
 */
export function isTableCellNode(node: SemNode | undefined | null): boolean {
  if (!node || node.component !== 'Table') return false
  const props = node.props ?? {}
  const keys = Object.keys(props)
  if (keys.some((k) => TABLE_CELL_PROP_KEYS.test(k))) return true
  // Compact cell: Table with no children and tiny/no structural slots
  const kids = Object.values(node.slots ?? {}).flatMap((v) => (Array.isArray(v) ? v : []))
  if (kids.length === 0 && keys.length > 0 && !('columns' in props) && !('data' in props)) {
    // Variant-only props → cell
    if (keys.every((k) => TABLE_CELL_PROP_KEYS.test(k) || /\[/.test(k))) return true
  }
  return false
}

export function isPageLevelTable(node: SemNode | undefined | null): boolean {
  if (!node) return false
  if (node.component === 'ProTable') return true
  if (node.component === 'Table' && !isTableCellNode(node)) return true
  return false
}

export function childrenOf(node: SemNode): SemNode[] {
  const out: SemNode[] = []
  for (const kids of Object.values(node.slots ?? {})) {
    if (Array.isArray(kids)) out.push(...kids)
  }
  return out
}

export function walkAll(
  node: SemNode | undefined,
  fn: (n: SemNode, depth: number) => void,
  depth = 0,
) {
  if (!node) return
  fn(node, depth)
  for (const c of childrenOf(node)) walkAll(c, fn, depth + 1)
}

export function collectComponents(node: SemNode): string[] {
  const set = new Set<string>()
  walkAll(node, (n) => {
    if (n.component) set.add(n.component)
  })
  return [...set]
}

export function collectTexts(node: SemNode, limit = 8): string[] {
  const out: string[] = []
  walkAll(node, (n) => {
    if (out.length >= limit) return
    if (n.component === 'Text' && typeof n.props?.content === 'string') {
      const t = n.props.content.trim()
      if (t) out.push(t.slice(0, 80))
    }
  })
  return out
}

/** True if subtree has a real table (page-level Table or a cluster of cells + Pagination). */
export function subtreeHasPageTable(node: SemNode): boolean {
  let pageTable = false
  let cellCount = 0
  let hasPagination = false
  walkAll(node, (n) => {
    if (n.component === 'Pagination') hasPagination = true
    if (n.component === 'ProTable') pageTable = true
    if (n.component === 'Table') {
      if (isTableCellNode(n)) cellCount += 1
      else pageTable = true
    }
  })
  return pageTable || (cellCount >= 3 && hasPagination) || cellCount >= 8
}

const DATETIME_PLACEHOLDER_RE =
  /\d{4}-\d{2}-\d{2}.*\d{1,2}:\d{2}|星期[一二三四五六日天]/u

function readLocalSize(node: SemNode): { w: number | null; h: number | null } {
  const raw = node.style?.raw ?? {}
  const parse = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string') {
      const m = /^([\d.]+)px$/i.exec(v.trim())
      if (m) return Number(m[1])
    }
    return null
  }
  return {
    w: parse(raw.localWidth) ?? parse(raw.width),
    h: parse(raw.localHeight) ?? parse(raw.height),
  }
}

/**
 * Top bar often mis-bound as Input with datetime placeholder
 * (e.g.「2025-06-18 11:37:25 星期三」, ~1220×48).
 */
export function looksLikeTopBarChrome(node: SemNode): boolean {
  const placeholder =
    typeof node.props?.placeholder === 'string' ? node.props.placeholder : ''
  const datetimeish =
    DATETIME_PLACEHOLDER_RE.test(placeholder) ||
    collectTexts(node, 6).some((t) => DATETIME_PLACEHOLDER_RE.test(t))
  if (!datetimeish) return false
  const { w, h } = readLocalSize(node)
  // Full-bleed top strip: wide + short
  if (w != null && h != null && w >= 600 && h <= 72) return true
  // Leaf Input with datetime placeholder and no form fields nearby
  if (
    (node.component === 'Input' || node.component === 'Box') &&
    (node.confidence ?? 1) < 0.9 &&
    childrenOf(node).length === 0
  ) {
    return true
  }
  return false
}

/** Subtree looks like chrome (sidebar / top bar Menu), not content. */
export function looksLikeChrome(node: SemNode): boolean {
  if (node.component === 'Menu') return true
  if (node.component === 'Breadcrumb') return false
  if (looksLikeTopBarChrome(node)) return true
  const comps = new Set(collectComponents(node))
  // Top bar sometimes mis-detected as Input — treat Menu-heavy near-root as chrome
  if (comps.has('Menu') && !subtreeHasPageTable(node) && !comps.has('Table') && !comps.has('Card')) {
    const texts = collectTexts(node, 12)
    const menuish = texts.some((t) =>
      /监控|数据|渠道|组织|商户|账单|系统|用户|文件|终端|交易|对账|报表/.test(t),
    )
    if (menuish) return true
  }
  return false
}

/** Rule / info strip (关键规则 etc.) even when not bound as Alert. */
export function looksLikeAlertStrip(node: SemNode): boolean {
  if (node.component === 'Alert') return true
  const texts = collectTexts(node, 12)
  if (texts.some((t) => /^(关键规则|规则说明|报备通过|温馨提示|注意事项)/u.test(t))) {
    return true
  }
  return false
}

/**
 * Status / settlement cards: title「Settement Date：…」+ file rows / tags.
 * Used on 80-byte/Misc list pages (4 state variants).
 * Note: filter field label「Settement Date」(no colon/date) must NOT match.
 */
export function looksLikeStatusCard(node: SemNode): boolean {
  const texts = collectTexts(node, 20)
  // Require colon (fullwidth/halfwidth) so form labels like「Settement Date」are excluded
  const hasSettlementTitle = texts.some((t) => /Settement\s*Date\s*[：:]/i.test(t))
  if (!hasSettlementTitle) return false
  const hasFileOrTag =
    texts.some((t) => /\.dat\b|已发送|已生成|未获取|失败|前置异常|生成失败/u.test(t)) ||
    collectComponents(node).includes('Tag') ||
    collectComponents(node).includes('Switch')
  return hasFileOrTag || hasSettlementTitle
}

/**
 * Filter / query toolbar (Form + DatePicker/Select + 重置/查询).
 * Must not count as a content card even when it sits on a white strip.
 * Checked before status-card heuristics — bare「Settement Date」labels are filters.
 */
export function looksLikeFilterToolbar(node: SemNode): boolean {
  if (subtreeHasPageTable(node)) return false
  const comps = new Set(collectComponents(node))
  const hasControls =
    comps.has('Form') || comps.has('DatePicker') || comps.has('Select') || comps.has('Input')
  if (!hasControls) return false
  const texts = collectTexts(node, 24)
  const hasFilterActions = texts.some((t) => /^(重置|查询|搜索)$/u.test(t.trim()))
  if (!hasFilterActions) return false
  // Real settlement status cards carry file rows — those are not filter bars
  if (texts.some((t) => /\.dat\b/i.test(t))) return false
  // Exclude tall content blocks: filter rows are short (~56px) when raw height exists.
  const hRaw = node.style?.raw?.localHeight
  if (typeof hRaw === 'string') {
    const h = Number.parseFloat(hRaw)
    if (Number.isFinite(h) && h > 120) return false
  }
  return true
}

export function bgLooksCard(node: SemNode): boolean {
  const tokens = node.style?.tokens ?? {}
  const bg = tokens.backgroundColor ?? ''
  return bg === 'color.bg' || bg === 'color.fill' || /bg|fill|white/i.test(bg)
}

/** White shell with no interactive / content descendants is decoration, not a card. */
export function isDecorativeCardShell(node: SemNode): boolean {
  if (!bgLooksCard(node) && node.component !== 'Card' && node.component !== 'Box') return false
  const comps = collectComponents(node).filter((c) => c !== 'Box')
  if (comps.length === 0) return true
  const onlyChrome = comps.every((c) => c === 'Icon' || c === 'Path' || c === 'Image')
  if (onlyChrome && !collectTexts(node, 1).length) return true
  return false
}

/** Button-like text labels under a node (for inventory / actions). */
export function collectButtonLikeTexts(
  node: SemNode,
): Array<{ content: string; sourceNodeId?: string; nodeId?: string }> {
  const out: Array<{ content: string; sourceNodeId?: string; nodeId?: string }> = []
  const seen = new Set<string>()
  walkAll(node, (n) => {
    if (n.component !== 'Text') return
    const content = typeof n.props?.content === 'string' ? n.props.content.trim() : ''
    if (!content || !BUTTON_LABEL_RE.test(content)) return
    const key = `${n.sourceNodeId ?? n.id ?? content}:${content}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ content, sourceNodeId: n.sourceNodeId, nodeId: n.id })
  })
  return out
}

const STEP_SECTION_TITLES =
  /^(基础信息|营业执照信息|法人信息|结算信息|配置支付产品|支付产品|关键规则)/u

/** Heuristic: multi-step audit / wizard body. */
export function looksLikeStepsForm(node: SemNode): boolean {
  const comps = new Set(collectComponents(node))
  if (comps.has('Steps')) return true
  const texts = collectTexts(node, 40)
  const sectionHits = texts.filter((t) => STEP_SECTION_TITLES.test(t)).length
  const numbered = texts.filter((t) => /^[1-5]$/.test(t)).length
  return sectionHits >= 3 || (sectionHits >= 2 && numbered >= 3)
}
