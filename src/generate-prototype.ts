export const PROTOTYPE_TYPES = [
  'mobile',
  'admin',
  'screen',
  'asset',
  'concept_map',
  'spec_review',
  'showcase',
] as const

export const MAX_GENERATE_PAGES = 32

export type PrototypeType = (typeof PROTOTYPE_TYPES)[number]
export type PrototypeIntent = 'prototype' | 'design'
export type GenerateAiTool = 'generate_prototype' | 'generate_design'
export type GenerateTarget = 'draft' | 'product'

export type CursorPageInput = {
  title: string
  pageType?: string
  summary?: string
  navGroup?: string
  body?: string
  entities?: unknown
  actions?: unknown
  wire?: unknown
}

export type GeneratePrototypeInput = {
  prompt?: string
  projectId?: string
  teamId?: string
  type?: PrototypeType
  target?: GenerateTarget
  pages?: CursorPageInput[]
  logoSvg?: string
  navIcons?: Array<{ name?: string; svg?: string } | string>
}

export type IngestApiResult = {
  projectId?: string
  fileId?: string
  artboardId?: string
  artboardIds?: string[]
  pageCount?: number
  prdId?: string
  fileType?: string
  target?: string
  truncated?: boolean
  submittedPageCount?: number
  ingestedPageCount?: number
  omittedTitles?: string[]
  mode?: string
  specMode?: string
  source?: string
  title?: string
  deliveryPath?: string
}

export type GenerateAiCall = <T>(token: string, path: string, init?: RequestInit) => Promise<T>

const VIEWPORTS: Record<PrototypeType, { width: number; height: number }> = {
  mobile: { width: 375, height: 812 },
  admin: { width: 1440, height: 900 },
  screen: { width: 1920, height: 1080 },
  asset: { width: 1440, height: 900 },
  concept_map: { width: 1440, height: 900 },
  spec_review: { width: 1440, height: 900 },
  showcase: { width: 1440, height: 900 },
}

const TYPE_HINT: Record<PrototypeType, string> = {
  mobile: '移动端 375×812，底部 Tab / 栈式跳转，不要侧栏后台。',
  admin: 'B 端 1440×900，Uniboot UI：浅底、主色 #2F54EB、6px 圆角、32px 控件。',
  screen: '数据大屏 1920×1080，深色底、指标卡，不要 CRUD 表单。',
  asset: '按用户描述还原布局，不要另起一套通用后台。',
  concept_map: '概念图：模块关系与主路径，不要做成完整后台。',
  spec_review: '界面规范评审：组件态与间距示例。',
  showcase: '全系统演示 1440×900：顶栏多端切换，页面写成「端 / 页面名」，至少 3 端。',
}

export function prototypeWorkspaceName(prompt: string, intent: PrototypeIntent = 'prototype') {
  const first = prompt.replace(/\s+/g, ' ').trim().split(/[。！？\n，,]/)[0]?.trim() ?? ''
  const short = first
    .replace(/需求描述|需求文档|PRD|运营推广/g, '')
    .replace(
      /^(?:请?(?:帮我)?)?(?:生成|输出|描述|设计|写|做)(?!市|客|空|多|账)(?:一个|一张|一份|一版|一款|一套)?/,
      '',
    )
    .replace(/(?:的)?原型设计$/u, '')
    .replace(/[。！？.!?，,；;：:\s]+$/g, '')
    .trim()
    .slice(0, 40)
  if (!short) return intent === 'design' ? '未命名设计图' : '未命名原型'
  if (intent === 'design') return /设计图$/.test(short) ? short : `${short}设计图`
  return /原型$/.test(short) ? short : `${short}原型`
}

export function prototypeEditorPath(opts: {
  projectId: string
  prdId?: string | null
  intent: PrototypeIntent
  target?: GenerateTarget
}) {
  if (opts.target === 'product') {
    return opts.intent === 'design'
      ? `/project/design/${opts.projectId}`
      : `/project/product/${opts.projectId}`
  }
  const q = new URLSearchParams({
    capability: opts.intent === 'design' ? 'design' : 'prototype',
  })
  if (opts.prdId) q.set('prd', opts.prdId)
  return `/ai/${opts.projectId}?${q.toString()}`
}

