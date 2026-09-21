import { describe, expect, it } from 'vitest'
import { parseLink, buildDeliveryDetailUrl } from './api'
import {
  MAX_TOOL_BYTES,
  findSemanticNode,
  pruneSemanticDocument,
  utf8Bytes,
  withinBudget,
  type SemDoc,
  type SemNode,
} from './budget'
import { listMappings, mappingFor } from './mappings'
import { previewResourceUri } from './resources'
import { resolvePageToArtboards } from './resolve'

function makeTree(depth: number, breadth: number, prefix = 'n'): SemNode {
  const children: SemNode[] = []
  if (depth > 0) {
    for (let i = 0; i < breadth; i++) {
      children.push(makeTree(depth - 1, breadth, `${prefix}_${i}`))
    }
  }
  return {
    id: prefix,
    sourceNodeId: `src_${prefix}`,
    component: depth === 0 ? 'Button' : 'Box',
    confidence: 0.9,
    props: { label: 'x'.repeat(20) },
    style: {
      tokens: { 'color.bg': 'color.bg.default' },
      raw: { backgroundColor: '#ffffff', padding: '8px', margin: '4px', border: '1px solid #eee' },
    },
    slots: children.length ? { default: children } : {},
  }
}

describe('parseLink', () => {
  it('parses design overview', () => {
    const r = parseLink('https://app.example/project/design/proj_abc?v=2')
    expect(r.projectId).toBe('proj_abc')
    expect(r.contentTab).toBe('design')
    expect(r.version).toBe(2)
    expect(r.pageId).toBeUndefined()
    expect(r.artboardId).toBeUndefined()
    expect(r.fileId).toBeUndefined()
    expect(r.deliveryMode).toBe('overview')
  })

  it('parses Lanhu-style detail query ids', () => {
    const r = parseLink(
      'https://app.example/project/design/proj_abc?fileId=file_1&artboardId=ab_conflict&v=2',
    )
    expect(r.projectId).toBe('proj_abc')
    expect(r.fileId).toBe('file_1')
    expect(r.artboardId).toBe('ab_conflict')
    expect(r.deliveryMode).toBe('detail')
    expect(r.version).toBe(2)
  })

  it('parses product snake_case page pin', () => {
    const r = parseLink(
      'https://app.example/project/product/proj_abc?doc_id=doc_1&doc_type=axure&page_id=894d817247544518beab82db5cb0095d&parent_id=folder:业务相关&version_id=1',
    )
    expect(r.projectId).toBe('proj_abc')
    expect(r.contentTab).toBe('product')
    expect(r.fileType).toBe('product')
    expect(r.fileId).toBe('doc_1')
    expect(r.pageId).toBe('894d817247544518beab82db5cb0095d')
    expect(r.parentId).toBe('folder:业务相关')
    expect(r.docType).toBe('axure')
    expect(r.deliveryMode).toBe('detail')
    expect(r.version).toBe(1)
  })

  it('parses legacy camelCase product query', () => {
    const r = parseLink(
      'https://app.example/project/product/proj_abc?docId=doc_1&docType=axure&pageId=page_legacy&v=2',
    )
    expect(r.fileId).toBe('doc_1')
    expect(r.pageId).toBe('page_legacy')
    expect(r.docType).toBe('axure')
    expect(r.version).toBe(2)
  })

  it('skips editor segment as pageId', () => {
    const r = parseLink('https://app.example/project/design/proj_abc/editor/file_1')
    expect(r.pageId).toBeUndefined()
    expect(r.deliveryMode).toBe('overview')
  })
})

describe('buildDeliveryDetailUrl', () => {
  it('builds canonical design detail URL', () => {
    expect(
      buildDeliveryDetailUrl({
        webBase: 'https://app.example',
        projectId: 'proj_abc',
        fileId: 'file_1',
        artboardId: 'ab_1',
        version: 2,
      }),
    ).toBe('https://app.example/project/design/proj_abc?fileId=file_1&artboardId=ab_1&v=2')
  })

  it('builds product detail URL with snake_case query keys', () => {
    expect(
      buildDeliveryDetailUrl({
        webBase: 'https://app.example',
        projectId: 'proj_abc',
        fileId: 'doc_1',
        pageId: '894d817247544518beab82db5cb0095d',
        parentId: 'folder:Auth',
        docType: 'axure',
        contentTab: 'product',
        version: 1,
      }),
    ).toBe(
      'https://app.example/project/product/proj_abc?doc_id=doc_1&image_id=doc_1&doc_type=axure&page_id=894d817247544518beab82db5cb0095d&parent_id=folder%3AAuth&version_id=1',
    )
  })

  it('omits CJK parent_id from product detail URL', () => {
    expect(
      buildDeliveryDetailUrl({
        webBase: 'https://app.example',
        projectId: 'proj_abc',
        fileId: 'doc_1',
        pageId: '894d817247544518beab82db5cb0095d',
        parentId: 'folder:业务相关',
        docType: 'axure',
        contentTab: 'product',
        version: 1,
      }),
    ).toBe(
      'https://app.example/project/product/proj_abc?doc_id=doc_1&image_id=doc_1&doc_type=axure&page_id=894d817247544518beab82db5cb0095d&version_id=1',
    )
  })
})

