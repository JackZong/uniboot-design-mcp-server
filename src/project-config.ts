import { z } from 'zod'

export const PROJECT_CONFIG_FILENAME = 'uniboot-design.json'

export const ProjectConfigSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1).default(1),
    projectId: z.string().min(1).optional(),
    fileId: z.string().min(1).optional(),
    target: z.enum(['uniboot', 'html', 'element-plus', 'bootstrap']).default('uniboot'),
    framework: z.enum(['html', 'vue', 'react']).default('vue'),
    style: z
      .enum(['css', 'css-module', 'tailwind', 'element-plus', 'uniboot-ui', 'bootstrap'])
      .default('uniboot-ui'),
    uiLibrary: z
      .object({
        package: z.string().default('uniboot-ui'),
        version: z.string().optional(),
      })
      .default({ package: 'uniboot-ui' }),
    tokens: z
      .object({
        tokenSetId: z.string().optional(),
        cssPrefix: z.string().default('--u'),
      })
      .default({ cssPrefix: '--u' }),
    paths: z
      .object({
        views: z.string().default('views'),
        components: z.string().default('components'),
        assets: z.string().default('assets'),
        api: z.string().default('api'),
        types: z.string().default('types'),
      })
      .default({}),
    naming: z
      .object({
        pageSuffix: z.string().default('Page'),
        componentPascal: z.boolean().default(true),
      })
      .default({}),
    notes: z.array(z.string()).default([]),
  })
  .strict()

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>
export type ProjectConfigInput = z.input<typeof ProjectConfigSchema>

export type ParseProjectConfigResult =
  | { ok: true; config: ProjectConfig; warnings: string[] }
  | { ok: false; errors: string[] }

export function parseProjectConfig(raw: unknown): ParseProjectConfigResult {
  const parsed = ProjectConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    }
  }
  const warnings: string[] = []
  const config = parsed.data
  if (config.target === 'uniboot' && config.style !== 'uniboot-ui') {
    warnings.push(`target=uniboot usually pairs with style=uniboot-ui (got style=${config.style})`)
  }
  if (config.target === 'element-plus' && config.style !== 'element-plus') {
    warnings.push(
      `target=element-plus usually pairs with style=element-plus (got style=${config.style})`,
    )
  }
  return { ok: true, config, warnings }
}

export function defaultProjectConfig(overrides: ProjectConfigInput = {}): ProjectConfig {
  const result = parseProjectConfig(overrides)
  if (!result.ok) throw new Error(result.errors.join('; '))
  return result.config
}

export function projectConfigToToolDefaults(config: ProjectConfig) {
  return {
    target: config.target,
    framework: config.framework,
    style: config.style,
    tokenSetId: config.tokens.tokenSetId ?? null,
    cssPrefix: config.tokens.cssPrefix,
    projectId: config.projectId ?? null,
    fileId: config.fileId ?? null,
    paths: config.paths,
    uiLibrary: config.uiLibrary,
    notes: config.notes,
  }
}

export function projectConfigFilename() {
  return PROJECT_CONFIG_FILENAME
}

export function exampleProjectConfig() {
  return defaultProjectConfig({})
}
