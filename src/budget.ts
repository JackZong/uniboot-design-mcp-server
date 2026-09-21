/** MCP tool output budget (S3-A1 DoD: ≤ 30KB). */

export const MAX_TOOL_BYTES = 30 * 1024

export function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

export type TruncationMeta = {
  truncated: boolean
  bytes: number
  budget: number
  hints: string[]
}

export type ToolOk<T> = {
  ok: true
  data: T
  meta: TruncationMeta
}

export type ToolErr = {
  ok: false
  code: number
  message: string
}

export function wrapOk<T>(data: T, hints: string[] = []): ToolOk<T> {
  const bytes = utf8Bytes(data)
  return {
    ok: true,
    data,
    meta: {
      truncated: bytes > MAX_TOOL_BYTES,
      bytes,
      budget: MAX_TOOL_BYTES,
      hints,
    },
  }
}

export function wrapTruncated<T>(data: T, hints: string[]): ToolOk<T> {
  return {
    ok: true,
    data,
    meta: {
      truncated: true,
      bytes: utf8Bytes(data),
      budget: MAX_TOOL_BYTES,
      hints,
    },
  }
}

export function wrapErr(message: string, code = 50000): ToolErr {
  return { ok: false, code, message }
}

export function mcpText(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  }
}

export function withinBudget(value: unknown, budget = MAX_TOOL_BYTES): boolean {
  return utf8Bytes(value) <= budget
}

export type SemNode = {
  id?: string
  sourceNodeId?: string
  component?: string
  confidence?: number
  props?: Record<string, unknown>
  slots?: Record<string, SemNode[]>
  layout?: unknown
  style?: { tokens?: Record<string, string>; raw?: Record<string, string> }
  binding?: unknown
  childrenStub?: { count: number }
}

export type SemDoc = {
  id?: string
  artboardId?: string
  rev?: number
  page?: unknown
  root?: SemNode
  diagnostics?: unknown[]
}

/**
 * Prune a SemanticDocument until it fits the byte budget.
 * Strategy: strip raw styles → limit depth/nodes → drop diagnostics → stub root.
 */
export function pruneSemanticDocument(
  doc: SemDoc,
  opts: { maxDepth?: number; maxNodes?: number } = {},
): { document: SemDoc; hints: string[]; truncated: boolean } {
  const hints: string[] = []
  const originalBytes = utf8Bytes({ document: doc })
  const wasOverBudget = originalBytes > MAX_TOOL_BYTES
  let truncated = false

  const profiles: Array<{ maxDepth: number; maxNodes: number; dropDiag: boolean; stubRoot: boolean }> = [
    { maxDepth: opts.maxDepth ?? 5, maxNodes: opts.maxNodes ?? 120, dropDiag: false, stubRoot: false },
    { maxDepth: 4, maxNodes: 80, dropDiag: true, stubRoot: false },
    { maxDepth: 2, maxNodes: 40, dropDiag: true, stubRoot: false },
    { maxDepth: 1, maxNodes: 8, dropDiag: true, stubRoot: false },
    { maxDepth: 0, maxNodes: 1, dropDiag: true, stubRoot: true },
  ]

  let document: SemDoc = doc
  for (const profile of profiles) {
    document = applyProfile(doc, profile)
    if (profile.dropDiag && (doc.diagnostics?.length ?? 0) > 0) {
      truncated = true
      if (!hints.includes('diagnostics omitted to fit budget')) {
        hints.push('diagnostics omitted to fit budget')
      }
    }
    if (profile.stubRoot || profile.maxDepth < (opts.maxDepth ?? 5)) {
      truncated = true
      if (!hints.includes('deep children collapsed; use get_design_node for details')) {
        hints.push('deep children collapsed; use get_design_node for details')
      }
    }
    if (withinBudget({ document })) break
  }

  // Stripping raw styles / capping diagnostics still counts as truncation when
  // the original payload would have blown the budget.
  if (wasOverBudget && utf8Bytes({ document }) < originalBytes) {
    truncated = true
    if (!hints.includes('raw styles stripped; use get_design_spec for geometry details')) {
      hints.push('raw styles stripped; use get_design_spec for geometry details')
    }
  }

  if (!withinBudget({ document })) {
    truncated = true
    document = {
      id: doc.id,
      artboardId: doc.artboardId,
      rev: doc.rev,
      page: doc.page,
      root: {
        id: doc.root?.id,
        sourceNodeId: doc.root?.sourceNodeId,
        component: doc.root?.component ?? 'Box',
        confidence: doc.root?.confidence,
        childrenStub: { count: countDescendants(doc.root) },
      },
      diagnostics: [],
    }
    hints.push('page collapsed to root stub; call get_design_node / raise maxDepth')
  }

  if (truncated && !hints.length) {
    hints.push('output truncated to ≤30KB; use get_design_node for subtrees')
  }

  return { document, hints, truncated }
}

