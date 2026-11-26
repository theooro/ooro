import { validateLayoutDraft } from './layout-studio.js'

type EligibleMedia = { creativeId: string; type: string; checksum?: string | null; offer?: Record<string, unknown> }

/** Publication is not delivery authority. Recheck current profile certification and every binding. */
export function deliverableLayoutContract(candidate: unknown, mainItems: EligibleMedia[], sponsoredItem?: EligibleMedia | null): Record<string, unknown> | null {
  const result = validateLayoutDraft(candidate)
  const draft = result.draft
  if (!draft || draft.mode !== 'CUSTOM' || result.issues.length) return null
  const verified = (item: EligibleMedia | undefined, type?: string) => Boolean(item && (!type || item.type === type) && /^[a-f0-9]{64}$/i.test(item.checksum ?? ''))
  for (const zone of draft.zones.filter(zone => zone.visible)) {
    if (zone.rotation) {
      if (!zone.rotation.items.every(reference => verified(mainItems.find(item => item.creativeId === reference.referenceId), 'IMAGE'))) return null
    } else if (['IMAGE', 'VIDEO', 'LOGO', 'BACKGROUND_IMAGE'].includes(zone.type)) {
      if (zone.contentBinding.kind !== 'APPROVED_CREATIVE' || !verified(mainItems.find(item => item.creativeId === zone.contentBinding.referenceId), zone.type === 'VIDEO' ? 'VIDEO' : 'IMAGE')) return null
    } else if (zone.type === 'MAIN_AD') {
      if (!mainItems.length || (zone.contentBinding.kind !== 'NONE' && !verified(mainItems.find(item => item.creativeId === zone.contentBinding.referenceId)))) return null
    } else if (zone.type === 'SPONSORED_AD') {
      if (zone.contentBinding.kind !== 'APPROVED_SPONSOR' || zone.contentBinding.referenceId !== sponsoredItem?.creativeId || !verified(sponsoredItem ?? undefined, 'IMAGE')) return null
    } else if (zone.type === 'QR_OFFER') {
      if (zone.contentBinding.kind !== 'AUTHORIZED_DESTINATION' || !mainItems.some(item => verified(item) && item.offer?.authorizedDestinationId === zone.contentBinding.referenceId)) return null
    } else if (zone.type !== 'TEXT' || zone.contentBinding.kind !== 'NONE') return null
  }
  return draft as unknown as Record<string, unknown>
}