function artifactUrls(opts: {
  projectId: string
  webBase: string
  intent: PrototypeIntent
  target?: GenerateTarget
  prdId?: string | null
  deliveryPath?: string
}) {
  const editorPath = prototypeEditorPath({
    projectId: opts.projectId,
    prdId: opts.prdId,
    intent: opts.intent,
    target: opts.target,
  })
  const deliveryPath = opts.deliveryPath || editorPath
  return {
    editorPath,
    deliveryPath,
    editorUrl: `${opts.webBase}${deliveryPath.startsWith('/') ? deliveryPath : `/${deliveryPath}`}`,
  }
}

export function cursorGenerateBrief(opts: {
  intent: PrototypeIntent
  type: PrototypeType
  prompt: string
  projectId: string
  createdProject: boolean
  webBase: string
  target?: GenerateTarget
}) {
  const viewport = VIEWPORTS[opts.type]
  const tool = opts.intent === 'design' ? 'generate_design' : 'generate_prototype'
  const target = opts.target === 'product' ? 'product' : 'draft'
  const editorPath = prototypeEditorPath({
    projectId: opts.projectId,
    intent: opts.intent,
    target,
  })
  const pageShape =
    opts.intent === 'design'
      ? {
          title: '页面业务名',
          pageType: 'list|form|detail|dashboard|login|splash|scene|result',
          summary: '该页职责',
          navGroup: '侧栏分组，可选',
          wire: {
            title: '同 title',
            pageType: '同 pageType',
            width: viewport.width,
            height: viewport.height,
            background: '#F5F6F8',
            children: [
              {
                name: '标题',
                type: 'text',
                x: 48,
                y: 40,
                w: 400,
                h: 36,
                text: '页面名',
                color: '#1D2129',
                fontSize: 24,
                fontWeight: 600,
              },
            ],
          },
        }
      : {
          title: '页面业务名',
          pageType: 'list|form|detail|dashboard|login',
          summary: '该页职责',
          navGroup: '侧栏分组，可选',
          body: '<div class="page-head"><div class="page-title">业务名</div><p class="page-desc">说明</p><a class="btn btn-primary" href="下一页.html">操作</a></div>',
        }
  const rules =
    opts.intent === 'design'
      ? [
          '你（Cursor）本地生成线框 JSON，不要调用 UniBoot Design 平台 LLM。',
          '每个页面结构必须不同；列表用真实列名，表单/详情用该页字段。',
          '节点 type 只能是 frame / text / rect；坐标相对父节点，单位 px。',
          'wire 可省略，平台会用规则线框兜底；有 wire 时预览更准。',
          `一次最多 ${MAX_GENERATE_PAGES} 页；超出部分会被截断并在 truncated 中列出。`,
        ]
      : [
          '你（Cursor）本地生成每页主内容 HTML，不要调用 UniBoot Design 平台 LLM。',
          'body 只给主内容片段，不要 <html>/<head>/<body>/<script>，不要再写侧栏。',
          '先写 page-head（page-title + page-desc + 主按钮），再写该页模块。',
          '只用 class：page-head、page-title、page-desc、stats/stat、toolbar、table、card、field、btn/btn-primary、split、catalog、metric、bars/bar、profile、kv、tag、list-card、muted。',
          '不要 inline style、黑边框、外链、内联 JS。跳转用 <a href="文件名.html">，文件名与 pages[].title 对应（如 线索列表.html）。',
          '看板用 stats；列表用 toolbar+table；详情用 profile+kv；配置用 split。',
          '趋势图使用 data-demo-chart="128,156,142,189,210,178,236" 和 data-demo-labels="周一,周二,周三,周四,周五,周六,周日"；禁止空图表。',
          '交互按钮用 data-demo-set="order.status" data-demo-value="已完成"，显示状态用 data-demo-bind="order.status"；跨页同一对象使用相同键。搜索输入框加 data-demo-search，表格行放在 tbody。',
          '新建按钮必须使用 data-demo-create="集合ID"，对应 table id="集合ID"（有 thead/tbody）或 div class="catalog" id="集合ID"；运行时自动弹出字段表单、校验、保存并追加记录。行内编辑用 data-demo-edit，复制模板用 data-demo-copy="集合ID"。',
          '自定义弹窗用 data-demo-open="dialogId" 和 dialog id="dialogId"，关闭用 data-demo-close；自定义表单用 data-demo-save="集合ID"，字段 name 与表头文字一致。不要只用状态提示代替创建记录。',
          '每个按钮都要有有效链接或声明式交互；上传会校验死按钮、空链接和不存在的弹窗/集合目标，失败时修正后重新上传。',
          `一次最多 ${MAX_GENERATE_PAGES} 页；超出部分会被截断并在 truncated 中列出。`,
        ]
  return {
    status: 'awaiting_pages' as const,
    kind: opts.intent,
    createdProject: opts.createdProject,
    projectId: opts.projectId,
    type: opts.type,
    target,
    viewport,
    typeHint: TYPE_HINT[opts.type],
    prompt: opts.prompt,
    source: 'cursor' as const,
    editorUrl: `${opts.webBase}${editorPath}`,
    pageSchema: pageShape,
    rules,
    hint: `Generate pages with Cursor, then call ${tool} again with the same projectId, prompt, type, and pages[]. After upload, send editorUrl to the user and stop. Do not resolve_link or open the design editor. UniBoot Design only stores the result; it will not run its own AI.`,
    next: [
      `Generate ${opts.intent === 'design' ? 'wireframes' : 'HTML page bodies'} locally with Cursor`,
      `Call ${tool} again with projectId=${opts.projectId} and pages[]`,
      'Then send editorUrl to the user and stop — do not list_artboards, resolve_link, or open /project/design/.../editor/',
    ],
  }
}

