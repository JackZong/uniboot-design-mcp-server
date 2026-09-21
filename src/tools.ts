import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { api, auditMcp, getWebBase, parseLink } from './api.js'
import { runGenerateAi, type GenerateAiTool } from './generate-prototype.js'
import {
  findSemanticNode,
  mcpText,
  pruneNodeSubtree,
  pruneSemanticDocument,
  wrapErr,
  wrapOk,
  wrapTruncated,
  type SemNode,
} from './budget.js'
import { listMappings, mappingFor } from './mappings.js'
import {
  exampleProjectConfig,
  parseProjectConfig,
  projectConfigFilename,
  projectConfigToToolDefaults,
} from './project-config.js'
import { fetchArtboardPreview, previewResourceUri, type TokenProvider } from './resources.js'
import { qs, resolveFileId, resolveLinkWithFile, resolvePageToArtboards } from './resolve.js'
import {
  looksLikeDeliveryUrl,
  openDelivery,
  pickDeliveryLink,
  collectDesignInventory,
} from './open-delivery.js'
import { collectLayoutOutline } from './layout-outline.js'
import { lintImplementedAgainstChecklist, mergeCompareFindings } from './lint-implemented.js'
import { loadPixelGateContext } from './pixel-gate-context.js'
import {
  catchToolResult as catchResult,
  findGeomNode,
  specFromGeom,
  type ArtboardListItem,
  type GeomNode,
  type SemanticRow,
} from './tool-support.js'

export type { TokenProvider }

async function loadComponentSchema() {
  try {
    return await import('@ubd/component-schema')
  } catch {
    throw new Error(
      '@ubd/component-schema is not installed on this MCP host; list_ui_targets / parse_ui_kit_pack require the UniBoot Design API pack list instead',
    )
  }
}

