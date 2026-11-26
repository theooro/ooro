import { z } from 'zod'
import { creativeTypeMatchesWidget, type LayoutDraft, type LayoutZone, type WidgetType } from '../../apps/api/src/domain/layout-studio'
import { MBOX_PROFILE_ID, mboxProfile, profileOptions } from '../../apps/api/src/domain/layout-studio'

export const layoutCatalogSchema = z.object({
  creatives: z.array(z.object({ id: z.string().uuid(), name: z.string(), type: z.enum(['IMAGE', 'VIDEO']), previewUrl: z.string().url().optional(), mimeType: z.string().nullable().optional(), campaign: z.object({ id: z.string().uuid(), name: z.string(), deliverySlot: z.string() }) })),
  unavailableCreatives: z.array(z.object({ id: z.string().uuid(), name: z.string(), reason: z.string() })).optional(),
  destinations: z.array(z.object({ id: z.string().uuid(), ctaType: z.string(), campaign: z.object({ name: z.string() }) })),
})
export type LayoutCatalog = z.infer<typeof layoutCatalogSchema>

export function selectLayoutProfile(draft: LayoutDraft, id: LayoutDraft['profileId']): LayoutDraft {
  const profile = profileOptions.find(profile => profile.id === id)!
  return { ...draft, profileId: id, target: { ...profile.target }, screenType: profile.screenType, capabilityProfileVersion: id === MBOX_PROFILE_ID ? mboxProfile.revision : undefined }
}

export function selectLayoutScreenType(draft: LayoutDraft, type: NonNullable<LayoutDraft['screenType']>): LayoutDraft {
  const current = profileOptions.find(profile => profile.id === draft.profileId)!
  return selectLayoutProfile(draft, current.screenType === type ? current.id : profileOptions.find(profile => profile.screenType === type)!.id)
}

export function changeLayoutWidgetType(zone: LayoutZone, type: WidgetType): LayoutZone {
  const kind = ['IMAGE', 'VIDEO', 'LOGO', 'BACKGROUND_IMAGE'].includes(type) ? 'APPROVED_CREATIVE' : type === 'SPONSORED_AD' ? 'APPROVED_SPONSOR' : type === 'QR_OFFER' ? 'AUTHORIZED_DESTINATION' : 'NONE'
  return { ...zone, type, fit: 'FIT', contentBinding: { kind }, rotation: undefined }
}

export function layoutBindingOptions(type: WidgetType): LayoutZone['contentBinding']['kind'][] {
  if (type === 'SPONSORED_AD') return ['APPROVED_SPONSOR']
  if (['QR_OFFER', 'STATIC_QR', 'EXTERNAL_DESTINATION'].includes(type)) return ['NONE', 'AUTHORIZED_DESTINATION']
  if (['MAIN_AD', 'IMAGE', 'VIDEO', 'LOGO', 'BACKGROUND_IMAGE'].includes(type)) return ['NONE', 'APPROVED_CREATIVE']
  return ['NONE']
}

export function matchingLayoutCreatives(catalog: LayoutCatalog, zone: LayoutZone) {
  return catalog.creatives.filter(creative => creativeTypeMatchesWidget(zone.type, creative.type) && (zone.type === 'SPONSORED_AD' ? creative.campaign.deliverySlot === 'SPONSORED' : creative.campaign.deliverySlot !== 'SPONSORED'))
}

/** Keep a failed/non-JSON upstream response distinct from an empty catalog. */
export async function readLayoutResponse<T>(response: Response): Promise<{ data: T; requestId?: string }> {
  const payload = await response.json().catch(() => null)
  const id = typeof payload?.requestId === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(payload.requestId) ? ` · request ${payload.requestId}` : ''
  if (!response.ok) throw new Error(`${payload?.error?.message || 'Layout Studio request failed'} (HTTP ${response.status}${id})`)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('data' in payload)) throw new Error(`Invalid Layout Studio response (HTTP ${response.status}${id}).`)
  return payload
}