export function shapeCursorIngestResult(
  raw: IngestApiResult,
  opts: {
    projectId: string
    createdProject: boolean
    webBase: string
    intent: PrototypeIntent
    tool: GenerateAiTool
    target?: GenerateTarget
  },
) {
  const isDesign = opts.intent === 'design'
  const projectId = raw.projectId || opts.projectId
  const fileId = raw.fileId
  const artboardId = raw.artboardId
  const artboardIds = raw.artboardIds?.length
    ? raw.artboardIds
    : artboardId
      ? [artboardId]
      : []
  const target: GenerateTarget =
    raw.target === 'product' || opts.target === 'product' ? 'product' : 'draft'
  const fileType =
    raw.fileType || (isDesign ? 'design' : target === 'product' ? 'product' : 'product_draft')
  const prdId = raw.prdId || null
  const urls = artifactUrls({
    projectId,
    webBase: opts.webBase,
    intent: opts.intent,
    target,
    prdId,
    deliveryPath: raw.deliveryPath,
  })
  const truncated = Boolean(raw.truncated)
  const artifact = fileId
    ? {
        fileId,
        fileType,
        prdId,
        artboardId: artboardId ?? artboardIds[0] ?? null,
        artboardIds,
        pageCount: raw.pageCount ?? artboardIds.length,
        editorUrl: urls.editorUrl,
        deliveryUrl: urls.editorUrl,
        designUrl: isDesign && target === 'product' ? `${opts.webBase}/project/design/${projectId}` : undefined,
        productUrl:
          !isDesign && target === 'product' ? `${opts.webBase}/project/product/${projectId}` : undefined,
      }
    : null
  const truncatedHint = truncated
    ? `Ingested ${raw.ingestedPageCount ?? artifact?.pageCount ?? 0} of ${raw.submittedPageCount ?? 0} pages (max ${MAX_GENERATE_PAGES}). Omitted: ${(raw.omittedTitles ?? []).join('、') || 'unnamed'}.`
    : null
  const next = fileId
    ? [
        `Open editorUrl in the AI ${isDesign ? 'design' : 'prototype'} workbench — do not open the design editor or Product tab`,
        'Send editorUrl to the user and stop',
        ...(truncatedHint ? [truncatedHint] : []),
        ...(target === 'draft'
          ? ['Only if the user asks to publish to the product library: call again with target=product']
          : []),
      ]
    : ['Ingest did not return a file; check pages[] and retry']
  return {
    status: 'ready' as const,
    kind: opts.intent,
    createdProject: opts.createdProject,
    projectId,
    prdId,
    title: raw.title ?? '',
    source: 'cursor' as const,
    mode: target,
    fileType,
    truncated,
    submittedPageCount: raw.submittedPageCount ?? artifact?.pageCount ?? 0,
    ingestedPageCount: raw.ingestedPageCount ?? artifact?.pageCount ?? 0,
    omittedTitles: raw.omittedTitles ?? [],
    specMode: raw.specMode ?? raw.mode ?? 'cursor',
    prototype: isDesign ? null : artifact,
    design: isDesign ? artifact : null,
    editorUrl: artifact?.editorUrl ?? urls.editorUrl,
    hint: isDesign
      ? '打开 AI 工作台预览设计图，不要打开设计编辑器。'
      : '打开 AI 原型工作台，不要打开设计编辑器或产品 Tab。',
    next,
  }
}

