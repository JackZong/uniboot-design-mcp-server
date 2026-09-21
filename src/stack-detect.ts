import {
  exampleProjectConfig,
  parseProjectConfig,
  projectConfigToToolDefaults,
} from './project-config.js'

export type StackHint = {
  /** Detected UI stack from consumer package.json */
  stack: 'element-plus' | 'uniboot-ui' | 'unknown'
  evidence: string[]
  /** Suggested default config object when local uniboot-design.json missing */
  suggestedConfig: Record<string, unknown>
  note: string
}

const EP_PACKAGES = ['element-plus', '@element-plus/icons-vue']
const UNIBOOT_PACKAGES = ['uniboot-ui', '@uniboot/ui']

function depNames(pkg: Record<string, unknown> | null | undefined): string[] {
  if (!pkg || typeof pkg !== 'object') return []
  const names = new Set<string>()
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const block = pkg[key]
    if (!block || typeof block !== 'object') continue
    for (const name of Object.keys(block as Record<string, unknown>)) names.add(name)
  }
  return [...names]
}

/** Infer consumer UI stack from package.json (Agent should pass repo root package.json). */
export function detectConsumerStack(packageJson: unknown): StackHint {
  const pkg =
    packageJson && typeof packageJson === 'object'
      ? (packageJson as Record<string, unknown>)
      : null
  const deps = depNames(pkg)
  const evidence: string[] = []

  const hasEp = EP_PACKAGES.some((p) => {
    if (deps.includes(p)) {
      evidence.push(`dep:${p}`)
      return true
    }
    return false
  })
  const hasUb = UNIBOOT_PACKAGES.some((p) => {
    if (deps.includes(p)) {
      evidence.push(`dep:${p}`)
      return true
    }
    return false
  })

  if (hasEp && !hasUb) {
    return {
      stack: 'element-plus',
      evidence,
      suggestedConfig: exampleElementPlusProjectConfig(),
      note: 'package.json has element-plus — use Element Plus defaults, NOT uniboot-ui. Copy uniboot-design.element-plus.json.example → uniboot-design.json.',
    }
  }
  if (hasUb && !hasEp) {
    return {
      stack: 'uniboot-ui',
      evidence,
      suggestedConfig: exampleProjectConfig(),
      note: 'package.json has uniboot-ui — default uniboot target is OK.',
    }
  }
  if (hasEp && hasUb) {
    return {
      stack: 'element-plus',
      evidence,
      suggestedConfig: exampleElementPlusProjectConfig(),
      note: 'Both element-plus and uniboot-ui present — prefer element-plus for business apps; confirm in uniboot-design.json.',
    }
  }
  return {
    stack: 'unknown',
    evidence: [],
    suggestedConfig: exampleProjectConfig(),
    note: 'No element-plus / uniboot-ui in package.json — pass config or add uniboot-design.json.',
  }
}

/** Built-in Element Plus consumer defaults (mirrors uniboot-design.element-plus.json.example). */
export function exampleElementPlusProjectConfig(): Record<string, unknown> {
  return {
    version: 1,
    target: 'element-plus',
    framework: 'vue',
    style: 'element-plus',
    uiLibrary: { package: 'element-plus', version: '^2' },
    tokens: { cssPrefix: '--el' },
    paths: {
      views: 'src/views',
      components: 'src/components',
      assets: 'src/assets/design',
      api: 'src/api',
      types: 'src/types',
    },
    naming: { pageSuffix: 'Page', componentPascal: true },
    notes: [
      'Match existing repo patterns (BasicTable, layout classes, i18n) — do not invent a parallel stack',
      'open_delivery preview is the acceptance image; export_artboard_assets for icons',
      'execute_code_plan is scaffold only; finish with compare_design_code + implementedSource',
    ],
  }
}

export type ResolvedDeliveryConfig = {
  filename: string
  config: Record<string, unknown> | null
  warnings: string[]
  defaults: ReturnType<typeof projectConfigToToolDefaults>
  source: 'provided' | 'example' | 'example-element-plus'
  stackHint: StackHint | null
}

/**
 * Choose project config for open_delivery:
 * 1) explicit config
 * 2) else if package.json → element-plus example
 * 3) else uniboot example
 */
export function resolveDeliveryProjectConfig(opts: {
  config?: unknown
  packageJson?: unknown
}): ResolvedDeliveryConfig {
  const stackHint =
    opts.packageJson != null ? detectConsumerStack(opts.packageJson) : null

  if (opts.config != null) {
    const parsed = parseProjectConfig(opts.config)
    if (!parsed.ok) {
      const fallback =
        stackHint?.stack === 'element-plus'
          ? exampleElementPlusProjectConfig()
          : exampleProjectConfig()
      const fb = parseProjectConfig(fallback)
      return {
        filename: 'uniboot-design.json',
        config: null,
        warnings: [
          `project config invalid; using ${
            stackHint?.stack === 'element-plus' ? 'element-plus' : 'example'
          } defaults: ${parsed.errors.join('; ')}`,
        ],
        defaults: projectConfigToToolDefaults(
          fb.ok ? fb.config : (exampleProjectConfig() as never),
        ),
        source: stackHint?.stack === 'element-plus' ? 'example-element-plus' : 'example',
        stackHint,
      }
    }
    const warnings = [...parsed.warnings]
    if (
      stackHint?.stack === 'element-plus' &&
      parsed.config.target !== 'element-plus'
    ) {
      warnings.push(
        `Consumer package.json looks like Element Plus but uniboot-design.json target=${parsed.config.target}. Prefer target/style=element-plus.`,
      )
    }
    return {
      filename: 'uniboot-design.json',
      config: parsed.config as unknown as Record<string, unknown>,
      warnings,
      defaults: projectConfigToToolDefaults(parsed.config),
      source: 'provided',
      stackHint,
    }
  }

  // No local config
  if (stackHint?.stack === 'element-plus') {
    const parsed = parseProjectConfig(exampleElementPlusProjectConfig())
    return {
      filename: 'uniboot-design.json',
      config: parsed.ok ? (parsed.config as unknown as Record<string, unknown>) : null,
      warnings: [
        'No local uniboot-design.json — auto-selected Element Plus defaults from package.json. Copy uniboot-design.element-plus.json.example to the repo root and adjust paths.',
        stackHint.note,
      ],
      defaults: projectConfigToToolDefaults(
        parsed.ok ? parsed.config : (exampleProjectConfig() as never),
      ),
      source: 'example-element-plus',
      stackHint,
    }
  }

  const parsed = parseProjectConfig(exampleProjectConfig())
  return {
    filename: 'uniboot-design.json',
    config: parsed.ok ? (parsed.config as unknown as Record<string, unknown>) : null,
    warnings: [
      'No local uniboot-design.json — example defaults (often uniboot-ui) will NOT match Element Plus / BasicTable repos. Pass packageJson or add uniboot-design.json.',
    ],
    defaults: projectConfigToToolDefaults(
      parsed.ok ? parsed.config : (exampleProjectConfig() as never),
    ),
    source: 'example',
    stackHint,
  }
}