export function registerTools(server: McpServer, getToken: TokenProvider) {
  server.registerTool(
    'open_delivery',
    {
      description:
        'MUST call this FIRST when the user pastes a UniBoot Design URL or asks to implement/落地/对齐设计 — even if they never name any tool. Returns data.gate FIRST. For product/Axure links also returns data.productBrief (keyTexts/structure/styles/interactions) so Agents can 读懂产品 even when geometry is empty; next.action may be product-understand. Pass config=uniboot-design.json and/or packageJson. Finish pixel work with compare_design_code(screenshot + implementedSource) only when geometry is non-empty.',
      inputSchema: {
        link: z
          .string()
          .optional()
          .describe('Delivery URL: /project/design/{projectId}?fileId=&artboardId='),
        url: z.string().optional().describe('Alias for link'),
        config: z
          .unknown()
          .optional()
          .describe(
            'Optional local uniboot-design.json object; omit for example / stack-detected defaults',
          ),
        packageJson: z
          .unknown()
          .optional()
          .describe(
            'Optional consumer package.json — if element-plus is a dependency and config omitted, auto-use Element Plus defaults instead of uniboot-ui',
          ),
        maxDepth: z.number().optional(),
        maxNodes: z.number().optional(),
        includePreview: z
          .boolean()
          .optional()
          .describe('Attach artboard preview image for visual QA (default true)'),
      },
    },
    async ({ link, url, config, packageJson, maxDepth, maxNodes, includePreview }) => {
      try {
        const delivery = pickDeliveryLink({ link, url })
        if (!delivery) {
          return mcpText(wrapErr('Pass link (or url) — the UniBoot Design delivery URL', 42200))
        }
        const token = getToken()
        const data = await openDelivery(token, {
          link: delivery,
          config,
          packageJson,
          maxDepth,
          maxNodes,
          includePreview,
        })
        auditMcp(token, {
          tool: 'open_delivery',
          resourceType: 'file',
          resourceId: data.fileId,
          meta: { projectId: data.projectId, artboardId: data.artboardId },
        })
        const { _previewBlob, _previewMime, ...publicData } = data
        const truncated = Boolean(data.page?.truncated)
        const textPayload = truncated
          ? wrapTruncated(publicData, data.hints)
          : wrapOk(publicData, data.hints)
        if (_previewBlob && _previewMime) {
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify(textPayload) },
              {
                type: 'image' as const,
                data: _previewBlob,
                mimeType: _previewMime,
              },
            ],
          }
        }
        return mcpText(textPayload)
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'parse_project_config',
    {
      description:
        'Validate local uniboot-design.json ONLY (pass config object or example=true). NEVER use for design URLs — call open_delivery({ link }) instead. If a URL is passed by mistake, this tool redirects to open_delivery.',
      inputSchema: {
        config: z
          .unknown()
          .optional()
          .describe('Parsed JSON object from repo-root uniboot-design.json'),
        example: z
          .boolean()
          .optional()
          .describe('If true (and config omitted), return the default example config'),
        link: z.string().optional().describe('Do not use — redirects to open_delivery'),
        url: z.string().optional().describe('Do not use — redirects to open_delivery'),
      },
    },
    async ({ config, example, link, url }) => {
      try {
        const delivery = pickDeliveryLink({ link, url })
        // Agent often passes { url } or even config=url-string by mistake.
        const configIsUrl =
          looksLikeDeliveryUrl(config) ||
          (typeof config === 'string' && looksLikeDeliveryUrl(config))
        if (delivery || configIsUrl) {
          const token = getToken()
          const data = await openDelivery(token, {
            link: delivery ?? String(config),
            config: configIsUrl ? undefined : config,
          })
          return mcpText(
            wrapOk(
              {
                redirected: true,
                from: 'parse_project_config',
                hint: 'You passed a delivery URL. Prefer open_delivery({ link }) next time. Payload below is the same as open_delivery.',
                ...data,
              },
              data.hints,
            ),
          )
        }
        const raw = config ?? (example ? exampleProjectConfig() : null)
        if (raw == null) {
          return mcpText(
            wrapErr(
              `Pass config (contents of ${projectConfigFilename()}) or example=true. For a design URL use open_delivery({ link }).`,
              42200,
            ),
          )
        }
        const parsed = parseProjectConfig(raw)
        if (!parsed.ok) {
          return mcpText(wrapErr(parsed.errors.join('; '), 42200))
        }
        const defaults = projectConfigToToolDefaults(parsed.config)
        return mcpText(
          wrapOk({
            filename: projectConfigFilename(),
            config: parsed.config,
            warnings: parsed.warnings,
            defaults,
            hint: 'Use defaults.target / defaults.tokenSetId / defaults.paths when calling other tools and writing files',
          }),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'list_ui_targets',
    {
      description:
        'List registered UI Kit Pack target ids (html, uniboot, element-plus, …). Pass teamId/projectId to include team-uploaded packs; optional pack JSON previews withPack.',
      inputSchema: {
        pack: z
          .unknown()
          .optional()
          .describe('Optional UIKitPack JSON to merge before listing targets'),
        teamId: z.string().optional().describe('Include packs uploaded for this team'),
        projectId: z
          .string()
          .optional()
          .describe('Resolve teamId from project when teamId omitted'),
      },
    },
    async ({ pack, teamId, projectId }) => {
      try {
        const { builtinRegistry } = await loadComponentSchema()
        let reg = builtinRegistry()
        if (pack != null) {
          const report = reg.validatePack(pack)
          if (!report.ok) {
            return mcpText(wrapErr(report.errors.join('; '), 42200))
          }
          reg = reg.withPack(pack) as typeof reg
        }

        const builtin = reg.targets().map((id: string) => ({
          id,
          source: 'builtin' as const,
          name: id,
        }))

        let team: Array<{
          id: string
          source: 'team'
          name: string
          rowId?: string
          isDefault?: boolean
          version?: string
        }> = []
        let resolvedTeamId = teamId
        if (!resolvedTeamId && projectId) {
          try {
            const project = await api<{ teamId: string }>(getToken(), `/projects/${projectId}`)
            resolvedTeamId = project.teamId
          } catch {
            /* optional */
          }
        }
        if (resolvedTeamId) {
          try {
            const res = await api<{
              targets: Array<{
                id: string
                source: string
                name: string
                rowId?: string
                isDefault?: boolean
                version?: string
              }>
            }>(getToken(), `/ui-kit-packs/targets?teamId=${resolvedTeamId}`)
            team = (res.targets ?? [])
              .filter((t) => t.source === 'team')
              .map((t) => ({
                id: t.id,
                source: 'team' as const,
                name: t.name,
                rowId: t.rowId,
                isDefault: t.isDefault,
                version: t.version,
              }))
          } catch {
            /* optional */
          }
        }

        return mcpText(
          wrapOk({
            targets: [...builtin, ...team],
            teamId: resolvedTeamId ?? null,
            hint: 'Pass uiTarget / uiKitPackId (rowId) when calling get_rule_code or execute_code_plan',
          }),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'parse_ui_kit_pack',
    {
      description:
        'Validate a UI Kit Pack JSON (Agent reads the file and passes the object here). Returns errors, warnings, and coverage vs built-in semantic components.',
      inputSchema: {
        pack: z.unknown().describe('Parsed UIKitPack JSON object'),
      },
    },
    async ({ pack }) => {
      try {
        const { builtinRegistry, UIKitPackSchema } = await loadComponentSchema()
        const schema = UIKitPackSchema.safeParse(pack)
        if (!schema.success) {
          return mcpText(
            wrapErr(
              schema.error.issues
                .map((i) => `${i.path.join('.')}: ${i.message}`)
                .join('; '),
              42200,
            ),
          )
        }
        const report = builtinRegistry().validatePack(pack)
        return mcpText(
          wrapOk({
            ok: report.ok,
            packId: schema.data.id,
            errors: report.errors,
            warnings: report.warnings,
            coverage: report.coverage,
            hint: report.ok
              ? 'Pack is valid. Upload via POST /ui-kit-packs (team admin) or pass uiKitPackId / uiTarget when generating code.'
              : 'Fix errors before using this pack as a codegen target.',
          }),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'resolve_link',
    {
      description:
        'Low-level: parse delivery URL into IDs only. Prefer open_delivery (returns page too). Accepts link or url.',
      inputSchema: {
        link: z
          .string()
          .optional()
          .describe(
            'Delivery URL, e.g. https://host/project/design/<projectId>?fileId=<fileId>&artboardId=<artboardId>&v=2 or product https://host/project/product/<projectId>?doc_id=&doc_type=axure&page_id=&version_id=',
          ),
        url: z.string().optional().describe('Alias for link'),
      },
    },
    async ({ link, url }) => {
      try {
        const delivery = pickDeliveryLink({ link, url })
        if (!delivery) {
          return mcpText(wrapErr('Pass link (or url)', 42200))
        }
        const token = getToken()
        const resolved = await resolveLinkWithFile(token, delivery)
        return mcpText(
          wrapOk(
            {
              projectId: resolved.projectId,
              fileId: resolved.fileId,
              version: resolved.version,
              pageId: resolved.pageId ?? null,
              artboardId: resolved.artboardId ?? null,
              artboardIds: resolved.artboardIds ?? [],
              pageName: resolved.pageName ?? null,
              deliveryDetailUrl: resolved.deliveryDetailUrl ?? null,
              previewUrl: resolved.previewUrl ?? null,
              contentTab: resolved.contentTab,
              deliveryMode: resolved.deliveryMode,
              fileType: resolved.fileType,
              files: resolved.files.map((f) => ({ id: f.id, name: f.name, type: f.type })),
              warnings: resolved.warnings,
              next: resolved.artboardId
                ? {
                    tool: 'open_delivery',
                    alt: 'get_design_page',
                    fileId: resolved.fileId,
                    artboardId: resolved.artboardId,
                    hint: 'Prefer open_delivery({ link }) for page + defaults in one call',
                  }
                : {
                    tool: 'list_artboards',
                    fileId: resolved.fileId,
                    note: 'Ask user which page; do not guess',
                  },
            },
            resolved.hints,
          ),
        )
      } catch (err) {
        // Offline / no token: still return parsed fields
        try {
          const delivery = pickDeliveryLink({ link, url }) ?? ''
          const parsed = parseLink(delivery)
          return mcpText(
            wrapOk({
              ...parsed,
              fileId: parsed.fileId ?? null,
              artboardId: parsed.artboardId ?? null,
              warnings: [
                'fileId unresolved: ' + (err instanceof Error ? err.message : String(err)),
              ],
            }),
          )
        } catch {
          return catchResult(err)
        }
      }
    },
  )

  server.registerTool(
    'list_artboards',
    {
      description:
        'List artboards (pages) under a design file with preview URLs. If resolve_link already returned artboardId, skip this and call get_design_page directly. When link has pageId, matching artboards are marked preferred.',
      inputSchema: {
        fileId: z.string().optional(),
        projectId: z.string().optional(),
        link: z.string().optional().describe('Delivery link; used when fileId omitted'),
        version: z.number().optional(),
        pageId: z
          .string()
          .optional()
          .describe('Delivery pageId from resolve_link; marks matching artboards as preferred'),
      },
    },
    async ({ fileId, projectId, link, version, pageId }) => {
      try {
        const token = getToken()
        const fromLink = link ? await resolveLinkWithFile(token, link) : null
        const resolved = fromLink
          ? {
              fileId: fromLink.fileId,
              projectId: fromLink.projectId,
              version: fromLink.version,
              warnings: fromLink.warnings,
            }
          : await resolveFileId(token, { fileId, projectId, link })
        const ver = version ?? resolved.version
        const artboards = await api<ArtboardListItem[]>(
          token,
          `/files/${resolved.fileId}/artboards${qs({ version: ver })}`,
        )
        const effectivePageId = pageId ?? fromLink?.pageId
        const preferredId = fromLink?.artboardId
        const preferredIds = new Set(
          [...(fromLink?.artboardIds ?? []), ...(preferredId ? [preferredId] : [])].filter(Boolean),
        )
        // Also resolve explicit pageId against this list when link was not used
        if (effectivePageId && !fromLink) {
          const hit = resolvePageToArtboards(effectivePageId, artboards, preferredId)
          for (const id of hit.artboardIds) preferredIds.add(id)
          if (hit.artboardId) preferredIds.add(hit.artboardId)
        }
        const slim = artboards.map((a) => ({
          id: a.id,
          name: a.name,
          width: a.width,
          height: a.height,
          previewUrl: a.previewUrl,
          resourceUri: previewResourceUri(resolved.fileId, a.id, ver),
          groupName: a.groupName ?? null,
          preferred: preferredIds.has(a.id),
        }))
        const preferred = slim.filter((a) => a.preferred)
        auditMcp(token, {
          tool: 'list_artboards',
          resourceType: 'file',
          resourceId: resolved.fileId,
          meta: {
            artboardCount: slim.length,
            version: ver ?? null,
            preferredCount: preferred.length,
          },
        })
        const hints: string[] = []
        if (preferred.length === 1) {
          hints.push(
            `Use preferred artboardId=${preferred[0]!.id} (${preferred[0]!.name}) with get_design_page — do not pick another.`,
          )
        } else if (preferred.length > 1) {
          hints.push(
            `Link matches ${preferred.length} artboards; confirm which one with the user before get_design_page.`,
          )
        } else if (!effectivePageId) {
          hints.push('No pageId in link — ask the user which artboard. Do not pick by list order.')
        }
        return mcpText(
          wrapOk(
            {
              fileId: resolved.fileId,
              projectId: resolved.projectId,
              version: ver ?? null,
              pageId: effectivePageId ?? null,
              preferredArtboardId: preferred[0]?.id ?? fromLink?.artboardId ?? null,
              artboards: slim,
              warnings: resolved.warnings,
              hint: 'Read resourceUri (MCP resource) or call get_artboard_preview to see the design image',
            },
            hints,
          ),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_design_page',
    {
      description:
        'Fetch SemanticDocument when you already have fileId+artboardId. If you only have a URL, call open_delivery instead. Also accepts link/url.',
      inputSchema: {
        fileId: z.string().optional(),
        artboardId: z
          .string()
          .optional()
          .describe('Exact artboard from open_delivery / resolve_link'),
        link: z.string().optional().describe('Delivery URL — resolves fileId+artboardId'),
        url: z.string().optional().describe('Alias for link'),
        rev: z.number().optional().describe('Semantic pipeline rev; omit for latest'),
        maxDepth: z.number().optional().describe('Max tree depth before stubbing (default 5)'),
        maxNodes: z.number().optional().describe('Max nodes before stubbing (default 120)'),
      },
    },
    async ({ fileId, artboardId, link, url, rev, maxDepth, maxNodes }) => {
      try {
        const token = getToken()
        let fid = fileId
        let aid = artboardId
        const delivery = pickDeliveryLink({ link, url })
        if ((!fid || !aid) && delivery) {
          const resolved = await resolveLinkWithFile(token, delivery)
          fid = fid || resolved.fileId
          aid = aid || resolved.artboardId || undefined
        }
        if (!fid || !aid) {
          return mcpText(
            wrapErr(
              'Pass fileId+artboardId, or link/url. Prefer open_delivery({ link }) for a one-shot start.',
              42200,
            ),
          )
        }
        const row = await api<SemanticRow>(
          token,
          `/files/${fid}/artboards/${aid}/semantic${qs({ rev })}`,
        )
        if (row.status !== 'ready' || !row.document) {
          return mcpText(
            wrapOk({
              status: row.status,
              artboardId: row.artboardId,
              rev: row.rev,
              pipelineRev: row.pipelineRev,
              error: row.error,
              hint:
                row.status === 'pending' || row.status === 'processing'
                  ? 'Semantic pipeline still running; retry get_design_page in a few seconds'
                  : 'Semantic unavailable; fall back to get_design_context (legacy geometry)',
            }),
          )
        }
        const { document, hints, truncated } = pruneSemanticDocument(row.document, {
          maxDepth,
          maxNodes,
        })
        const layoutOutline = collectLayoutOutline(row.document)
        const inventory = collectDesignInventory(row.document)
        const payload = {
          status: row.status,
          artboardId: row.artboardId,
          rev: row.rev,
          pipelineRev: row.pipelineRev,
          tokenSetId: row.tokenSetId,
          previewResourceUri: previewResourceUri(fid, aid),
          layoutOutline,
          inventory: {
            texts: inventory.texts.slice(0, 40),
            buttons: inventory.buttons.slice(0, 20),
            icons: inventory.icons.slice(0, 30),
            components: inventory.components,
            tables: inventory.tables,
          },
          document,
        }
        const allHints = [...hints, ...layoutOutline.structureContract, ...layoutOutline.warnings]
        auditMcp(token, {
          tool: 'get_design_page',
          resourceType: 'artboard',
          resourceId: aid,
          meta: { fileId: fid, rev: row.rev, truncated, cardCount: layoutOutline.cardCount },
        })
        return mcpText(truncated ? wrapTruncated(payload, allHints) : wrapOk(payload, allHints))
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_design_node',
    {
      description:
        'Fetch a single semantic node + ancestor chain. Use when editing one card/section.',
      inputSchema: {
        fileId: z.string(),
        artboardId: z.string(),
        nodeId: z.string().describe('Semantic node id or sourceNodeId'),
        rev: z.number().optional(),
        maxDepth: z.number().optional(),
      },
    },
    async ({ fileId, artboardId, nodeId, rev, maxDepth }) => {
      try {
        const token = getToken()
        const row = await api<SemanticRow>(
          token,
          `/files/${fileId}/artboards/${artboardId}/semantic${qs({ rev })}`,
        )
        if (row.status !== 'ready' || !row.document?.root) {
          return mcpText(
            wrapOk({
              status: row.status,
              error: row.error ?? 'Semantic document not ready',
              hint: 'Retry later or use get_design_context for geometry',
            }),
          )
        }
        const hit = findSemanticNode(row.document.root, nodeId)
        if (!hit) {
          return mcpText(wrapErr(`Node not found: ${nodeId}`, 40400))
        }
        const pruned = pruneNodeSubtree(hit.node, { maxDepth: maxDepth ?? 4 })
        const ancestors = hit.ancestors.map((a) => ({
          id: a.id,
          sourceNodeId: a.sourceNodeId,
          component: a.component,
          confidence: a.confidence,
        }))
        const payload = {
          artboardId: row.artboardId,
          rev: row.rev,
          node: pruned.node,
          ancestors,
        }
        return mcpText(
          pruned.truncated ? wrapTruncated(payload, pruned.hints) : wrapOk(payload, pruned.hints),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_design_spec',
    {
      description:
        'Node geometry annotations: box.x/y, relative.offsetLeft/Top, spacing, typography, fills, tokenRefs. Call BEFORE writing toolbar/footer CSS when open_delivery.keySpecs is missing a control. Prefer open_delivery.gate.keySpecsSummary first; use this for deeper dig on one nodeId.',
      inputSchema: {
        fileId: z.string(),
        artboardId: z.string(),
        nodeId: z.string().describe('Geometry/source node id from keySpecs or inventory'),
        version: z.number().optional(),
      },
    },
    async ({ fileId, artboardId, nodeId, version }) => {
      try {
        const token = getToken()
        const document = await api<{ root?: GeomNode }>(
          token,
          `/files/${fileId}/artboards/${artboardId}/document${qs({ version })}`,
        )
        const node = findGeomNode(document.root, nodeId)
        if (!node) return mcpText(wrapErr(`Geometry node not found: ${nodeId}`, 40400))

        // Enrich with semantic tokens if available
        let semantic: SemNode | null = null
        try {
          const row = await api<SemanticRow>(
            token,
            `/files/${fileId}/artboards/${artboardId}/semantic`,
          )
          if (row.document?.root) {
            semantic = findSemanticNode(row.document.root, nodeId)?.node ?? null
          }
        } catch {
          /* optional */
        }

        return mcpText(
          wrapOk({
            ...specFromGeom(node, document.root),
            semantic: semantic
              ? {
                  component: semantic.component,
                  confidence: semantic.confidence,
                  props: semantic.props,
                  styleTokens: semantic.style?.tokens ?? {},
                  binding: semantic.binding ?? null,
                }
              : null,
          }),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_design_token',
    {
      description:
        'Fetch design tokens for a team/token set. Use when writing styles — prefer CSS variables over hard-coded colors.',
      inputSchema: {
        tokenSetId: z.string().optional().describe('Specific token set id'),
        teamId: z
          .string()
          .optional()
          .describe('List sets for team; picks default if tokenSetId omitted'),
        projectId: z
          .string()
          .optional()
          .describe('Resolve team via project, then default token set'),
        pathPrefix: z.string().optional().describe('Filter token paths, e.g. color.brand'),
        projectConfig: z
          .unknown()
          .optional()
          .describe('Optional uniboot-design.json; fills tokenSetId/projectId'),
      },
    },
    async ({ tokenSetId, teamId, projectId, pathPrefix, projectConfig }) => {
      try {
        const token = getToken()
        let setId = tokenSetId
        let resolvedTeamId = teamId
        let cssPrefix = '--'
        const warnings: string[] = []

        if (projectConfig != null) {
          const parsed = parseProjectConfig(projectConfig)
          if (!parsed.ok) return mcpText(wrapErr(parsed.errors.join('; '), 42200))
          const d = projectConfigToToolDefaults(parsed.config)
          setId = setId ?? d.tokenSetId ?? undefined
          projectId = projectId ?? d.projectId ?? undefined
          cssPrefix = d.cssPrefix.endsWith('-') ? d.cssPrefix : `${d.cssPrefix}-`
          warnings.push(...parsed.warnings)
        }

        if (!setId && projectId) {
          const project = await api<{ teamId: string }>(token, `/projects/${projectId}`)
          resolvedTeamId = project.teamId
        }

        if (!setId) {
          const sets = await api<
            Array<{
              id: string
              name: string
              isDefault: boolean
              teamId: string
              tokenCount: number
            }>
          >(token, `/token-sets${qs({ teamId: resolvedTeamId })}`)
          const preferred =
            sets.find((s) => s.isDefault && (!resolvedTeamId || s.teamId === resolvedTeamId)) ??
            sets.find((s) => !resolvedTeamId || s.teamId === resolvedTeamId) ??
            sets[0]
          if (!preferred) return mcpText(wrapErr('No token sets found', 40400))
          setId = preferred.id
        }

        const detail = await api<{
          id: string
          name: string
          teamId: string
          basePreset: string | null
          rev: number
          tokens?: Array<{ path: string; type: string; value: unknown; origin?: string }>
        }>(token, `/token-sets/${setId}?include=tokens`)

        let tokens = detail.tokens ?? []
        if (pathPrefix) {
          tokens = tokens.filter((t) => t.path.startsWith(pathPrefix))
        }

        // Cap list size to stay under budget
        const hints: string[] = [...warnings]
        const MAX = 200
        if (tokens.length > MAX) {
          hints.push(`showing first ${MAX} of ${tokens.length} tokens; narrow with pathPrefix`)
          tokens = tokens.slice(0, MAX)
        }

        const payload = {
          tokenSetId: detail.id,
          name: detail.name,
          teamId: detail.teamId,
          basePreset: detail.basePreset,
          rev: detail.rev,
          tokens: tokens.map((t) => ({
            path: t.path,
            type: t.type,
            value: t.value,
            origin: t.origin,
            cssVar: `${cssPrefix}${t.path.replace(/\./g, '-')}`,
          })),
        }
        return mcpText(hints.length ? wrapTruncated(payload, hints) : wrapOk(payload, hints))
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_component_mapping',
    {
      description:
        'Map semantic component names (Button/Input/…) to target framework tags & props. Includes project bindings when projectId given.',
      inputSchema: {
        target: z
          .string()
          .optional()
          .describe('UI kit target: uniboot | html | element-plus (default uniboot)'),
        components: z
          .array(z.string())
          .optional()
          .describe('Filter to these semantic names; omit for all'),
        projectId: z.string().optional().describe('Include project ComponentBinding overrides'),
        projectConfig: z
          .unknown()
          .optional()
          .describe('Optional uniboot-design.json; fills target/projectId when omitted'),
      },
    },
    async ({ target, components, projectId, projectConfig }) => {
      try {
        let tgt = target ?? 'uniboot'
        let pid = projectId
        const warnings: string[] = []
        if (projectConfig != null) {
          const parsed = parseProjectConfig(projectConfig)
          if (!parsed.ok) return mcpText(wrapErr(parsed.errors.join('; '), 42200))
          const d = projectConfigToToolDefaults(parsed.config)
          tgt = target ?? d.target
          pid = projectId ?? d.projectId ?? undefined
          warnings.push(...parsed.warnings)
        }
        const mappings = listMappings(tgt, components)
        let bindings: Array<{
          id: string
          sourceComponentKey: string
          sourceComponentName?: string | null
          specName: string
          propMap?: Record<string, string> | null
          scope: string
        }> = []
        if (pid) {
          try {
            bindings = await api(getToken(), `/projects/${pid}/component-bindings`)
          } catch {
            /* optional */
          }
        }
        return mcpText(
          wrapOk({
            target: tgt,
            projectId: pid ?? null,
            warnings,
            mappings,
            bindings: bindings.map((b) => ({
              sourceComponentKey: b.sourceComponentKey,
              sourceComponentName: b.sourceComponentName,
              specName: b.specName,
              propMap: b.propMap,
              scope: b.scope,
              mapping: mappingFor(b.specName, tgt),
            })),
          }),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'export_artboard_assets',
    {
      description:
        'Export PNG slices for pixel-faithful icons. Prefer mode=icons with nodeIds from open_delivery.keySpecs.iconNodeIds (or inventory.icons). mode=full exports the whole artboard rect. Then poll get_assets({ jobId }).',
      inputSchema: {
        fileId: z.string(),
        artboardId: z.string(),
        version: z.number().optional(),
        mode: z
          .enum(['icons', 'nodes', 'full'])
          .optional()
          .describe(
            'icons|nodes use nodeIds; full uses artboard rect (default icons when nodeIds provided)',
          ),
        nodeIds: z
          .array(z.string())
          .optional()
          .describe('Geometry/source node ids to slice — from keySpecs.iconNodeIds'),
        width: z.number().optional().describe('Full-artboard width when mode=full'),
        height: z.number().optional().describe('Full-artboard height when mode=full'),
        scales: z.array(z.number()).optional().describe('Default [1, 2]'),
        format: z.enum(['png', 'jpg', 'webp', 'svg']).optional(),
      },
    },
    async ({ fileId, artboardId, version, mode, nodeIds, width, height, scales, format }) => {
      try {
        const token = getToken()
        const ids = (nodeIds ?? []).filter(Boolean).slice(0, 40)
        const resolvedMode = mode ?? (ids.length ? 'icons' : 'full')
        const body =
          resolvedMode === 'full' || !ids.length
            ? {
                version,
                artboardId,
                rect: { x: 0, y: 0, w: width ?? 1440, h: height ?? 900 },
                scales: scales ?? [1, 2],
                format: format ?? 'png',
              }
            : {
                version,
                artboardId,
                nodeIds: ids,
                scales: scales ?? [1, 2],
                format: format ?? 'png',
              }
        const data = await api<{ jobId: string; status: string }>(
          token,
          `/files/${fileId}/slices`,
          {
            method: 'POST',
            body: JSON.stringify(body),
          },
        )
        auditMcp(token, {
          tool: 'export_artboard_assets',
          resourceType: 'artboard',
          resourceId: artboardId,
          meta: { fileId, jobId: data.jobId, mode: resolvedMode, nodeCount: ids.length },
        })
        return mcpText(
          wrapOk({
            ...data,
            mode: resolvedMode,
            nodeIds: resolvedMode === 'full' ? [] : ids,
            next: {
              tool: 'get_assets',
              jobId: data.jobId,
              note: 'Poll until status=done, then download each assets[].downloadUrl to assets[].suggestedPath',
            },
            hint:
              resolvedMode === 'full'
                ? 'Full-artboard export — prefer mode=icons with keySpecs.iconNodeIds for per-icon PNGs'
                : `Slicing ${ids.length} icon/nodes — replace generic Element Plus icons with these files`,
          }),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_assets',
    {
      description:
        'Slice/export download URLs with suggested on-disk paths. Pass jobId from export_artboard_assets. Prefer over download_slices.',
      inputSchema: {
        jobId: z
          .string()
          .describe('Slice job id from export_artboard_assets or POST /files/:fileId/slices'),
        pathPrefix: z.string().optional().describe('Suggested folder, default assets/design'),
        projectConfig: z
          .unknown()
          .optional()
          .describe('Optional uniboot-design.json; uses paths.assets as pathPrefix'),
      },
    },
    async ({ jobId, pathPrefix, projectConfig }) => {
      try {
        let prefix = pathPrefix
        if (!prefix && projectConfig != null) {
          const parsed = parseProjectConfig(projectConfig)
          if (parsed.ok) prefix = projectConfigToToolDefaults(parsed.config).paths.assets
        }
        const data = await api<{
          jobId: string
          status: string
          items: Array<{ name: string; scale: number; downloadUrl: string }>
          zipUrl: string | null
          error: string | null
        }>(getToken(), `/slices/${jobId}`)
        const base = (prefix ?? 'assets/design').replace(/\/$/, '')
        return mcpText(
          wrapOk({
            jobId: data.jobId,
            status: data.status,
            error: data.error,
            zipUrl: data.zipUrl,
            assets: (data.items ?? []).map((item) => ({
              name: item.name,
              scale: item.scale,
              downloadUrl: item.downloadUrl,
              suggestedPath: `${base}/${item.name}`,
            })),
          }),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_artboard_preview',
    {
      description:
        'Fetch artboard preview as an image (base64) — use as visual acceptance standard. open_delivery already attaches this by default; call again if you skipped includePreview.',
      inputSchema: {
        fileId: z.string(),
        artboardId: z.string(),
        version: z.number().optional(),
      },
    },
    async ({ fileId, artboardId, version }) => {
      try {
        const token = getToken()
        const preview = await fetchArtboardPreview(token, fileId, artboardId, { version })
        auditMcp(token, {
          tool: 'get_artboard_preview',
          resourceType: 'artboard',
          resourceId: artboardId,
          meta: { fileId, version: version ?? null, bytes: preview.byteLength },
        })
        const meta = wrapOk({
          fileId,
          artboardId,
          version: version ?? null,
          mimeType: preview.mimeType,
          byteLength: preview.byteLength,
          resourceUri: previewResourceUri(fileId, artboardId, version),
          sourceUrl: preview.sourceUrl,
        })
        const raster = /^(image\/(png|jpe?g|gif|webp))$/i.test(preview.mimeType)
        if (!raster) {
          return mcpText(
            wrapOk(
              {
                fileId,
                artboardId,
                version: version ?? null,
                mimeType: preview.mimeType,
                byteLength: preview.byteLength,
                resourceUri: previewResourceUri(fileId, artboardId, version),
                sourceUrl: preview.sourceUrl,
                skippedImage: true,
              },
              [
                'Preview is not a raster image (often an HTML prototype stub). Open the AI prototype workbench editorUrl instead of treating this as a design Frame.',
              ],
            ),
          )
        }
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(meta) },
            {
              type: 'image' as const,
              data: preview.blob,
              mimeType: preview.mimeType,
            },
          ],
        }
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_design_context',
    {
      description:
        '[LEGACY] Full geometry Document + preview URL. Prefer open_delivery / get_design_page. Use only when semantic status≠ready. Pass fileId+artboardId or link/url.',
      inputSchema: {
        fileId: z.string().optional(),
        version: z.number().optional(),
        artboardId: z.string().optional(),
        link: z.string().optional(),
        url: z.string().optional(),
        nodeIds: z.array(z.string()).optional(),
      },
    },
    async ({ fileId, version, artboardId, link, url, nodeIds }) => {
      try {
        const token = getToken()
        let fid = fileId
        let aid = artboardId
        const delivery = pickDeliveryLink({ link, url })
        if ((!fid || !aid) && delivery) {
          const resolved = await resolveLinkWithFile(token, delivery)
          fid = fid || resolved.fileId
          aid = aid || resolved.artboardId || undefined
        }
        if (!fid || !aid) {
          return mcpText(
            wrapErr(
              'Pass fileId+artboardId, or link/url. Prefer open_delivery for semantic start.',
              42200,
            ),
          )
        }
        const document = await api(
          token,
          `/files/${fid}/artboards/${aid}/document${qs({ version })}`,
        )
        const preview = await api<{ url: string }>(
          token,
          `/files/${fid}/artboards/${aid}/preview-url${qs({ version })}`,
        )
        const payload = {
          legacy: true,
          warning:
            'Prefer open_delivery / get_design_page for SemanticDocument (≤30KB). This returns full geometry.',
          document,
          previewUrl: preview.url,
          nodeIds: nodeIds ?? [],
        }
        // Geometry often exceeds budget — wrap with truncated meta + hint
        return mcpText(
          wrapTruncated(payload, [
            'geometry may exceed 30KB; filter with nodeIds or switch to open_delivery / get_design_page / get_design_node',
          ]),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'list_slices',
    {
      description: 'Get slice job status/items (alias: prefer get_assets for download paths)',
      inputSchema: { jobId: z.string() },
    },
    async ({ jobId }) => {
      try {
        return mcpText(wrapOk(await api(getToken(), `/slices/${jobId}`)))
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'download_slices',
    {
      description: '[LEGACY] Same as get_assets without suggested paths',
      inputSchema: { jobId: z.string() },
    },
    async ({ jobId }) => {
      try {
        return mcpText(wrapOk(await api(getToken(), `/slices/${jobId}`)))
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'execute_code_plan',
    {
      description:
        'SCAFFOLD ONLY — opt-in via confirmScaffold=true. Generates starter stubs (often empty tables / placeholder copy). NOT pixel-accurate. Prefer hand-writing against open_delivery.gate + keySpecs. After scaffold you MUST still export icons and compare_design_code(screenshot + implementedSource).',
      inputSchema: {
        confirmScaffold: z
          .boolean()
          .describe(
            'REQUIRED true to run. Without it the tool refuses — prevents accidental scaffold-as-final-UI.',
          ),
        fileId: z.string(),
        artboardId: z.string(),
        version: z.number().optional(),
        pageSlug: z.string().optional(),
        projectConfig: z.unknown().optional(),
        plan: z.unknown().optional().describe('Optional edited plan from get_code_plan'),
        framework: z.enum(['html', 'vue', 'react']).optional(),
        style: z
          .enum(['css', 'css-module', 'tailwind', 'element-plus', 'uniboot-ui', 'bootstrap'])
          .optional(),
        uiTarget: z.string().optional().describe('Mapping target id (builtin or team packId)'),
        uiKitPackId: z
          .string()
          .optional()
          .describe('Team UiKitPack row id from list_ui_targets / POST /ui-kit-packs'),
        existingFiles: z
          .union([
            z.record(z.string()),
            z.array(z.object({ path: z.string(), content: z.string() })),
          ])
          .optional()
          .describe('Current workspace file contents for idempotent regenerate'),
        protectExisting: z
          .boolean()
          .optional()
          .describe('Keep hand-edits when colliding (default true)'),
        sourceComments: z
          .boolean()
          .optional()
          .describe('Emit <!-- ubd:nodeId --> / {/* ubd:nodeId */} markers'),
        qualityGate: z
          .boolean()
          .optional()
          .describe('Run structural quality gate (+ prettier if available), retry once'),
      },
    },
    async ({
      confirmScaffold,
      fileId,
      artboardId,
      version,
      pageSlug,
      projectConfig,
      plan,
      framework,
      style,
      uiTarget,
      uiKitPackId,
      existingFiles,
      protectExisting,
      sourceComments,
      qualityGate,
    }) => {
      try {
        if (confirmScaffold !== true) {
          return mcpText(
            wrapOk({
              refused: true,
              scaffoldOnly: true,
              code: 'confirm_scaffold_required',
              message:
                'execute_code_plan is scaffold-only and refused without confirmScaffold=true. Prefer hand-writing from open_delivery.gate (keySpecs + pixelChecklist). If you still need stubs, retry with confirmScaffold=true then hand-align + compare_design_code(screenshot + implementedSource).',
              next: {
                prefer: 'hand-write from open_delivery.gate',
                or: { tool: 'execute_code_plan', confirmScaffold: true },
              },
            }),
          )
        }
        const token = getToken()
        const data = await api(
          token,
          `/files/${fileId}/artboards/${artboardId}/code-plan/generate`,
          {
            method: 'POST',
            body: JSON.stringify({
              version,
              pageSlug,
              projectConfig,
              plan,
              framework,
              style,
              uiTarget,
              uiKitPackId,
              existingFiles,
              protectExisting,
              sourceComments,
              qualityGate,
            }),
          },
        )
        auditMcp(token, {
          tool: 'execute_code_plan',
          resourceType: 'artboard',
          resourceId: artboardId,
          meta: {
            fileId,
            hasExisting: Boolean(existingFiles),
            uiTarget,
            uiKitPackId,
            confirmScaffold: true,
          },
        })
        return mcpText(
          wrapOk({
            scaffoldOnly: true,
            warning:
              'Generated files are scaffolds, not design-faithful UI. Replace placeholders, export icons via export_artboard_assets, match open_delivery preview, then compare_design_code(screenshot + implementedSource).',
            next: [
              'Hand-edit to match get_artboard_preview / open_delivery preview',
              'export_artboard_assets → get_assets → save icons',
              'compare_design_code with screenshot + implementedSource + implementedComponents',
            ],
            ...(data as object),
          }),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_code_plan',
    {
      description:
        'Build a multi-file path plan from SemanticDocument (paths only, no finished UI). Prefer open_delivery first. Pass projectConfig from the consumer repo uniboot-design.json (element-plus paths etc.) — example defaults often wrong. execute_code_plan after this is still scaffold-only.',
      inputSchema: {
        fileId: z.string(),
        artboardId: z.string(),
        version: z.number().optional(),
        pageSlug: z.string().optional().describe('Folder slug under paths.views, e.g. order'),
        projectConfig: z.unknown().optional(),
        minConfidence: z.number().optional(),
        prdId: z.string().optional().describe('S8 PRD id — attach acceptanceCriteria'),
      },
    },
    async ({ fileId, artboardId, version, pageSlug, projectConfig, minConfidence, prdId }) => {
      try {
        const token = getToken()
        const data = await api(token, `/files/${fileId}/artboards/${artboardId}/code-plan`, {
          method: 'POST',
          body: JSON.stringify({
            version,
            pageSlug,
            projectConfig,
            minConfidence,
            prdId,
          }),
        })
        auditMcp(token, {
          tool: 'get_code_plan',
          resourceType: 'artboard',
          resourceId: artboardId,
          meta: { fileId, prdId },
        })
        return mcpText(wrapOk(data))
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_prd',
    {
      description:
        'S8: Fetch a project PRD. Pass prdId, or projectId to list/auto-pick. Design-only links: skip this — use open_delivery.',
      inputSchema: {
        prdId: z.string().optional(),
        projectId: z
          .string()
          .optional()
          .describe('If prdId omitted: list PRDs; auto-fetch when exactly one exists'),
      },
    },
    async ({ prdId, projectId }) => {
      try {
        const token = getToken()
        let id = prdId
        if (!id && projectId) {
          const rows = (await api<
            Array<{ id: string; title: string; status: string; updatedAt?: string }>
          >(token, `/projects/${encodeURIComponent(projectId)}/prds`)) as Array<{
            id: string
            title: string
            status: string
            updatedAt?: string
          }>
          if (!rows.length) {
            return mcpText(
              wrapOk({
                projectId,
                prds: [],
                hint: 'No PRDs in this project. For design implementation use open_delivery({ link }) — get_prd is optional.',
              }),
            )
          }
          if (rows.length > 1) {
            return mcpText(
              wrapOk({
                projectId,
                prds: rows.map((r) => ({
                  id: r.id,
                  title: r.title,
                  status: r.status,
                  updatedAt: r.updatedAt,
                })),
                hint: 'Multiple PRDs — pass prdId to get_prd, or skip PRD and use open_delivery for design-only work.',
              }),
            )
          }
          id = rows[0]!.id
        }
        if (!id) {
          return mcpText(
            wrapErr(
              'Pass prdId, or projectId to list/auto-pick. Design URLs: use open_delivery({ link }) instead.',
              42200,
            ),
          )
        }
        const data = await api(token, `/prds/${id}`)
        auditMcp(token, {
          tool: 'get_prd',
          resourceType: 'prd',
          resourceId: id,
        })
        return mcpText(wrapOk(data))
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'list_prds',
    {
      description:
        'List PRDs under a project (id/title/status). Use before get_prd when you only have projectId. Design-only work: skip — open_delivery already returns data.prds.',
      inputSchema: {
        projectId: z.string(),
      },
    },
    async ({ projectId }) => {
      try {
        const token = getToken()
        const rows = (await api<
          Array<{ id: string; title: string; status: string; updatedAt?: string }>
        >(token, `/projects/${encodeURIComponent(projectId)}/prds`)) as Array<{
          id: string
          title: string
          status: string
          updatedAt?: string
        }>
        return mcpText(
          wrapOk({
            projectId,
            prds: rows.map((r) => ({
              id: r.id,
              title: r.title,
              status: r.status,
              updatedAt: r.updatedAt,
            })),
            hint:
              rows.length === 0
                ? 'No PRDs — implement from open_delivery page document'
                : 'Pass prdId to get_prd / list_prd_acceptance when needed',
          }),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'list_prd_acceptance',
    {
      description:
        'S8: List acceptance criteria and user stories for a PRD (checklist for Cursor implementation / QA).',
      inputSchema: {
        prdId: z.string(),
      },
    },
    async ({ prdId }) => {
      try {
        const token = getToken()
        const data = await api(token, `/prds/${prdId}/acceptance`)
        auditMcp(token, {
          tool: 'list_prd_acceptance',
          resourceType: 'prd',
          resourceId: prdId,
        })
        return mcpText(wrapOk(data))
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_tech_spec',
    {
      description:
        'S9: Fetch Tech Spec drafts for a PRD (stack, entities, OpenAPI, SQL/Prisma, scaffold files, backend tasks). Implement in the existing backend repo using the chosen language/framework/database/middleware. Platform does not run a backend.',
      inputSchema: {
        prdId: z.string(),
      },
    },
    async ({ prdId }) => {
      try {
        const token = getToken()
        const data = await api(token, `/prds/${prdId}`)
        auditMcp(token, {
          tool: 'get_tech_spec',
          resourceType: 'prd',
          resourceId: prdId,
        })
        const tech = (data as { techSpec?: unknown })?.techSpec ?? null
        return mcpText(wrapOk({ prdId, techSpec: tech }))
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'list_backend_tasks',
    {
      description:
        'S9: List Cursor backend task package for a PRD (OpenAPI-aligned tasks + suggested files). Execute in the existing backend repo; do not scaffold a new server.',
      inputSchema: {
        prdId: z.string(),
      },
    },
    async ({ prdId }) => {
      try {
        const token = getToken()
        const data = await api(token, `/prds/${prdId}/backend-tasks`)
        auditMcp(token, {
          tool: 'list_backend_tasks',
          resourceType: 'prd',
          resourceId: prdId,
        })
        return mcpText(wrapOk(data))
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_prd_run',
    {
      description:
        'S10: Latest or specific PRD pipeline run (spec → prototype → tech → code → sandbox → QA). Use after the product clicks 运行全链路.',
      inputSchema: {
        prdId: z.string(),
        runId: z.string().optional(),
      },
    },
    async ({ prdId, runId }) => {
      try {
        const token = getToken()
        const data = runId
          ? await api(token, `/prds/${prdId}/runs/${runId}`)
          : ((await api(token, `/prds/${prdId}/runs`)) as unknown[])
        auditMcp(token, {
          tool: 'get_prd_run',
          resourceType: 'prd',
          resourceId: runId || prdId,
        })
        return mcpText(wrapOk(Array.isArray(data) ? (data[0] ?? null) : data))
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_qa_report',
    {
      description:
        'S12: Fetch acceptance QA report for a PRD run (AC pass/fail + generated Playwright source). Prefer after get_prd_run.',
      inputSchema: {
        prdId: z.string(),
        runId: z.string().optional(),
      },
    },
    async ({ prdId, runId }) => {
      try {
        const token = getToken()
        let id = runId
        if (!id) {
          const rows = (await api(token, `/prds/${prdId}/runs`)) as Array<{ id: string }>
          id = rows[0]?.id
        }
        if (!id) return mcpText(wrapOk({ prdId, qaReport: null, hint: '尚无运行记录' }))
        const data = await api(token, `/prds/${prdId}/runs/${id}/qa`)
        auditMcp(token, {
          tool: 'get_qa_report',
          resourceType: 'prd_run',
          resourceId: id,
        })
        return mcpText(wrapOk({ prdId, runId: id, qaReport: data }))
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_prd_release',
    {
      description:
        'S14: Release checklist for a PRD run (pages, AC, demo, MR, GitLab/GitHub pipeline status). Does not start a CI engine.',
      inputSchema: {
        prdId: z.string(),
        runId: z.string().optional(),
      },
    },
    async ({ prdId, runId }) => {
      try {
        const token = getToken()
        let id = runId
        if (!id) {
          const rows = (await api(token, `/prds/${prdId}/runs`)) as Array<{ id: string }>
          id = rows[0]?.id
        }
        if (!id) return mcpText(wrapOk({ prdId, release: null }))
        const data = await api(token, `/prds/${prdId}/runs/${id}/release`)
        auditMcp(token, {
          tool: 'get_prd_release',
          resourceType: 'prd_run',
          resourceId: id,
        })
        return mcpText(wrapOk({ prdId, runId: id, release: data }))
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'compare_design_code',
    {
      description:
        'REQUIRED for pixel-level QA after implementation. Pass screenshot (base64) + implementedComponents + implementedSource (concat page Vue/CSS/TSX). Without screenshot → incomplete. implementedSource is linted against pixelChecklist bans (space-between, sticky white footer, single shell) as severity=error. Prefer same product state as open_delivery.gate.acceptanceState.',
      inputSchema: {
        fileId: z.string(),
        artboardId: z.string(),
        version: z.number().optional(),
        implementedComponents: z
          .array(z.string())
          .optional()
          .describe('Semantic names you implemented, e.g. ["Table","Pagination","Button"]'),
        implementedSource: z
          .string()
          .optional()
          .describe(
            'REQUIRED for ban lint: concatenate the page .vue/.tsx/.css source (toolbar+footer CSS). Enables hard fail on space-between / sticky white footer / *-shell',
          ),
        measurements: z
          .array(
            z.object({
              sourceNodeId: z.string().optional(),
              component: z.string().optional(),
              borderRadius: z.number().optional(),
              fontSize: z.number().optional(),
              fontWeight: z.union([z.number(), z.string()]).optional(),
              color: z.string().optional(),
              backgroundColor: z.string().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
              paddingTop: z.number().optional(),
              paddingRight: z.number().optional(),
              paddingBottom: z.number().optional(),
              paddingLeft: z.number().optional(),
              gap: z.number().optional(),
            }),
          )
          .optional()
          .describe('Measured CSS from rendered DOM — prefer values from keySpecs'),
        screenshot: z
          .string()
          .optional()
          .describe('REQUIRED for pixel QA: Base64 or data-URL of the rendered page screenshot'),
        skipPixel: z.boolean().optional(),
        styleTolerancePx: z.number().optional(),
      },
    },
    async (args) => {
      try {
        const token = getToken()
        const hasScreenshot = Boolean(args.screenshot && String(args.screenshot).trim())
        if (!hasScreenshot && !args.skipPixel) {
          return mcpText(
            wrapOk({
              incomplete: true,
              requireScreenshot: true,
              artboardId: args.artboardId,
              fileId: args.fileId,
              summary: { errors: 1, warnings: 0, infos: 0, total: 1 },
              findings: [
                {
                  severity: 'error',
                  code: 'screenshot_required',
                  message:
                    'Pixel-level QA incomplete: pass screenshot (base64) to compare_design_code. Capture the implemented page at design width and retry.',
                },
              ],
              hint: 'Take a screenshot of the running page, then call compare_design_code again with screenshot + implementedComponents + implementedSource.',
              next: {
                tool: 'compare_design_code',
                require: ['screenshot', 'implementedComponents', 'implementedSource'],
              },
            }),
          )
        }

        const gate = await loadPixelGateContext(token, {
          fileId: args.fileId,
          artboardId: args.artboardId,
          version: args.version,
        })
        const lintFindings = lintImplementedAgainstChecklist(
          args.implementedSource ?? '',
          gate.pixelChecklist,
        )
        if (!args.implementedSource?.trim()) {
          lintFindings.unshift({
            severity: 'warning',
            code: 'implemented_source_recommended',
            message:
              'Pass implementedSource (page Vue/CSS) so compare can hard-fail on pixelChecklist bans. Soft checklist alone is not enough.',
          })
        }

        const data = (await api(
          token,
          `/files/${args.fileId}/artboards/${args.artboardId}/compare`,
          {
            method: 'POST',
            body: JSON.stringify({
              version: args.version,
              implementedComponents: args.implementedComponents,
              measurements: args.measurements,
              screenshot: args.screenshot,
              skipPixel: args.skipPixel,
              styleTolerancePx: args.styleTolerancePx,
            }),
          },
        )) as { findings?: unknown; summary?: unknown; [k: string]: unknown }

        const merged = mergeCompareFindings(data.findings, lintFindings)
        const banErrors = lintFindings.filter((f) => f.severity === 'error').length

        auditMcp(token, {
          tool: 'compare_design_code',
          resourceType: 'artboard',
          resourceId: args.artboardId,
          meta: {
            fileId: args.fileId,
            hasScreenshot,
            hasSource: Boolean(args.implementedSource?.trim()),
            banErrors,
            implemented: args.implementedComponents?.length ?? 0,
          },
        })
        return mcpText(
          wrapOk({
            incomplete: banErrors > 0,
            requireScreenshot: true,
            requireImplementedSource: true,
            acceptanceState: gate.acceptanceState,
            pixelChecklistBans: gate.pixelChecklist?.bans ?? [],
            banLint: {
              errorCount: banErrors,
              findings: lintFindings,
            },
            ...data,
            findings: merged.findings,
            summary: merged.summary,
            hint:
              banErrors > 0
                ? 'Fix banLint errors (space-between / sticky white footer / single shell) then re-compare.'
                : gate.acceptanceState?.qaHint,
          }),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_rule_code',
    {
      description:
        'Generate rule-based code for selected geometry nodes. Pass uiTarget / uiKitPackId to switch component mapping (same artboard, different kit).',
      inputSchema: {
        fileId: z.string(),
        version: z.number().optional(),
        artboardId: z.string(),
        nodeIds: z.array(z.string()).min(1),
        framework: z.enum(['html', 'vue', 'react']).optional(),
        target: z
          .string()
          .optional()
          .describe('Alias of uiTarget: uniboot | html | element-plus | team packId'),
        uiTarget: z.string().optional().describe('Component mapping target id'),
        uiKitPackId: z.string().optional().describe('Team UiKitPack row id'),
        style: z
          .enum(['css', 'css-module', 'tailwind', 'element-plus', 'uniboot-ui', 'bootstrap'])
          .optional(),
        projectConfig: z
          .unknown()
          .optional()
          .describe('Optional uniboot-design.json; fills framework/style/target'),
      },
    },
    async ({
      fileId,
      version,
      artboardId,
      nodeIds,
      framework,
      target,
      uiTarget,
      uiKitPackId,
      style,
      projectConfig,
    }) => {
      try {
        let fw = framework
        let st = style as string | undefined
        let tgt = uiTarget ?? target
        if (projectConfig != null) {
          const parsed = parseProjectConfig(projectConfig)
          if (!parsed.ok) return mcpText(wrapErr(parsed.errors.join('; '), 42200))
          const d = projectConfigToToolDefaults(parsed.config)
          fw = fw ?? (d.framework as 'html' | 'vue' | 'react')
          st = st ?? d.style
          tgt = tgt ?? d.target
        }
        const data = await api(getToken(), '/codegen', {
          method: 'POST',
          body: JSON.stringify({
            fileId,
            version,
            artboardId,
            nodeIds,
            framework: fw ?? 'vue',
            style: st ?? 'css',
            mode: 'rule',
            uiTarget: tgt,
            uiKitPackId,
            projectConfig: projectConfig ?? undefined,
          }),
        })
        return mcpText(
          wrapOk({
            ...(data as object),
            target: tgt ?? null,
            uiKitPackId: uiKitPackId ?? null,
          }),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'list_design_files',
    {
      description:
        'List design files in a project. Optional editorType=upload|online (online = OpenPencil working copy).',
      inputSchema: {
        projectId: z.string(),
        editorType: z.enum(['upload', 'online']).optional(),
      },
    },
    async ({ projectId, editorType }) => {
      try {
        const q = qs({ projectId, type: 'design', editorType })
        const files = await api<
          Array<{
            id: string
            name: string
            type?: string
            editorType?: string
            figObjectKey?: string | null
            latestVersion?: { version: number; status: string; source?: string } | null
          }>
        >(getToken(), `/files${q}`)
        return mcpText(
          wrapOk({
            files: files.map((f) => ({
              id: f.id,
              name: f.name,
              type: f.type,
              editorType: f.editorType ?? 'upload',
              figObjectKey: f.figObjectKey ?? null,
              latestVersion: f.latestVersion ?? null,
            })),
          }),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  const generateAiInputSchema = (tool: GenerateAiTool) => ({
    prompt: z
      .string()
      .optional()
      .describe(
        tool === 'generate_design'
          ? 'Describe the screens and visual style. Required unless pages are already generated.'
          : 'Describe roles, modules, and main flows. Required unless pages are already generated.',
      ),
    projectId: z
      .string()
      .optional()
      .describe(
        'Existing project. Omit to create a new AI conversation draft (kind=ai_session), not a team-space project.',
      ),
    teamId: z
      .string()
      .optional()
      .describe('Team for a new project. Defaults to the PAT owner’s first team.'),
    type: z
      .enum(['mobile', 'admin', 'screen', 'asset', 'concept_map', 'spec_review', 'showcase'])
      .optional()
      .describe(
        'Type: mobile=App/小程序, admin=B端管理后台 (default), screen=可视化大屏, asset=素材转模型, concept_map=原型概念图, spec_review=界面规范评审, showcase=全系统演示（多端顶栏切换）',
      ),
    target: z
      .enum(['draft', 'product'])
      .optional()
      .describe(
        'draft (default): store as product_draft and return /ai/{projectId} workbench URL. product: publish to the product library (/project/product/) — only when the user asks to 发布到产品库.',
      ),
    pages: z
      .array(
        z.object({
          title: z.string().describe('Business page name, e.g. 线索列表'),
          pageType: z
            .enum(['list', 'form', 'detail', 'dashboard', 'login', 'splash', 'scene', 'result'])
            .optional(),
          summary: z.string().optional(),
          navGroup: z.string().optional().describe('Sidebar group label'),
          body: z
            .string()
            .optional()
            .describe('Prototype only: main-content HTML fragment generated by Cursor'),
          entities: z.unknown().optional(),
          actions: z.unknown().optional(),
          wire: z
            .unknown()
            .optional()
            .describe(
              'Design only: Cursor-generated wireframe {width,height,background,children[]}',
            ),
        }),
      )
      .optional()
      .describe(
        'Cursor-generated pages (required on the second call). Omit on the first call to receive pageSchema. UniBoot Design does not run LLM. Max 32 pages; extras are dropped and reported as truncated.',
      ),
    logoSvg: z.string().optional().describe('Optional 36×36 product logo SVG (prototype)'),
    navIcons: z
      .array(
        z.union([
          z.string(),
          z.object({ name: z.string().optional(), svg: z.string().optional() }),
        ]),
      )
      .optional()
      .describe('Optional sidebar icons aligned to level-1 nav names'),
    mode: z
      .enum(['fast', 'detailed'])
      .optional()
      .describe('Deprecated. Platform LLM mode — ignored. Generate pages[] locally instead.'),
    clarifyConfirmed: z
      .boolean()
      .optional()
      .describe('Deprecated. Ignored. This tool does not call platform AI clarify.'),
  })

  const handleGenerateAi = async (
    tool: GenerateAiTool,
    input: Parameters<typeof runGenerateAi>[0]['input'],
  ) => {
    try {
      const result = await runGenerateAi({
        token: getToken(),
        api,
        webBase: getWebBase(),
        input,
        tool,
      })
      if (!result.ok) return mcpText(wrapErr(result.message, result.code))
      auditMcp(getToken(), result.audit)
      const hints =
        result.data.status === 'awaiting_pages'
          ? [result.data.hint, ...result.data.next]
          : [result.data.hint, ...result.data.next]
      const wrap = result.data.status === 'ready' && result.data.truncated ? wrapTruncated : wrapOk
      return mcpText(wrap(result.data, hints))
    } catch (err) {
      return catchResult(err)
    }
  }

  server.registerTool(
    'generate_prototype',
    {
      description:
        'Upload a Cursor-generated clickable prototype as an AI conversation draft. You (Cursor) generate HTML page bodies locally — this tool does not call UniBoot Design AI (mode/clarify are deprecated and ignored). First call with prompt only creates an ai_session and returns pageSchema; call again with pages[] to persist product_draft + PRD. Returns editorUrl = /ai/{projectId}?capability=prototype — open the AI prototype workbench, not the design editor or Product tab. Omit projectId to create a new AI draft. Pass target=product only when the user asks to publish to the product library. For visual design comps use generate_design.',
      inputSchema: generateAiInputSchema('generate_prototype'),
    },
    async (input) => handleGenerateAi('generate_prototype', input),
  )

  server.registerTool(
    'generate_design',
    {
      description:
        'Upload Cursor-generated visual design comps as an AI draft. You (Cursor) generate page specs/wireframes locally — this tool does not call UniBoot Design AI. First call with prompt only returns pageSchema; call again with pages[] (optional wire) to persist. Returns editorUrl = /ai/{projectId}?capability=design. Do not open /project/design/.../editor/. Omit projectId to create a new AI conversation draft.',
      inputSchema: generateAiInputSchema('generate_design'),
    },
    async (input) => handleGenerateAi('generate_design', input),
  )

  server.registerTool(
    'plan_canvas_ops',
    {
      description:
        'Return the canvas-ops schema and optional rule-based suggestions for an online editor file. Does NOT call UniBoot Design LLM — you (Cursor) generate the ops, then apply_canvas_ops. Keep the UniBoot Design editor tab open for this fileId. After apply, the user should save (Ctrl+S). For a full prototype from scratch use generate_prototype.',
      inputSchema: {
        fileId: z.string().describe('Online editor file id (editorType=online)'),
        query: z.string().describe('What to change on the canvas'),
        selectedId: z.string().optional().describe('Currently selected node id, if known'),
        selectedName: z.string().optional(),
      },
    },
    async ({ fileId, query, selectedId, selectedName }) => {
      try {
        return mcpText(
          wrapOk(
            {
              status: 'awaiting_ops',
              fileId,
              query,
              selected: selectedId ? { id: selectedId, name: selectedName } : null,
              schema: {
                ops: [
                  {
                    op: 'create',
                    type: 'FRAME|RECTANGLE|ELLIPSE|TEXT',
                    parentId: 'selected or node id',
                    name: '',
                    x: 0,
                    y: 0,
                    width: 120,
                    height: 40,
                    cornerRadius: 8,
                    fill: '#2F54EB',
                    text: '',
                    fontSize: 14,
                    layoutMode: 'NONE|HORIZONTAL|VERTICAL',
                  },
                  { op: 'update', nodeId: 'selected', cornerRadius: 8 },
                  { op: 'rename', nodeId: '', name: '' },
                  { op: 'delete', nodeId: '' },
                  { op: 'select', nodeId: '' },
                ],
              },
              hint: 'Generate canvas-ops JSON with Cursor (do not call UniBoot Design AI). Then apply_canvas_ops(fileId, ops). Keep the online editor open.',
            },
            [
              'Generate ops locally with Cursor, then apply_canvas_ops.',
              'Keep the online editor open for this fileId; it applies queued ops about every 2s.',
              'Save in the editor (Ctrl+S) afterwards if semantic/codegen should see the new nodes.',
            ],
          ),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'apply_canvas_ops',
    {
      description:
        'Queue structured canvas ops for the open UniBoot Design online editor (create FRAME/RECTANGLE/ELLIPSE/TEXT, update, rename, delete, select). Does not write .fig until the user saves. Keep the editor tab open.',
      inputSchema: {
        fileId: z.string(),
        ops: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .describe(
            'Ops JSON: {op:"create"|"update"|"rename"|"delete"|"select", type?, nodeId?, parentId?, name?, x, y, width, height, cornerRadius, fill, text, fontSize, layoutMode}',
          ),
      },
    },
    async ({ fileId, ops }) => {
      try {
        const token = getToken()
        const data = await api(token, `/files/${fileId}/online/canvas-ops`, {
          method: 'POST',
          body: JSON.stringify({ ops }),
        })
        auditMcp(token, { tool: 'apply_canvas_ops', resourceType: 'file', resourceId: fileId })
        return mcpText(
          wrapOk(data, [
            'Keep the online editor open for this fileId; it applies queued ops about every 2s.',
            'Save in the editor (Ctrl+S) afterwards if semantic/codegen should see the new nodes.',
          ]),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_prototype_flow',
    {
      description:
        'Read prototype sidecar for a design file (pages, flows, variables, interactions). Not stored in .fig.',
      inputSchema: {
        fileId: z.string(),
      },
    },
    async ({ fileId }) => {
      try {
        const data = await api(getToken(), `/files/${fileId}/prototype`)
        return mcpText(wrapOk(data))
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'get_design_variables',
    {
      description:
        'Prototype variables on a design file sidecar. Use TokenSet APIs for W3C tokens.',
      inputSchema: {
        fileId: z.string(),
      },
    },
    async ({ fileId }) => {
      try {
        const proto = await api<{ variables?: unknown[] }>(getToken(), `/files/${fileId}/prototype`)
        return mcpText(
          wrapOk({
            fileId,
            prototypeVariables: proto.variables ?? [],
          }),
        )
      } catch (err) {
        return catchResult(err)
      }
    },
  )

  server.registerTool(
    'sync_design_file',
    {
      description:
        'Re-run semantic pipeline for the latest ready version of an online OpenPencil file.',
      inputSchema: {
        fileId: z.string(),
      },
    },
    async ({ fileId }) => {
      try {
        const data = await api(getToken(), `/files/${fileId}/online/sync`, { method: 'POST' })
        return mcpText(wrapOk(data))
      } catch (err) {
        return catchResult(err)
      }
    },
  )
}
