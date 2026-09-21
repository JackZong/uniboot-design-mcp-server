import { describe, expect, it } from 'vitest'
import {
  detectConsumerStack,
  exampleElementPlusProjectConfig,
  resolveDeliveryProjectConfig,
} from './stack-detect'

describe('detectConsumerStack', () => {
  it('detects element-plus from dependencies', () => {
    const hint = detectConsumerStack({
      dependencies: { 'element-plus': '^2.4.0', vue: '^3' },
    })
    expect(hint.stack).toBe('element-plus')
    expect(hint.suggestedConfig.target).toBe('element-plus')
  })

  it('detects uniboot-ui', () => {
    const hint = detectConsumerStack({
      dependencies: { 'uniboot-ui': '1.0.0' },
    })
    expect(hint.stack).toBe('uniboot-ui')
  })
})

describe('resolveDeliveryProjectConfig', () => {
  it('auto-selects element-plus when packageJson has it and config omitted', () => {
    const resolved = resolveDeliveryProjectConfig({
      packageJson: { dependencies: { 'element-plus': '^2' } },
    })
    expect(resolved.source).toBe('example-element-plus')
    expect(resolved.defaults.target).toBe('element-plus')
    expect(resolved.defaults.style).toBe('element-plus')
    expect(resolved.warnings.join(' ')).toMatch(/Element Plus/i)
  })

  it('keeps provided config and warns on stack mismatch', () => {
    const resolved = resolveDeliveryProjectConfig({
      config: { version: 1, target: 'uniboot', style: 'uniboot-ui' },
      packageJson: { dependencies: { 'element-plus': '^2' } },
    })
    expect(resolved.source).toBe('provided')
    expect(resolved.defaults.target).toBe('uniboot')
    expect(resolved.warnings.join(' ')).toMatch(/Element Plus/)
  })

  it('exampleElementPlusProjectConfig is parseable', () => {
    const cfg = exampleElementPlusProjectConfig()
    expect(cfg.target).toBe('element-plus')
    expect(cfg.style).toBe('element-plus')
  })
})
