// Modern print templates are selected by stable DataWindow definition identity,
// not by a translated caption or by the current screen presentation.  A template
// may be registered as a gated preview before its official layout is approved;
// an unregistered definition always stays on the Classic renderer.
import type { InterfaceMode } from '../app/ui-preferences.ts'

export type PrintPresentation = 'classic' | 'modern'
export type PrintTemplateStatus = 'preview' | 'approved' | 'blocked'

export interface PrintTemplate {
  /** stable template identity, used by the local perimeter preferences */
  id: string
  /** document family shared by equivalent outputs */
  family: string
  /** human-readable family name shown in the layout chooser */
  label: string
  /** exact DataWindow definitions this template can render */
  definitions: readonly string[]
  status: PrintTemplateStatus
  /** reason a blocked template cannot be used; visible to the operator */
  blockedReason?: string
}

/**
 * The catalog is deliberately explicit.  A DataWindow that is not listed here
 * is not a Modern document yet.  New entries require a reviewed layout and
 * document-value/pagination evidence before they can be marked approved.
 */
export const PRINT_TEMPLATES: readonly PrintTemplate[] = Object.freeze([
  {
    id: 'sales-invoice-standard',
    family: 'sales-invoice',
    label: 'Sales invoice',
    definitions: ['d_retailsaleinvreport'],
    status: 'preview',
  },
  {
    id: 'purchase-invoice-standard',
    family: 'purchase-invoice',
    label: 'Purchase invoice',
    definitions: ['d_purchaseinvreportstock_retailer'],
    status: 'preview',
  },
  {
    id: 'item-label-standard',
    family: 'item-label',
    label: 'Item labels',
    definitions: ['d_itemlabels_4', 'd_labelbarcode_rahat'],
    status: 'blocked',
    blockedReason: 'Label paper dimensions, margins and the target printer are not yet inventoried.',
  },
])

export interface PrintFamily {
  id: string
  label: string
  templates: readonly PrintTemplate[]
  status: PrintTemplateStatus
  blockedReason?: string
}

export function printTemplateIssues(templates: readonly PrintTemplate[] = PRINT_TEMPLATES): string[] {
  const issues: string[] = []
  const ids = new Set<string>()
  const definitions = new Set<string>()
  for (const template of templates) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(template.id)) issues.push(`Invalid template identity: ${template.id}`)
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(template.family)) issues.push(`Invalid family identity: ${template.family}`)
    if (!template.label.trim()) issues.push(`Missing template label: ${template.id}`)
    if (!template.definitions.length) issues.push(`Template has no definitions: ${template.id}`)
    if (template.status === 'blocked' && !template.blockedReason?.trim()) {
      issues.push(`Blocked template has no reason: ${template.id}`)
    }
    if (ids.has(template.id)) issues.push(`Duplicate template identity: ${template.id}`)
    ids.add(template.id)
    for (const definition of template.definitions) {
      if (!definition.trim() || definition !== definition.toLowerCase()) {
        issues.push(`Invalid definition identity in ${template.id}: ${definition}`)
      }
      if (definitions.has(definition)) issues.push(`Definition is registered twice: ${definition}`)
      definitions.add(definition)
    }
  }
  return issues
}

export function printTemplateFor(
  definition: string | null | undefined,
  templates: readonly PrintTemplate[] = PRINT_TEMPLATES,
): PrintTemplate | undefined {
  if (!definition) return undefined
  const name = definition.toLowerCase()
  return templates.find((template) => template.definitions.includes(name))
}

export function printFamilies(templates: readonly PrintTemplate[] = PRINT_TEMPLATES): readonly PrintFamily[] {
  const families = new Map<string, PrintTemplate[]>()
  for (const template of templates) {
    const existing = families.get(template.family) ?? []
    existing.push(template)
    families.set(template.family, existing)
  }
  return [...families].map(([id, entries]) => {
    // A family is blocked only when every template in it is unavailable.
    const status = entries.some((template) => template.status === 'approved') ? 'approved'
      : entries.some((template) => template.status === 'preview') ? 'preview' : 'blocked'
    return {
      id,
      label: entries[0].label,
      templates: entries,
      status,
      blockedReason: entries.find((template) => template.blockedReason)?.blockedReason,
    }
  })
}

export interface PrintResolution {
  presentation: 'classic' | 'modern'
  template?: PrintTemplate
  /** explicit reason a requested Modern layout was not used */
  notice?: string
}

/**
 * Resolve the requested layout for one definition.  A gated preview is only
 * available when the caller explicitly permits previews (the opt-in Modern
 * workspace).  Blocked and unregistered documents stay Classic and report why;
 * they are never silently presented as a Modern document.
 */
export function resolvePrintPresentation(
  definition: string | null | undefined,
  requested: InterfaceMode,
  options: { preview?: boolean; templates?: readonly PrintTemplate[] } = {},
): PrintResolution {
  const template = printTemplateFor(definition, options.templates)
  if (!template) {
    return requested === 'modern'
      ? { presentation: 'classic', notice: `No Modern template is registered for ${definition || 'this document'}. Select Classic print layout.` }
      : { presentation: 'classic' }
  }
  if (template.status === 'blocked') {
    return {
      presentation: 'classic',
      template,
      notice: `${template.blockedReason || `The Modern template for ${template.label} is blocked.`} Select Classic print layout.`,
    }
  }
  if (requested === 'classic') return { presentation: 'classic', template }
  if (template.status === 'preview' && !options.preview) {
    return {
      presentation: 'classic',
      template,
      notice: `The Modern ${template.label} template is a gated preview. Enable the Modern workspace preview to use it.`,
    }
  }
  return { presentation: 'modern', template }
}
