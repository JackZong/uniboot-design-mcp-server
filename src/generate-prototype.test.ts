import { describe, expect, it } from 'vitest'
import {
  cursorGenerateBrief,
  prototypeWorkspaceName,
  runGenerateAi,
  shapeCursorIngestResult,
} from './generate-prototype'

describe('prototypeWorkspaceName', () => {
  it('appends 原型 for a short prompt', () => {
    expect(prototypeWorkspaceName('CRM 管理后台')).toBe('CRM 管理后台原型')
  })

  it('strips leading 做 / 生成', () => {
    expect(prototypeWorkspaceName('做 CRM 管理后台')).toBe('CRM 管理后台原型')
  })

  it('keeps an existing 原型 suffix', () => {
    expect(prototypeWorkspaceName('内容运营后台原型')).toBe('内容运营后台原型')
  })

  it('names design intent', () => {
    expect(prototypeWorkspaceName('苍穹外卖', 'design')).toBe('苍穹外卖设计图')
  })
})

describe('cursorGenerateBrief', () => {
  it('asks Cursor to generate pages and retry with pages[]', () => {
    const brief = cursorGenerateBrief({
      intent: 'prototype',
      type: 'admin',
      prompt: 'CRM 后台',
      projectId: 'p1',
      createdProject: true,
      webBase: 'http://localhost:5173',
    })
    expect(brief.status).toBe('awaiting_pages')
    expect(brief.source).toBe('cursor')
    expect(brief.editorUrl).toBe('http://localhost:5173/ai/p1?capability=prototype')
    expect(brief.hint).toMatch(/generate_prototype/)
    expect(brief.hint).toMatch(/will not run its own AI/)
    expect(brief.next.join(' ')).toMatch(/stop/)
    expect(brief.next.join(' ')).toMatch(/do not list_artboards/)
    expect(brief.pageSchema).toHaveProperty('body')
  })

  it('returns wire schema for design', () => {
    const brief = cursorGenerateBrief({
      intent: 'design',
      type: 'admin',
      prompt: '苍穹外卖',
      projectId: 'p1',
      createdProject: false,
      webBase: 'http://localhost:5173',
    })
    expect(brief.kind).toBe('design')
    expect(brief.pageSchema).toHaveProperty('wire')
    expect(brief.hint).toMatch(/generate_design/)
  })
})

