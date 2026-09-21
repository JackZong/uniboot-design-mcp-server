export const SCOPE_IDS = ['read', 'write', 'search'] as const
export type ScopeId = (typeof SCOPE_IDS)[number]

export const SCOPE_DEFS: Record<
  ScopeId,
  { title: string; titleZh: string; description: string; descriptionZh: string }
> = {
  read: {
    title: 'Read',
    titleZh: '读取',
    description: 'Let AI agents view your existing work and use it as context, without creating or changing anything.',
    descriptionZh: '允许 AI 查看你已有的设计、规格与预览，仅作为上下文，不会创建或修改任何内容。',
  },
  write: {
    title: 'Write',
    titleZh: '写入',
    description:
      'Let AI agents create and update work on your behalf, using the same permissions you already have.',
    descriptionZh: '允许 AI 以你的权限代为生成原型/设计、改画布、导出切图等。',
  },
  search: {
    title: 'Search',
    titleZh: '搜索',
    description: 'Let AI agents search broadly across your work to find and summarize relevant content, without changing anything.',
    descriptionZh: '允许 AI 在你的项目、画板与 PRD 中搜索并汇总相关内容，不会修改任何内容。',
  },
}

export const DEFAULT_SCOPES: ScopeId[] = ['read', 'write', 'search']

export function parseScopes(raw?: string | string[] | null): ScopeId[] {
  const parts = Array.isArray(raw)
    ? raw
    : (raw ?? '')
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
  const picked = parts.filter((s): s is ScopeId => (SCOPE_IDS as readonly string[]).includes(s))
  return picked.length ? unique(picked) : [...DEFAULT_SCOPES]
}

export function formatScopes(scopes: ScopeId[]) {
  return scopes.join(' ')
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}
