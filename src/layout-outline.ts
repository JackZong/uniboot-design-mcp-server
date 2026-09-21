import type { SemDoc, SemNode } from './budget.js'
import {
  bgLooksCard,
  childrenOf,
  collectButtonLikeTexts,
  collectComponents,
  collectTexts,
  isDecorativeCardShell,
  looksLikeAlertStrip,
  looksLikeChrome,
  looksLikeFilterToolbar,
  looksLikeStatusCard,
  looksLikeStepsForm,
  looksLikeTopBarChrome,
  subtreeHasPageTable,
  walkAll,
} from './semantic-heuristics.js'

export type LayoutSectionRole =
  | 'chrome'
  | 'breadcrumb'
  | 'card'
  | 'stats'
  | 'alert'
  | 'table'
  | 'actions'
  | 'steps'
  | 'misc'

export type LayoutSection = {
  role: LayoutSectionRole
  /** Suggested DOM / class name for Agent */
  suggestedName: string
  label: string
  component: string
  confidence?: number
  sourceNodeId?: string
  nodeId?: string
  contains: string[]
  textsSample: string[]
  /** Do not merge this section into a sibling card shell */
  keepSeparate: boolean
}

export type LayoutOutline = {
  sections: LayoutSection[]
  /** Ordered content sections excluding sidebar/top chrome */
  contentFlow: Array<{
    suggestedName: string
    role: LayoutSectionRole
    label: string
    sourceNodeId?: string
  }>
  structureContract: string[]
  cardCount: number
  warnings: string[]
}

function classifySubtree(node: SemNode): LayoutSectionRole {
  if (looksLikeChrome(node) || node.component === 'Menu' || looksLikeTopBarChrome(node)) {
    return 'chrome'
  }
  // Filters before status cards — bare「Settement Date」+ Form is a toolbar, not a card
  if (looksLikeFilterToolbar(node)) return 'misc'
  if (node.component === 'Alert' || looksLikeAlertStrip(node)) return 'alert'
  if (node.component === 'Card' || looksLikeStatusCard(node)) return 'card'
  if (node.component === 'Breadcrumb') {
    const t = collectTexts(node, 2).join(' ')
    if (
      looksLikeCopyrightOrFooter(t) ||
      looksLikeMarkupLeak(t) ||
      /刷新|数据更新|300,?000|消息流入|请填写/i.test(t) ||
      !looksLikeBreadcrumbTrail(t)
    ) {
      return 'misc'
    }
    return 'breadcrumb'
  }
  if (node.component === 'Statistic' || node.component === 'StatisticCard') return 'stats'
  if (node.component === 'Steps' || looksLikeStepsForm(node)) return 'steps'
  if (node.component === 'Pagination' && !subtreeHasPageTable(node)) return 'misc'
  if (subtreeHasPageTable(node) || node.component === 'ProTable') return 'table'
  if (node.component === 'Table') return 'table'

  const comps = new Set(collectComponents(node))
  if (comps.has('Alert') && node.component === 'Alert') return 'alert'
  if (comps.has('Statistic') || comps.has('StatisticCard')) return 'stats'
  if (comps.has('Breadcrumb') && comps.size <= 3) {
    const t = collectTexts(node, 2).join(' ')
    if (!looksLikeCopyrightOrFooter(t) && !looksLikeMarkupLeak(t)) return 'breadcrumb'
  }
  if (subtreeHasPageTable(node)) return 'table'
  if (looksLikeStepsForm(node)) return 'steps'
  if (comps.has('Button') && comps.has('Text') && !comps.has('Table') && comps.size <= 4) {
    return 'misc'
  }
  return 'misc'
}

function looksLikeCopyrightOrFooter(text: string): boolean {
  return /copyright|all rights reserved|©|\(c\)\s*\d{4}/i.test(text)
}

function looksLikeMarkupLeak(text: string): boolean {
  return /^</.test(text.trim()) || /<svg\b|<path\b|xmlns|stroke-width/i.test(text)
}

/** Short path trails like「首页 / 设置」— not copyright or long body copy. */
function looksLikeBreadcrumbTrail(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 48) return false
  if (looksLikeCopyrightOrFooter(t) || looksLikeMarkupLeak(t)) return false
  // Metrics / timestamps / chart tooltips are not breadcrumbs
  if (/刷新|数据更新|300,?000|消息流入|消息流出|请填写|Cancel|OK|English|简体中文/i.test(t)) {
    return false
  }
  if (/^\d{1,2}\/\d{1,2}/.test(t)) return false
  if (!/[\/›>]/.test(t)) return false
  const parts = t.split(/\s*[\/›>]\s*/).filter(Boolean)
  return parts.length >= 2 && parts.length <= 6 && parts.every((p) => p.length <= 16)
}

