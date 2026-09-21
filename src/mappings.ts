import { createRequire } from 'node:module'

type MappingProp = { attr?: string; kind?: string; values?: string[] | Record<string, string> }
type Mapping = {
  tag: string
  import?: { from: string; named?: string; default?: string }
  props?: Record<string, MappingProp>
  textAs?: string
  model?: { attr: string }
}

type SpecLite = {
  name: string
  category?: string
  mappings?: Record<string, Mapping>
}

let cached: SpecLite[] | null = null

/** Load builtin specs + mappings (CJS package via createRequire). */
export function loadBuiltinSpecs(): SpecLite[] {
  if (cached) return cached
  try {
    const require = createRequire(import.meta.url)
    const mod = require('@ubd/component-schema') as {
      builtinRegistry: () => { list: () => SpecLite[] }
    }
    cached = mod.builtinRegistry().list()
    return cached
  } catch {
    cached = FALLBACK_SPECS
    return cached
  }
}

export function mappingFor(
  specName: string,
  target: string,
): (Mapping & { spec: string }) | null {
  const specs = loadBuiltinSpecs()
  const spec = specs.find((s) => s.name === specName)
  if (!spec?.mappings) return null
  const mapping = spec.mappings[target] ?? spec.mappings.html
  if (!mapping) return null
  return { spec: specName, ...mapping }
}

export function listMappings(
  target: string,
  components?: string[],
): Array<Mapping & { spec: string; category?: string }> {
  const specs = loadBuiltinSpecs()
  const filter = components?.length ? new Set(components) : null
  const out: Array<Mapping & { spec: string; category?: string }> = []
  for (const spec of specs) {
    if (filter && !filter.has(spec.name)) continue
    const mapping = spec.mappings?.[target] ?? spec.mappings?.html
    if (!mapping) continue
    out.push({ spec: spec.name, category: spec.category, ...mapping })
  }
  return out
}

/** Minimal fallback if @ubd/component-schema is unavailable at runtime. */
const FALLBACK_SPECS: SpecLite[] = [
  {
    name: 'Button',
    category: 'basic',
    mappings: {
      uniboot: {
        tag: 'u-button',
        import: { from: 'uniboot-ui', named: 'UButton' },
        props: { type: { attr: 'type' }, size: { attr: 'size' } },
        textAs: 'default',
      },
      html: { tag: 'button', textAs: 'default' },
    },
  },
  {
    name: 'Input',
    category: 'form',
    mappings: {
      uniboot: {
        tag: 'u-input',
        import: { from: 'uniboot-ui', named: 'UInput' },
        props: { placeholder: { attr: 'placeholder' } },
        model: { attr: 'model-value' },
      },
      html: { tag: 'input' },
    },
  },
  {
    name: 'Table',
    category: 'data',
    mappings: {
      uniboot: {
        tag: 'u-table',
        import: { from: 'uniboot-ui', named: 'UTable' },
      },
      html: { tag: 'table' },
    },
  },
]
