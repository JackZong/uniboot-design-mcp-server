import type { PixelChecklist } from './pixel-checklist.js'

export type LintFinding = {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  evidence?: string
}

/**
 * Static scan of Agent-submitted Vue/CSS/TSX against pixelChecklist bans.
 * Turns soft checklist into hard compare failures when patterns match.
 */
export function lintImplementedAgainstChecklist(
  source: string,
  checklist: PixelChecklist | null | undefined,
): LintFinding[] {
  const findings: LintFinding[] = []
  if (!source || !source.trim()) {
    findings.push({
      severity: 'warning',
      code: 'implemented_source_empty',
      message:
        'Pass implementedSource (concat Vue/CSS/TSX of the page) so compare can enforce pixelChecklist bans.',
    })
    return findings
  }

  const text = source
  const bans = checklist?.bans ?? []
  const items = checklist?.items ?? []
  const banJoined = bans.join(' | ').toLowerCase()
  const mustLeftToolbar = items.some((i) => i.id.startsWith('toolbar-left'))
  const mustNoWhiteFooter = items.some((i) => i.id === 'footer-no-white-card')
  const mustCardCount = items.find((i) => i.id === 'card-count')
  const banSpaceBetween =
    mustLeftToolbar || /space-between/i.test(banJoined)
  const banStickyWhite =
    mustNoWhiteFooter || /sticky white footer/i.test(banJoined)
  const banSingleShell =
    Boolean(mustCardCount) || /single page-body|shell/i.test(banJoined)

  if (banSpaceBetween && /justify-content\s*:\s*space-between/i.test(text)) {
    findings.push({
      severity: 'error',
      code: 'ban_space_between',
      message:
        'Found justify-content: space-between but pixelChecklist requires left-aligned toolbar (flex-start). Fix title+batch row before claiming pixel QA pass.',
      evidence: 'justify-content: space-between',
    })
  }

  if (banSpaceBetween && /justify-between|justifyBetween/i.test(text)) {
    findings.push({
      severity: 'error',
      code: 'ban_space_between_tailwind',
      message:
        'Found justify-between / justifyBetween but layoutIntent is start — use justify-start / flex-start.',
      evidence: 'justify-between',
    })
  }

  if (banStickyWhite) {
    const sticky = /position\s*:\s*sticky/i.test(text) || /\bsticky\b/.test(text)
    const whiteBg =
      /background(-color)?\s*:\s*(#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255)/i.test(
        text,
      ) || /bg-white|backgroundColor\s*:\s*['"]#fff/i.test(text)
    const footerish =
      /footer|action-bar|page-footer|bottom-bar|sticky-footer/i.test(text)
    if (sticky && (whiteBg || footerish)) {
      findings.push({
        severity: 'error',
        code: 'ban_sticky_white_footer',
        message:
          'Sticky white/footer bar detected but keySpecs footer has no backgroundColor — use plain flex row inside lower card, not a white sticky card.',
        evidence: 'sticky + white/footer',
      })
    }
  }

  if (banSingleShell) {
    if (/conflict-shell|page-shell|xxx-shell|[a-z]+-shell\b/i.test(text)) {
      findings.push({
        severity: 'error',
        code: 'ban_single_shell',
        message: mustCardCount
          ? `Single-shell wrapper found but structure requires ${mustCardCount.check}`
          : 'Single-shell wrapper found — keep cards/sections separate per layoutOutline.',
        evidence: '*-shell class',
      })
    }
  }

  // Product-state footgun: detail-only acceptance
  if (/mode\s*=\s*['"]?detail|mode=detail/i.test(text) && /只读|readonly|disabled/i.test(text)) {
    findings.push({
      severity: 'warning',
      code: 'acceptance_state_detail',
      message:
        'Implementation references mode=detail / readonly — visual QA must use the design-matching edit entry, not detail-only.',
    })
  }

  return findings
}

export function mergeCompareFindings(
  apiFindings: unknown,
  lintFindings: LintFinding[],
): { findings: unknown[]; summary: { errors: number; warnings: number; infos: number; total: number } } {
  const base = Array.isArray(apiFindings) ? [...apiFindings] : []
  const merged = [...base, ...lintFindings]
  let errors = 0
  let warnings = 0
  let infos = 0
  for (const f of merged) {
    const sev =
      f && typeof f === 'object' && 'severity' in f
        ? String((f as { severity: string }).severity)
        : 'info'
    if (sev === 'error') errors += 1
    else if (sev === 'warning') warnings += 1
    else infos += 1
  }
  return {
    findings: merged,
    summary: { errors, warnings, infos, total: merged.length },
  }
}