export async function ensureGenerateProject(opts: {
  token: string
  api: GenerateAiCall
  input: GeneratePrototypeInput
  intent: PrototypeIntent
}) {
  const prompt = opts.input.prompt?.trim() ?? ''
  let projectId = opts.input.projectId?.trim() || ''
  let createdProject = false
  if (!projectId) {
    let teamId = opts.input.teamId?.trim() || ''
    if (!teamId) {
      const teams = await opts.api<Array<{ id: string }>>(opts.token, '/teams')
      teamId = teams[0]?.id ?? ''
    }
    if (!teamId) {
      return {
        ok: false as const,
        code: 42200,
        message: '暂无可用团队：PAT 未加入任何团队，或请传入 teamId',
      }
    }
    const created = await opts.api<{ id: string }>(opts.token, '/projects', {
      method: 'POST',
      body: JSON.stringify({
        teamId,
        name: prototypeWorkspaceName(prompt || opts.input.pages?.[0]?.title || '', opts.intent),
        category: 'web',
        kind: opts.input.target === 'product' ? 'space' : 'ai_session',
      }),
    })
    projectId = created.id
    createdProject = true
  }
  return { ok: true as const, projectId, createdProject, prompt }
}

export async function runGenerateAi(opts: {
  token: string
  api: GenerateAiCall
  webBase: string
  input: GeneratePrototypeInput
  tool: GenerateAiTool
}) {
  const intent: PrototypeIntent = opts.tool === 'generate_design' ? 'design' : 'prototype'
  const prompt = opts.input.prompt?.trim() ?? ''
  const pages = opts.input.pages ?? []
  if (!prompt && !pages.length) {
    return {
      ok: false as const,
      code: 42200,
      message: intent === 'design' ? '请先描述要生成的设计图' : '请先描述要设计的原型',
    }
  }

  const project = await ensureGenerateProject({
    token: opts.token,
    api: opts.api,
    input: opts.input,
    intent,
  })
  if (!project.ok) return project

  const type = opts.input.type ?? 'admin'
  const target = opts.input.target === 'product' ? 'product' : 'draft'
  if (!pages.length) {
    const data = cursorGenerateBrief({
      intent,
      type,
      prompt: project.prompt || prompt,
      projectId: project.projectId,
      createdProject: project.createdProject,
      webBase: opts.webBase,
      target,
    })
    return {
      ok: true as const,
      data,
      audit: {
        tool: opts.tool,
        resourceType: 'project' as const,
        resourceId: project.projectId,
        meta: {
          status: data.status,
          type,
          intent,
          target,
          createdProject: project.createdProject,
          source: 'cursor',
        },
      },
    }
  }

  const raw = await opts.api<IngestApiResult>(
    opts.token,
    `/projects/${project.projectId}/cursor-ingest`,
    {
      method: 'POST',
      body: JSON.stringify({
        intent,
        type,
        target,
        prompt: project.prompt || prompt,
        pages,
        logoSvg: opts.input.logoSvg,
        navIcons: opts.input.navIcons,
      }),
    },
  )
  const data = shapeCursorIngestResult(raw, {
    projectId: project.projectId,
    createdProject: project.createdProject,
    webBase: opts.webBase,
    intent,
    tool: opts.tool,
    target,
  })
  return {
    ok: true as const,
    data,
    audit: {
      tool: opts.tool,
      resourceType: 'project' as const,
      resourceId: project.projectId,
      meta: {
        status: data.status,
        type,
        intent,
        createdProject: project.createdProject,
        fileId: data.design?.fileId ?? data.prototype?.fileId,
        prdId: data.prdId,
        target: data.mode,
        source: 'cursor',
      },
    },
  }
}