function suggestedNameFor(role: LayoutSectionRole, index: number, cardIndex: number): string {
  switch (role) {
    case 'chrome':
      return index === 0 ? 'layout-aside' : 'layout-header'
    case 'breadcrumb':
      return 'page-breadcrumb'
    case 'alert':
      return 'rule-alert'
    case 'stats':
      return 'card-stats'
    case 'table':
      return 'card-table'
    case 'card':
      return `card-${cardIndex + 1}`
    case 'actions':
      return 'card-footer-actions'
    case 'steps':
      return 'section-steps'
    default:
      return `section-${index + 1}`
  }
}

function labelFor(role: LayoutSectionRole, texts: string[]): string {
  if (texts[0]) return texts[0].slice(0, 40)
  switch (role) {
    case 'chrome':
      return '导航/顶栏'
    case 'breadcrumb':
      return '面包屑'
    case 'alert':
      return '规则提示条（独立，勿塞进卡片）'
    case 'stats':
      return '上卡：文件名 + 统计'
    case 'table':
      return '下卡：明细表 + 操作'
    case 'card':
      return '内容卡片'
    case 'actions':
      return '底栏操作按钮'
    case 'steps':
      return '步骤/分段表单'
    default:
      return '内容区块'
  }
}

function hasBusinessContent(node: SemNode): boolean {
  if (isDecorativeCardShell(node)) return false
  const comps = new Set(collectComponents(node))
  if (
    comps.has('Text') ||
    comps.has('Form') ||
    comps.has('Input') ||
    comps.has('Select') ||
    comps.has('DatePicker') ||
    comps.has('Checkbox') ||
    comps.has('Tag') ||
    comps.has('Card') ||
    comps.has('Alert') ||
    comps.has('Statistic') ||
    comps.has('StatisticCard') ||
    comps.has('Button') ||
    comps.has('Tabs') ||
    comps.has('Steps') ||
    subtreeHasPageTable(node)
  ) {
    return true
  }
  return collectTexts(node, 1).length > 0
}

function isCardishChild(g: SemNode, gRole: LayoutSectionRole): boolean {
  if (g.component === 'Pagination' && !subtreeHasPageTable(g)) return false
  if (isDecorativeCardShell(g) && gRole === 'misc') return false
  // Filter/query strip is not a content card (even on white bg)
  if (looksLikeFilterToolbar(g)) return false
  if (looksLikeAlertStrip(g) || g.component === 'Alert') return true
  if (looksLikeStatusCard(g)) return true
  if (!hasBusinessContent(g) && g.component !== 'Alert' && g.component !== 'Card') return false
  return (
    g.component === 'Card' ||
    g.component === 'Alert' ||
    gRole === 'stats' ||
    gRole === 'table' ||
    gRole === 'alert' ||
    gRole === 'steps' ||
    gRole === 'card' ||
    (bgLooksCard(g) && hasBusinessContent(g))
  )
}

function chromeSuggestedName(node: SemNode, fallbackIndex: number): string {
  if (looksLikeTopBarChrome(node)) return 'layout-header'
  const texts = collectTexts(node, 24)
  const comps = new Set(collectComponents(node))
  const sidebar = texts.some((t) =>
    /监控|数据|渠道|组织|商户|账单|系统|用户|文件|终端|交易|对账|报表|卡BIN/.test(t),
  )
  const header =
    texts.some((t) => /星期|机构名称|配置PSP|\d{4}-\d{2}-\d{2}/.test(t)) ||
    comps.has('Select') ||
    comps.has('DatePicker')
  if (sidebar && !header) return 'layout-aside'
  if (header && !sidebar) return 'layout-header'
  // Both or neither: first chrome → aside (typical left nav), rest → header
  return fallbackIndex === 0 ? 'layout-aside' : 'layout-header'
}

/**
 * Build an explicit page structure outline so Agents do not merge separate
 * white cards / alert strips into one shell — and do not invent cards from
 * decorative rects, table cells, or pagination-only nodes.
 */