describe('shapeCursorIngestResult', () => {
  it('returns AI workbench URLs for prototype ingest', () => {
    const shaped = shapeCursorIngestResult(
      {
        title: 'CRM',
        fileId: 'f1',
        artboardId: 'a1',
        artboardIds: ['a1', 'a2'],
        pageCount: 2,
        prdId: 'prd1',
        fileType: 'product_draft',
        target: 'draft',
        deliveryPath: '/ai/p1?capability=prototype&prd=prd1',
      },
      {
        projectId: 'p1',
        createdProject: false,
        webBase: 'http://localhost:5173',
        intent: 'prototype',
        tool: 'generate_prototype',
      },
    )
    expect(shaped.status).toBe('ready')
    expect(shaped.source).toBe('cursor')
    expect(shaped.mode).toBe('draft')
    expect(shaped.fileType).toBe('product_draft')
    expect(shaped.prdId).toBe('prd1')
    expect(shaped.prototype?.fileId).toBe('f1')
    expect(shaped.prototype?.editorUrl).toBe(
      'http://localhost:5173/ai/p1?capability=prototype&prd=prd1',
    )
    expect(shaped.prototype?.productUrl).toBeUndefined()
    expect(shaped.editorUrl).toMatch(/\/ai\/p1/)
    expect(shaped.hint).toMatch(/原型工作台/)
    expect(shaped.next.join(' ')).toMatch(/do not open the design editor/)
    expect(shaped.next[0]).not.toMatch(/^list_artboards/)
    expect(shaped.design).toBeNull()
  })

  it('returns designUrl for design ingest', () => {
    const shaped = shapeCursorIngestResult(
      {
        title: '苍穹外卖',
        fileId: 'f2',
        artboardId: 'a1',
        prdId: 'prd2',
        fileType: 'design',
        target: 'draft',
        deliveryPath: '/ai/p1?capability=design&prd=prd2',
      },
      {
        projectId: 'p1',
        createdProject: false,
        webBase: 'http://localhost:5173',
        intent: 'design',
        tool: 'generate_design',
      },
    )
    expect(shaped.kind).toBe('design')
    expect(shaped.prototype).toBeNull()
    expect(shaped.design?.fileId).toBe('f2')
    expect(shaped.design?.editorUrl).toBe('http://localhost:5173/ai/p1?capability=design&prd=prd2')
    expect(shaped.next.join(' ')).not.toMatch(/get_prototype_flow/)
    expect(shaped.next.join(' ')).not.toMatch(/\/editor\//)
  })
})

describe('runGenerateAi', () => {
  it('creates an AI session draft and returns awaiting_pages without calling UniBoot LLM', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    const api = async <T>(_token: string, path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init })
      if (path === '/teams') return [{ id: 'team_1' }] as T
      if (path === '/projects') return { id: 'p_new' } as T
      throw new Error(`unexpected ${path}`)
    }
    const result = await runGenerateAi({
      token: 'pat',
      api,
      webBase: 'http://localhost:5173',
      input: { prompt: '苍穹外卖管理后台' },
      tool: 'generate_design',
    })
    expect(result.ok).toBe(true)
    expect(calls.map((c) => c.path)).toEqual(['/teams', '/projects'])
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      teamId: 'team_1',
      kind: 'ai_session',
    })
    if (result.ok && result.data.status === 'awaiting_pages') {
      expect(result.data.projectId).toBe('p_new')
      expect(result.data.source).toBe('cursor')
      expect(result.data.editorUrl).toBe('http://localhost:5173/ai/p_new?capability=design')
    }
  })

  it('posts Cursor pages to cursor-ingest, not prds/generate', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    const api = async <T>(_token: string, path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init })
      if (path === '/projects/p1/cursor-ingest') {
        return {
          projectId: 'p1',
          fileId: 'f_d',
          artboardId: 'a_d',
          title: '外卖设计图',
          prdId: 'prd_d',
          fileType: 'design',
          target: 'draft',
          deliveryPath: '/ai/p1?capability=design&prd=prd_d',
        } as T
      }
      throw new Error(`unexpected ${path}`)
    }
    const result = await runGenerateAi({
      token: 'pat',
      api,
      webBase: 'http://localhost:5173',
      input: {
        prompt: '苍穹外卖管理后台',
        projectId: 'p1',
        pages: [{ title: '订单列表', pageType: 'list', wire: { children: [{ name: 't', type: 'text', x: 0, y: 0, w: 10, h: 10 }] } }],
      },
      tool: 'generate_design',
    })
    expect(result.ok).toBe(true)
    expect(calls[0]?.path).toBe('/projects/p1/cursor-ingest')
    expect(calls.some((c) => c.path.includes('prds/generate'))).toBe(false)
    const body = JSON.parse(String(calls[0]?.init?.body))
    expect(body.intent).toBe('design')
    expect(body.target).toBe('draft')
    expect(body.pages).toHaveLength(1)
    if (result.ok && result.data.status === 'ready') {
      expect(result.data.design?.fileId).toBe('f_d')
      expect(result.data.editorUrl).toMatch(/\/ai\/p1/)
      expect(result.audit.tool).toBe('generate_design')
    }
  })

  it('rejects an empty prompt', async () => {
    const result = await runGenerateAi({
      token: 'pat',
      api: async () => {
        throw new Error('should not call api')
      },
      webBase: 'http://localhost:5173',
      input: {},
      tool: 'generate_design',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/设计图/)
  })

  it('ingests prototype pages and returns editorUrl for the AI workbench', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    const api = async <T>(_token: string, path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init })
      if (path === '/projects/p1/cursor-ingest') {
        return {
          projectId: 'p1',
          fileId: 'f_p',
          artboardId: 'a_p',
          prdId: 'prd_p',
          title: 'CRM',
          fileType: 'product_draft',
          target: 'draft',
          deliveryPath: '/ai/p1?capability=prototype&prd=prd_p',
        } as T
      }
      throw new Error(`unexpected ${path}`)
    }
    const result = await runGenerateAi({
      token: 'pat',
      api,
      webBase: 'http://localhost:5173',
      input: {
        prompt: 'CRM 管理后台',
        projectId: 'p1',
        pages: [
          {
            title: '线索列表',
            pageType: 'list',
            body: '<div class="page-head"><div class="page-title">线索列表</div><p class="page-desc">跟进销售线索</p></div>',
          },
        ],
      },
      tool: 'generate_prototype',
    })
    expect(result.ok).toBe(true)
    const body = JSON.parse(String(calls[0]?.init?.body))
    expect(body.intent).toBe('prototype')
    expect(body.target).toBe('draft')
    if (result.ok && result.data.status === 'ready') {
      expect(result.data.mode).toBe('draft')
      expect(result.data.editorUrl).toBe(
        'http://localhost:5173/ai/p1?capability=prototype&prd=prd_p',
      )
      expect(result.data.prototype?.productUrl).toBeUndefined()
    }
  })
})