describe('resolvePageToArtboards', () => {
  const boards = [
    { id: 'ab_tz', name: '系统-通用设置-时区设置', width: 1440, height: 900 },
    { id: 'ab_conflict', name: '卡BIN管理 / 冲突裁决', width: 1440, height: 900 },
    { id: 'ab_small', name: '注解', width: 200, height: 100, pageName: '注解页' },
  ]

  it('resolves axure pageId to artboard', () => {
    const r = resolvePageToArtboards('axure_page_uuid', [
      { id: 'ab_1', name: '集群概览-概述', axurePageId: 'axure_page_uuid', width: 1440, height: 900 },
    ])
    expect(r.artboardId).toBe('ab_1')
    expect(r.warnings).toEqual([])
  })

  it('resolves board: pageId to exact artboard', () => {
    const r = resolvePageToArtboards('board:ab_conflict', boards)
    expect(r.artboardId).toBe('ab_conflict')
    expect(r.artboardIds).toEqual(['ab_conflict'])
    expect(r.pageName).toBe('卡BIN管理 / 冲突裁决')
    expect(r.warnings).toEqual([])
  })

  it('honors ?artboard= over page default', () => {
    const r = resolvePageToArtboards('page:注解页', boards, 'ab_small')
    expect(r.artboardId).toBe('ab_small')
  })

  it('does not invent an artboard when board: is missing', () => {
    const r = resolvePageToArtboards('board:missing', boards)
    expect(r.artboardId).toBeNull()
    expect(r.artboardIds).toEqual([])
    expect(r.warnings[0]).toMatch(/not found/)
  })

  it('returns empty for overview (no pageId)', () => {
    const r = resolvePageToArtboards(undefined, boards)
    expect(r.artboardId).toBeNull()
    expect(r.artboardIds).toEqual([])
  })

  it('keeps stale preferred artboardId with warning', () => {
    const r = resolvePageToArtboards(undefined, boards, 'ab_stale_old')
    expect(r.artboardId).toBe('ab_stale_old')
    expect(r.artboardIds).toEqual(['ab_stale_old'])
    expect(r.warnings[0]).toMatch(/not in current version/)
  })
})

describe('budget prune', () => {
  it('fits large trees under 30KB', () => {
    const doc: SemDoc = {
      id: 'sem_1',
      artboardId: 'ab_1',
      rev: 1,
      page: { name: 'Big', width: 1440, height: 900 },
      root: makeTree(5, 4),
      diagnostics: Array.from({ length: 50 }, (_, i) => ({
        code: 'unbound_component',
        message: `diag ${i} `.repeat(10),
      })),
    }
    const before = utf8Bytes({ document: doc })
    expect(before).toBeGreaterThan(MAX_TOOL_BYTES)

    const { document, truncated, hints } = pruneSemanticDocument(doc)
    expect(truncated).toBe(true)
    expect(hints.length).toBeGreaterThan(0)
    expect(withinBudget({ document })).toBe(true)
  })

  it('findSemanticNode walks by sourceNodeId', () => {
    const root = makeTree(2, 2)
    const hit = findSemanticNode(root, 'src_n_0_1')
    expect(hit?.node.id).toBe('n_0_1')
    expect(hit?.ancestors.map((a) => a.id)).toEqual(['n', 'n_0'])
  })
})

describe('mappings', () => {
  it('lists uniboot Button mapping', () => {
    const m = mappingFor('Button', 'uniboot')
    expect(m?.tag).toMatch(/button/i)
    const all = listMappings('uniboot', ['Button', 'Input'])
    expect(all.length).toBeGreaterThanOrEqual(1)
  })
})

describe('preview resource uri', () => {
  it('builds ubd:// URI with optional version', () => {
    expect(previewResourceUri('f1', 'a1')).toBe('ubd://files/f1/artboards/a1/preview')
    expect(previewResourceUri('f1', 'a1', 3)).toBe('ubd://files/f1/artboards/a1/preview?version=3')
  })
})
