import { validateLayoutDraft } from './layout-studio.js'

/** Publication carries geometry/widget types only. Scheduler resolution travels separately in manifest slots. */
export function deliverableLayoutContract(candidate: unknown): Record<string, unknown> | null {
  const result = validateLayoutDraft(candidate)
  const draft = result.draft
  if (!draft || draft.mode !== 'CUSTOM' || result.issues.length) return null
  return draft as unknown as Record<string, unknown>
}