function applyProfile(
  doc: SemDoc,
  profile: { maxDepth: number; maxNodes: number; dropDiag: boolean; stubRoot: boolean },
): SemDoc {
  if (profile.stubRoot) {
    return {
      id: doc.id,
      artboardId: doc.artboardId,
      rev: doc.rev,
      page: doc.page,
      root: {
        id: doc.root?.id,
        sourceNodeId: doc.root?.sourceNodeId,
        component: doc.root?.component ?? 'Box',
        confidence: doc.root?.confidence,
        childrenStub: { count: countDescendants(doc.root) },
      },
      diagnostics: [],
    }
  }

  let nodeCount = 0
  const walk = (node: SemNode | undefined, depth: number): SemNode | undefined => {
    if (!node) return node
    nodeCount += 1
    if (nodeCount > profile.maxNodes || depth > profile.maxDepth) {
      return {
        id: node.id,
        sourceNodeId: node.sourceNodeId,
        component: node.component,
        confidence: node.confidence,
        childrenStub: { count: countDescendants(node) },
      }
    }
    const slots: Record<string, SemNode[]> = {}
    for (const [slot, kids] of Object.entries(node.slots ?? {})) {
      if (!Array.isArray(kids) || !kids.length) continue
      slots[slot] = kids
        .map((k) => walk(k, depth + 1))
        .filter((k): k is SemNode => Boolean(k))
    }
    return {
      id: node.id,
      sourceNodeId: node.sourceNodeId,
      component: node.component,
      confidence: node.confidence,
      props: node.props,
      layout: node.layout,
      binding: node.binding,
      style: node.style
        ? { tokens: node.style.tokens ?? {}, raw: {} }
        : undefined,
      slots,
    }
  }

  const diagnostics = profile.dropDiag
    ? []
    : (doc.diagnostics ?? []).slice(0, 40)

  return {
    id: doc.id,
    artboardId: doc.artboardId,
    rev: doc.rev,
    page: doc.page,
    root: walk(doc.root, 0),
    diagnostics,
  }
}

function countDescendants(node: SemNode | undefined): number {
  if (!node) return 0
  let n = 0
  for (const kids of Object.values(node.slots ?? {})) {
    if (!Array.isArray(kids)) continue
    for (const k of kids) n += 1 + countDescendants(k)
  }
  return n
}

/** Find a semantic node by semantic id or sourceNodeId; return ancestors (root→parent). */
export function findSemanticNode(
  root: SemNode | undefined,
  nodeId: string,
): { node: SemNode; ancestors: SemNode[] } | null {
  if (!root) return null
  const path: SemNode[] = []

  function walk(node: SemNode): SemNode | null {
    if (node.id === nodeId || node.sourceNodeId === nodeId) return node
    for (const kids of Object.values(node.slots ?? {})) {
      if (!Array.isArray(kids)) continue
      for (const child of kids) {
        path.push(node)
        const hit = walk(child)
        if (hit) return hit
        path.pop()
      }
    }
    return null
  }

  const node = walk(root)
  if (!node) return null
  return { node, ancestors: [...path] }
}

/** Slim a single node subtree for get_design_node. */
export function pruneNodeSubtree(
  node: SemNode,
  opts: { maxDepth?: number; maxNodes?: number } = {},
): { node: SemNode; hints: string[]; truncated: boolean } {
  const maxDepth = opts.maxDepth ?? 4
  const maxNodes = opts.maxNodes ?? 60
  let truncated = false
  let nodeCount = 0
  const hints: string[] = []

  const walk = (n: SemNode, depth: number): SemNode => {
    nodeCount += 1
    if (nodeCount > maxNodes || depth > maxDepth) {
      truncated = true
      return {
        id: n.id,
        sourceNodeId: n.sourceNodeId,
        component: n.component,
        confidence: n.confidence,
        childrenStub: { count: countDescendants(n) },
      }
    }
    const slots: Record<string, SemNode[]> = {}
    for (const [slot, kids] of Object.entries(n.slots ?? {})) {
      if (!Array.isArray(kids)) continue
      slots[slot] = kids.map((k) => walk(k, depth + 1))
    }
    return {
      id: n.id,
      sourceNodeId: n.sourceNodeId,
      component: n.component,
      confidence: n.confidence,
      props: n.props,
      layout: n.layout,
      binding: n.binding,
      style: n.style ? { tokens: n.style.tokens ?? {}, raw: n.style.raw ?? {} } : undefined,
      slots,
    }
  }

  const out = walk(node, 0)
  if (truncated) hints.push('subtree truncated; raise maxDepth or pick a child nodeId')
  return { node: out, hints, truncated }
}