export function collectLayoutOutline(doc: SemDoc | null | undefined): LayoutOutline {
  const warnings: string[] = []
  const sections: LayoutSection[] = []
  if (!doc?.root) {
    return {
      sections: [],
      contentFlow: [],
      structureContract: ['No semantic root — inspect preview manually'],
      cardCount: 0,
      warnings: ['missing semantic document'],
    }
  }

  const rootKids = childrenOf(doc.root)
  let cardIndex = 0
  let chromeIndex = 0

  const pushSection = (node: SemNode, role: LayoutSectionRole, forceSeparate: boolean) => {
    // Dedupe by source/node id
    if (
      sections.some(
        (s) =>
          (node.id && s.nodeId === node.id) ||
          (node.sourceNodeId && s.sourceNodeId === node.sourceNodeId),
      )
    ) {
      return
    }
    const contains = collectComponents(node).filter((c) => c !== 'Box')
    const textsSample = collectTexts(node)
    const name =
      role === 'chrome'
        ? chromeSuggestedName(node, chromeIndex++)
        : suggestedNameFor(role, sections.length, cardIndex)
    if (role === 'card' || role === 'stats' || role === 'table' || role === 'steps') {
      cardIndex += 1
    }
    const conf = node.confidence ?? 1
    sections.push({
      role,
      suggestedName: name,
      label: labelFor(role, textsSample),
      component: node.component ?? 'Box',
      confidence: conf,
      sourceNodeId: node.sourceNodeId,
      nodeId: node.id,
      contains: contains.slice(0, 12),
      textsSample,
      keepSeparate: forceSeparate,
    })
  }

  // Pass 1: explicit landmarks anywhere in the tree
  const landmarkNodes: SemNode[] = []
  walkAll(doc.root, (n) => {
    if (n.component === 'Card' && (n.confidence ?? 1) >= 0.5 && hasBusinessContent(n)) {
      landmarkNodes.push(n)
    }
    if (n.component === 'Alert' && (n.confidence ?? 1) >= 0.5) landmarkNodes.push(n)
    if (n.component === 'Steps' && (n.confidence ?? 1) >= 0.5) landmarkNodes.push(n)
  })

  // Pass 2: top-level / near-root content boxes
  for (const kid of rootKids) {
    if (looksLikeChrome(kid) || kid.component === 'Menu') {
      // Prefer aside for tall sidebar-like menus
      pushSection(kid, 'chrome', true)
      continue
    }
    if (kid.component === 'Breadcrumb') {
      pushSection(kid, 'breadcrumb', true)
      continue
    }
    // Do NOT treat every root Text as breadcrumb (copyright / SVG leaks / titles used to).
    if (kid.component === 'Text' && typeof kid.props?.content === 'string') {
      const content = String(kid.props.content).trim()
      if (looksLikeBreadcrumbTrail(content)) {
        pushSection(kid, 'breadcrumb', true)
      }
      continue
    }
    if (kid.component === 'Alert') {
      pushSection(kid, 'alert', true)
      continue
    }

    const role = classifySubtree(kid)

    // Large content Box: split into card-like children when possible
    const grand = childrenOf(kid)
    if ((kid.component === 'Box' || kid.component === 'Card') && grand.length >= 2) {
      let emitted = false
      let tableEmitted = false
      for (const g of grand) {
        const gRole =
          g.component === 'Alert' ? 'alert' : classifySubtree(g)
        // Fold Pagination into a prior table section instead of a second card
        if (g.component === 'Pagination' && tableEmitted) continue
        if (!isCardishChild(g, gRole)) continue
        let mapped: LayoutSectionRole =
          gRole === 'misc' && bgLooksCard(g) && hasBusinessContent(g)
            ? 'card'
            : gRole === 'chrome'
              ? 'misc'
              : gRole
        if (mapped === 'misc' && !bgLooksCard(g) && g.component !== 'Card') continue
        if (mapped === 'misc') mapped = 'card'
        if (mapped === 'table') tableEmitted = true
        pushSection(g, mapped, true)
        emitted = true
      }
      if (emitted) {
        // Steps form body often is one big Box — emit steps if heuristic matches
        if (!sections.some((s) => s.role === 'steps') && looksLikeStepsForm(kid)) {
          pushSection(kid, 'steps', true)
        }
        continue
      }
    }

    if (role === 'steps') {
      pushSection(kid, 'steps', true)
      continue
    }
    if (role === 'stats' || role === 'table' || role === 'card') {
      pushSection(kid, role, true)
      continue
    }
    if (bgLooksCard(kid) && hasBusinessContent(kid)) {
      pushSection(kid, role === 'misc' ? 'card' : role, true)
      continue
    }
    if (landmarkNodes.includes(kid)) continue
    if (role !== 'misc' || hasBusinessContent(kid)) {
      pushSection(kid, role, false)
    }
  }

  // Ensure landmark Cards/Alerts/Steps not already covered are listed
  for (const n of landmarkNodes) {
    const covered = sections.some((s) => s.sourceNodeId === n.sourceNodeId || s.nodeId === n.id)
    if (covered) continue
    const role =
      n.component === 'Alert'
        ? 'alert'
        : n.component === 'Steps'
          ? 'steps'
          : classifySubtree(n) === 'misc'
            ? 'card'
            : classifySubtree(n)
    if (role === 'card' && !hasBusinessContent(n)) continue
    pushSection(n, role === 'chrome' ? 'card' : role, true)
  }

  // Footer / toolbar actions from Button nodes or inferred button-like texts
  const rootButtonTexts = collectButtonLikeTexts(doc.root)
  const actionLabels = rootButtonTexts.map((t) => t.content)
  const hasFooterPair =
    (actionLabels.includes('取消') && actionLabels.includes('提交')) ||
    (actionLabels.includes('驳回') && actionLabels.includes('通过')) ||
    actionLabels.filter((l) => l === '查询' || l === '重置').length === 2

  let actionsAttached = false
  for (const s of [...sections]) {
    if (s.role !== 'table' && s.role !== 'card' && s.role !== 'steps') continue
    const node =
      (s.nodeId && findNodeById(doc.root, s.nodeId)) ||
      (s.sourceNodeId && findNodeBySource(doc.root, s.sourceNodeId))
    if (!node) continue
    const buttons = collectComponents(node).filter((c) => c === 'Button').length
    const localLabels = collectButtonLikeTexts(node)
    if (buttons >= 2 || localLabels.length >= 2) {
      sections.push({
        role: 'actions',
        suggestedName: 'card-footer-actions',
        label: '底栏操作（归属内容区内部，勿提到页外独立白卡）',
        component: 'Button',
        sourceNodeId: s.sourceNodeId,
        nodeId: s.nodeId,
        contains: ['Button'],
        textsSample: localLabels.map((t) => t.content).slice(0, 6),
        keepSeparate: false,
      })
      actionsAttached = true
      break
    }
  }
  if (!actionsAttached && hasFooterPair) {
    sections.push({
      role: 'actions',
      suggestedName: 'card-footer-actions',
      label: '底栏操作按钮',
      component: 'Button',
      contains: ['Button'],
      textsSample: actionLabels.slice(0, 6),
      keepSeparate: false,
    })
  }

  const contentFlow = sections
    .filter((s) => s.role !== 'chrome')
    .map((s) => ({
      suggestedName: s.suggestedName,
      role: s.role,
      label: s.label,
      sourceNodeId: s.sourceNodeId,
    }))

  // Only high-confidence content panels count toward hard card contracts
  const contractSections = sections.filter((s) => {
    if (s.role !== 'card' && s.role !== 'stats' && s.role !== 'table' && s.role !== 'steps') {
      return false
    }
    // Pagination-only leftovers should never appear; belt-and-suspenders
    if (s.component === 'Pagination') return false
    const conf = s.confidence ?? 1
    // Low-confidence Card heuristics stay as hints, not must counts
    if (s.role === 'card' && conf < 0.85 && s.component !== 'Card') return false
    return true
  })

  const cardCount = contractSections.length

  if (cardCount >= 2) {
    warnings.push(
      `Detected ${cardCount} separate content cards/sections — do NOT merge into one .conflict-shell / single white card`,
    )
  }
  if (sections.some((s) => s.role === 'alert')) {
    warnings.push('Alert/rule bar must stay between cards, not inside a card padding box')
  }
  if (sections.some((s) => s.role === 'steps')) {
    warnings.push('Steps / multi-section form: keep stepper + section panels; do not flatten into one card')
  }

  const hardNames = contractSections.map((s) => s.suggestedName).join(' + ')
  const structureContract = [
    ...(cardCount >= 2
      ? [
          `Render ${cardCount} separate content sections (${hardNames}); never one wrapper card for the whole page body.`,
        ]
      : [
          'Match preview: if preview shows multiple white panels, keep them as separate cards; do not invent cards from decorative rects or pagination.',
        ]),
    ...sections
      .filter((s) => s.role === 'alert')
      .map((s) => `Keep ${s.suggestedName} as a standalone strip between cards (not nested in card).`),
    ...sections
      .filter((s) => s.role === 'steps')
      .map(
        (s) =>
          `Keep ${s.suggestedName} as stepper + sectioned form (基础信息 / 执照 / 法人 / 结算 / 支付产品).`,
      ),
    ...sections
      .filter((s) => s.role === 'actions')
      .map((s) => `Place ${s.suggestedName} inside the content area (footer/toolbar), not as its own white card.`),
    'Validate structure against open_delivery preview before finishing.',
  ]

  return { sections, contentFlow, structureContract, cardCount, warnings }
}

function findNodeById(root: SemNode | undefined, id: string): SemNode | null {
  let hit: SemNode | null = null
  walkAll(root, (n) => {
    if (n.id === id) hit = n
  })
  return hit
}

function findNodeBySource(root: SemNode | undefined, sourceNodeId: string): SemNode | null {
  let hit: SemNode | null = null
  walkAll(root, (n) => {
    if (n.sourceNodeId === sourceNodeId) hit = n
  })
  return hit
}
