import { createHash } from 'node:crypto'
import { randomBytes } from 'node:crypto'
import { prisma } from '../prisma.js'
import { config } from '../config.js'
import { safeDestination } from './qr-destination.js'
import { isCampaignDateEligible } from './campaign-date-window.js'
import { deliverableLayoutContract } from './layout-manifest.js'
import { THREE_ZONE_AD_SPONSOR_QR_CONTRACT_V1, THREE_ZONE_AD_SPONSOR_QR_V1 } from './presentation-layout.js'

export type ManifestReason = 'NO_ASSIGNMENT' | 'DISPLAY_DISABLED' | 'CLIENT_QUOTA_UNSUPPORTED' | 'CAMPAIGN_INACTIVE' | 'APPROVAL_REQUIRED' | 'FUNDING_REQUIRED' | 'NO_DELIVERY_QUOTA' | 'NO_APPROVED_CREATIVE' | 'ASSET_UNAVAILABLE' | 'NO_ELIGIBLE_CREATIVE'
export type DeliveryQuota = { id: string; revision: number; remainingPlays: number | null; unlimited: boolean }
export type DisplayManifestItem = { id: string; campaignId: string; creativeId: string; assetId: string; type: string; url: string; checksum: string; durationSeconds: number; deliverySlot?: string | null; priority: number; sequence?: number; startAt: string | null; endAt: string | null; deliveryQuota: DeliveryQuota; fitMode: string; qrEnabled: boolean; qrTargetUrl: string | null; qrLabel: string | null; qrVersion: number; offer: Record<string, unknown> }
export type DisplayManifest = { manifestId: string; version: number; generatedAt: string; expiresAt: string; deliveryReasons: ManifestReason[]; layout: string | { type: string; contractVersion: number; primaryWidthPercent: number; adHeightPercent?: number; qrHeightPercent: number; newsScrollSpeed: number; sponsoredHeightPercent?: number; minWidthPx?: number; minHeightPx?: number }; layoutStudioContract?: Record<string, unknown> | null; news: { scrollSpeed: number; announcements: Array<{ id: string; text: string; priority: number }> }; items: DisplayManifestItem[]; sponsoredItem?: DisplayManifestItem | null; sponsoredSlotDiagnostic?: { code: string; message: string } }
export type ManifestCampaignDiagnostic = { status: string; fundingStatus: string; quotaAuthorized: boolean; approvedCreativeCount: number; checksumVerifiedAssetCount: number }
export function defaultFourZoneLayout(configured: { primaryWidthPercent?: number | null; adHeightPercent?: number | null; qrHeightPercent?: number | null; newsScrollSpeed?: number | null } | null | undefined, contractVersion: number) {
  const version = Math.max(1, contractVersion)
  return {
    type: 'FOUR_ZONE',
    contractVersion: version,
    primaryWidthPercent: version >= 2 ? 80 : configured?.primaryWidthPercent ?? 67,
    adHeightPercent: version >= 3 ? 85 : version === 2 ? 88 : configured?.adHeightPercent ?? 86,
    qrHeightPercent: version >= 2 ? 50 : configured?.qrHeightPercent ?? 47,
    newsScrollSpeed: configured?.newsScrollSpeed ?? 42,
  }
}
export function resolveQrConfiguration(input: { qrEnabled: boolean; qrTargetUrl?: unknown }) {
  const target = input.qrEnabled ? input.qrTargetUrl : null
  return { enabled: input.qrEnabled, destination: input.qrEnabled ? safeDestination(target, false) : null }
}
export const MANIFEST_AUTHORIZATION_LEASE_MS = 15 * 60_000
export const manifestValidUntil = (now: Date) => new Date(now.getTime() + MANIFEST_AUTHORIZATION_LEASE_MS)
export function selectManifestDeliverySlots<T extends { campaignId: string; type: string; priority: number; id: string; sequence?: number; deliverySlot?: string | null }>(items: T[], campaigns: Array<{ id: string; deliverySlot?: string | null }>, v3: boolean) {
  const slots = new Map(campaigns.map(campaign => [campaign.id, campaign.deliverySlot ?? 'MAIN']))
  const slotFor = (item: T) => item.deliverySlot === 'SPONSORED' || slots.get(item.campaignId) === 'SPONSORED' ? 'SPONSORED' : 'MAIN'
  const deliveryOrder = (a: T, b: T) => b.priority - a.priority || a.campaignId.localeCompare(b.campaignId) || (a.sequence ?? 0) - (b.sequence ?? 0) || a.id.localeCompare(b.id)
  const mainItems = items.filter(item => slotFor(item) !== 'SPONSORED').sort(deliveryOrder)
  const sponsoredItem = v3 ? items.filter(item => slotFor(item) === 'SPONSORED' && item.type.toUpperCase() === 'IMAGE').sort((a,b) => b.priority - a.priority || a.campaignId.localeCompare(b.campaignId) || (a.sequence ?? 0) - (b.sequence ?? 0) || a.id.localeCompare(b.id))[0] ?? null : null
  return { mainItems, sponsoredItem }
}

export function sponsoredSlotDiagnostic(input: { contractVersion: number; playerSupportsSponsoredSlot: boolean; eligibleSponsorCount: number; assignedApprovedSponsorCount: number; exclusion?: { code: string; message: string } }): { code: string; message: string } {
  if (input.contractVersion < 3) return { code: 'SCREEN_LAYOUT_V2', message: 'This screen is using the V2 layout. An Admin must select and save OORO Standard V3 after the player confirms sponsored-slot support.' }
  if (!input.playerSupportsSponsoredSlot) return { code: 'PLAYER_CAPABILITY_UNCONFIRMED', message: 'The player has not confirmed sponsored-slot support in an authenticated heartbeat. Update/reconnect the player before assigning a sponsored image.' }
  if (input.eligibleSponsorCount > 0) return { code: 'READY', message: 'An eligible sponsored image is included in the next manifest.' }
  if (input.exclusion) return input.exclusion
  if (input.assignedApprovedSponsorCount > 0) return { code: 'SPONSOR_NOT_ELIGIBLE', message: 'A sponsored image is assigned, but no item passed active campaign, funding, approval, date, screen, and verified-asset checks.' }
  return { code: 'NO_APPROVED_SPONSORED_IMAGE', message: 'No approved, verified image is assigned to the Sponsored slot in an eligible campaign. Use Scheduler to assign an approved image to Sponsored placement.' }
}
export function campaignDeliveryQuota(input: { campaignId: string; displayId: string; revision: number; status: string; fundingStatus: string; authorizedPlays: number | null; unlimited: boolean; consumedPlays: number }): DeliveryQuota | null {
  if (input.status !== 'ACTIVE' || !['INTERNAL_TEST', 'PAID', 'FUNDED'].includes(input.fundingStatus)) return null
  // Device playback is not stopped by an offline play counter. Eligibility and
  // the signed manifest lease still bound playback; proofs remain for reporting.
  return { id: `${input.campaignId}:${input.displayId}`, revision: input.revision, remainingPlays: null, unlimited: true }
}
export function hasVerifiedAssetMetadata(asset: { active: boolean; url: string | null; checksum: string | null } | null | undefined): boolean {
  return Boolean(asset?.active && asset.url?.trim() && /^[a-f0-9]{64}$/i.test(asset.checksum ?? ''))
}
export function manifestDeliveryReasons(input: { displayEnabled: boolean; supportsDeliveryQuota: boolean; assignmentCount: number; campaigns: ManifestCampaignDiagnostic[]; eligibleItemCount: number }): ManifestReason[] {
  if (!input.displayEnabled) return ['DISPLAY_DISABLED']
  if (!input.supportsDeliveryQuota) return ['CLIENT_QUOTA_UNSUPPORTED']
  if (!input.assignmentCount) return ['NO_ASSIGNMENT']
  const reasons: ManifestReason[] = []
  const active = input.campaigns.filter((campaign) => campaign.status === 'ACTIVE')
  if (!active.length) reasons.push(input.campaigns.some((campaign) => ['APPROVED', 'SCHEDULED', 'PAUSED', 'STOPPED', 'COMPLETED', 'REJECTED'].includes(campaign.status)) ? 'CAMPAIGN_INACTIVE' : 'APPROVAL_REQUIRED')
  const funded = active.filter((campaign) => ['INTERNAL_TEST', 'PAID', 'FUNDED'].includes(campaign.fundingStatus))
  if (active.length && !funded.length) reasons.push('FUNDING_REQUIRED')
  const quotaEligible = funded
  if (quotaEligible.length && quotaEligible.every((campaign) => campaign.approvedCreativeCount === 0)) reasons.push('NO_APPROVED_CREATIVE')
  if (quotaEligible.some((campaign) => campaign.approvedCreativeCount > campaign.checksumVerifiedAssetCount) && input.eligibleItemCount === 0) reasons.push('ASSET_UNAVAILABLE')
  if (quotaEligible.length && input.eligibleItemCount === 0 && !reasons.includes('NO_APPROVED_CREATIVE') && !reasons.includes('ASSET_UNAVAILABLE')) reasons.push('NO_ELIGIBLE_CREATIVE')
  return [...new Set(reasons)]
}
// Display manifest versions are persisted in PostgreSQL INT4-backed fields.
// Seven hex digits keep the deterministic hash-derived version positive and
// within the signed 32-bit range while retaining stable change detection.
export const manifestVersionFromDigest = (digest: string) => Number.parseInt(digest.slice(0, 7), 16)
export const manifestVersionFor = (value: unknown) => manifestVersionFromDigest(createHash('sha256').update(JSON.stringify(value)).digest('hex'))
const assetBaseUrl = () => process.env.PUBLIC_ASSET_BASE_URL?.trim().replace(/\/$/, '') || (process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:3000')
export const deliveryAssetUrl = (url: string) => {
  const configuredBase = assetBaseUrl()
  try {
    const parsed = new URL(url, configuredBase || 'http://127.0.0.1:3000')
    if (configuredBase && ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname)) return `${configuredBase}${parsed.pathname}${parsed.search}`
    if (url.startsWith('http://') || url.startsWith('https://')) return url
  } catch { /* use the configured base for a malformed/relative storage URL */ }
  return `${configuredBase}${url.startsWith('/') ? url : `/${url}`}`
}

const trackingToken = () => randomBytes(24).toString('base64url')

async function trackingUrlFor(displayId: string, campaignId: string, creativeId: string, destination: unknown, ctaTypeValue: unknown, now: Date) {
  const destinationUrl = safeDestination(destination, config.nodeEnv === 'development')
  if (!destinationUrl) return null
  const ctaType = typeof ctaTypeValue === 'string' ? ctaTypeValue : 'WEBSITE'
  let link = await prisma.campaignTrackingLink.findFirst({ where: { campaignId, creativeId, displayId, active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: { createdAt: 'asc' } })
  if (!link) link = await prisma.campaignTrackingLink.create({ data: { token: trackingToken(), campaignId, creativeId, displayId, destinationUrl, ctaType } })
  else if (link.destinationUrl !== destinationUrl || link.ctaType !== ctaType) link = await prisma.campaignTrackingLink.update({ where: { id: link.id }, data: { destinationUrl, ctaType } })
  // Consumer QRs always enter on the canonical public OORO website. The API
  // origin (including staging) must never become a consumer QR destination.
  return { id: link.id, url: `https://theooro.com/go/${link.token}` }
}

export async function buildDisplayManifest(displayId: string, now = new Date()): Promise<{ manifest: DisplayManifest; reasons: ManifestReason[] }> {
  const display = await prisma.display.findUnique({ where: { id: displayId }, include: { vehicle: true, zoneConfig: true, layoutAssignments: { where: { state: 'ACTIVE', revokedAt: null }, orderBy: { assignedAt: 'desc' }, take: 1, include: { revision: true, template: { select: { state: true, mode: true } } } }, campaignAssignments: { where: { active: true }, include: { campaign: { include: { creatives: { include: { asset: true } } } } } } } })
  const reasons: ManifestReason[] = []
  if (!display || !display.deviceTokenHash || ['DISABLED','BLOCKED','MAINTENANCE'].includes(display.state)) return { manifest: emptyManifest(now), reasons: ['DISPLAY_DISABLED'] }
  if (!display.supportsDeliveryQuota) return { manifest: emptyManifest(now), reasons: ['CLIENT_QUOTA_UNSUPPORTED'] }
  // Legacy date/schedule fields remain audit-only. Only an explicitly ACTIVE,
  // funded campaign with a bounded or explicitly unlimited device grant ships.
  const active = display.campaignAssignments.filter(({ campaign }) => campaign.status === 'ACTIVE' && ['INTERNAL_TEST', 'PAID', 'FUNDED'].includes(campaign.commercialFundingStatus) && isCampaignDateEligible({ startsAt: campaign.startsAt, endsAt: campaign.endsAt }, now))
  const eligible: typeof active = []
  const quotaByCampaign = new Map<string, DeliveryQuota>()
  for (const assignment of active) {
    const campaign = assignment.campaign
    const quota = campaignDeliveryQuota({ campaignId: campaign.id, displayId, revision: assignment.offlineQuotaRevision, status: campaign.status, fundingStatus: campaign.commercialFundingStatus, authorizedPlays: assignment.offlinePlaysAuthorized, unlimited: assignment.unlimitedOfflineAuthorized, consumedPlays: assignment.offlinePlaysConsumed })
    if (quota) { eligible.push(assignment); quotaByCampaign.set(campaign.id, quota) }
  }
  const items: DisplayManifest["items"] = (await Promise.all(eligible.flatMap(({ campaign }) => campaign.creatives.filter((creative) => creative.status === 'APPROVED' && hasVerifiedAssetMetadata(creative.asset)).map(async (creative) => {
    const metadata = campaign.metadata && typeof campaign.metadata === 'object' && !Array.isArray(campaign.metadata) ? campaign.metadata as Record<string, unknown> : {}
    const offer = metadata.offer && typeof metadata.offer === 'object' && !Array.isArray(metadata.offer) ? metadata.offer as Record<string, unknown> : metadata
    const legacyOffer = metadata.offer && typeof metadata.offer === 'object' && !Array.isArray(metadata.offer) ? metadata.offer as Record<string, unknown> : metadata
    const qr = resolveQrConfiguration({ qrEnabled: creative.qrEnabled === true, qrTargetUrl: creative.qrTargetUrl })
    const trackingLink = qr.destination ? await trackingUrlFor(displayId, campaign.id, creative.id, qr.destination, legacyOffer.ctaType ?? metadata.ctaType, now) : null
    const trackingUrl = trackingLink?.url ?? null
    const indiaDayStart = new Date(`${now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}T00:00:00+05:30`)
    const scanCount = trackingUrl ? await prisma.qrScan.count({ where: { campaignId: campaign.id, creativeId: creative.id, displayId, occurredAt: { gte: indiaDayStart } } }) : null
    return { id: creative.id, campaignId: campaign.id, creativeId: creative.id, assetId: creative.asset!.id, type: creative.type.toUpperCase() === 'VIDEO' ? 'VIDEO' : 'IMAGE', url: deliveryAssetUrl(creative.asset!.url), checksum: creative.asset!.checksum!, durationSeconds: creative.type.toUpperCase() === 'VIDEO' ? creative.asset!.durationSeconds ?? creative.durationSeconds : creative.durationSeconds, deliverySlot: creative.deliverySlot === 'SPONSORED' || campaign.deliverySlot === 'SPONSORED' ? 'SPONSORED' : 'MAIN', priority: campaign.priority, sequence: creative.displayOrder, startAt: campaign.startsAt?.toISOString() ?? null, endAt: campaign.endsAt?.toISOString() ?? null, deliveryQuota: quotaByCampaign.get(campaign.id)!, fitMode: typeof metadata.fitMode === 'string' ? metadata.fitMode : 'FIT', qrEnabled: Boolean(trackingUrl), qrTargetUrl: trackingUrl, qrLabel: creative.qrLabel ?? (typeof legacyOffer.ctaLabel === 'string' ? legacyOffer.ctaLabel : null), qrVersion: creative.qrVersion, offer: { ...offer, brandName: creative.brandName ?? metadata.brand ?? metadata.brandName, promotionalText: creative.promotionalText, ...(trackingUrl ? { qrUrl: trackingUrl, authorizedDestinationId: trackingLink?.id, scanCount, scanCountDisplayEnabled: offer.scanCountDisplayEnabled === true } : { qrUrl: null, authorizedDestinationId: null, scanCount: null }) } }
  })))).sort((a, b) => b.priority - a.priority || a.campaignId.localeCompare(b.campaignId) || (a.sequence ?? 0) - (b.sequence ?? 0) || a.id.localeCompare(b.id))
  const deliveryItems = items
  const diagnosticCampaigns = display.campaignAssignments.map(({ campaign, offlinePlaysAuthorized, unlimitedOfflineAuthorized, offlinePlaysConsumed, offlineQuotaRevision }) => ({
    status: campaign.status,
    fundingStatus: campaign.commercialFundingStatus,
    quotaAuthorized: campaignDeliveryQuota({ campaignId: campaign.id, displayId, revision: offlineQuotaRevision, status: campaign.status, fundingStatus: campaign.commercialFundingStatus, authorizedPlays: offlinePlaysAuthorized, unlimited: unlimitedOfflineAuthorized, consumedPlays: offlinePlaysConsumed }) != null,
    approvedCreativeCount: campaign.creatives.filter((creative) => creative.status === 'APPROVED').length,
    checksumVerifiedAssetCount: campaign.creatives.filter((creative) => creative.status === 'APPROVED' && hasVerifiedAssetMetadata(creative.asset)).length,
  }))
  reasons.push(...manifestDeliveryReasons({ displayEnabled: true, supportsDeliveryQuota: true, assignmentCount: display.campaignAssignments.length, campaigns: diagnosticCampaigns, eligibleItemCount: deliveryItems.length }))
  // Restore the established passenger layout for legacy campaigns that still
  // carry the old fullscreen default.
  const configured = display.zoneConfig
  const contractVersion = configured?.layoutContractVersion ?? 2
  const v3 = contractVersion >= 3
  // Keep older contract geometry intact and serialize contract v2/v3 bounds
  // exactly as the Android renderer consumes them.
  const assignedLayout = defaultFourZoneLayout(configured, contractVersion)
  const leadCampaignId = deliveryItems.find(item => item.deliverySlot !== 'SPONSORED')?.campaignId
  const leadCampaign = leadCampaignId ? eligible.find(({ campaign }) => campaign.id === leadCampaignId)?.campaign : undefined
  const metadata = leadCampaign?.metadata && typeof leadCampaign.metadata === 'object' && !Array.isArray(leadCampaign.metadata) ? leadCampaign.metadata as Record<string, unknown> : {}
  const requestedLayout = metadata.presentationLayout
  const playerLayoutVersion = typeof display.appVersion === 'string' ? (display.appVersion.match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number) ?? [0, 0, 0]) : [0, 0, 0]
  const supportsThreeZone = playerLayoutVersion[0]! > 0 || playerLayoutVersion[1]! > 3 || playerLayoutVersion[1] === 3 && playerLayoutVersion[2]! >= 4
  const requestedThreeZone = requestedLayout === THREE_ZONE_AD_SPONSOR_QR_V1
  const threeZoneAvailable = requestedThreeZone && supportsThreeZone && display.supportsSponsoredSlot
  const layout = threeZoneAvailable
    ? { ...THREE_ZONE_AD_SPONSOR_QR_CONTRACT_V1, contractVersion: 3, newsScrollSpeed: configured?.newsScrollSpeed ?? 42 }
    : requestedLayout === 'FULLSCREEN_AD' || requestedLayout === 'SPLIT_50_25_25'
    ? requestedLayout
    : requestedLayout === 'FOUR_ZONE'
      ? { ...assignedLayout, type: 'FOUR_ZONE', contractVersion: 2 }
      : requestedLayout === 'FOUR_ZONE_V3' && v3
        ? { ...assignedLayout, type: 'FOUR_ZONE', contractVersion: 3 }
      : assignedLayout
  const city = display.vehicle?.city
  const announcements = v3 || threeZoneAvailable ? [] : await prisma.newsAnnouncement.findMany({ where: { active: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, display.vehicleId ? { OR: [{ vehicleId: null }, { vehicleId: display.vehicleId }] } : { vehicleId: null }, city ? { OR: [{ city: null }, { city }] } : { city: null }] }, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], take: 12, select: { id: true, text: true, priority: true } })
  const { mainItems, sponsoredItem } = selectManifestDeliverySlots(deliveryItems, eligible.map(({ campaign }) => ({ id: campaign.id, deliverySlot: campaign.deliverySlot })), v3 || threeZoneAvailable)
  const sponsorCandidates = display.campaignAssignments.flatMap(({ campaign }) => campaign.creatives.filter(creative => (creative.deliverySlot === 'SPONSORED' || campaign.deliverySlot === 'SPONSORED') && creative.type.toUpperCase() === 'IMAGE').map(creative => ({ campaign, creative })))
  const assignedApprovedSponsorCount = sponsorCandidates.filter(({ creative }) => creative.status === 'APPROVED').length
  const firstSponsorExclusion = sponsorCandidates.map(({ campaign, creative }) => {
    if (creative.status !== 'APPROVED') return { code: 'SPONSOR_APPROVAL_REQUIRED', message: `Sponsored image “${creative.name}” is ${creative.status.toLowerCase()}; approve it before Scheduler can deliver it.` }
    if (campaign.status !== 'ACTIVE') return { code: 'SPONSOR_CAMPAIGN_INACTIVE', message: `Sponsored image “${creative.name}” is excluded because campaign “${campaign.name}” is ${campaign.status.toLowerCase()}. An authorized Admin must activate an approved campaign.` }
    if (!['INTERNAL_TEST', 'PAID', 'FUNDED'].includes(campaign.commercialFundingStatus)) return { code: 'SPONSOR_FUNDING_REQUIRED', message: `Sponsored image “${creative.name}” is excluded because campaign funding is ${campaign.commercialFundingStatus.toLowerCase()}.` }
    if (!isCampaignDateEligible({ startsAt: campaign.startsAt, endsAt: campaign.endsAt }, now)) return { code: 'SPONSOR_OUTSIDE_CAMPAIGN_DATES', message: `Sponsored image “${creative.name}” is outside campaign “${campaign.name}”’s active date window.` }
    if (!hasVerifiedAssetMetadata(creative.asset)) return { code: 'SPONSOR_ASSET_UNAVAILABLE', message: `Sponsored image “${creative.name}” is approved but its asset is inactive or lacks verified checksum metadata.` }
    return null
  }).find((reason): reason is { code: string; message: string } => reason !== null)
  const sponsoredSlotState = sponsoredSlotDiagnostic({ contractVersion: v3 || threeZoneAvailable ? 3 : 2, playerSupportsSponsoredSlot: display.supportsSponsoredSlot, eligibleSponsorCount: sponsoredItem ? 1 : 0, assignedApprovedSponsorCount, exclusion: firstSponsorExclusion })
  const sponsoredLayoutIssue = requestedLayout === 'FOUR_ZONE_V3' && !v3
    ? { code: 'SCREEN_LAYOUT_V2', message: 'Campaign requested OORO Standard V3, but this screen is configured for V2. Save the screen layout as V3 after player support is confirmed.' }
    : requestedThreeZone && !supportsThreeZone
      ? { code: 'PLAYER_LAYOUT_UNSUPPORTED', message: 'The player version does not support the three-zone MBOX preset. Install a compatible player and wait for its authenticated heartbeat.' }
      : requestedThreeZone && !display.supportsSponsoredSlot
        ? { code: 'PLAYER_CAPABILITY_UNCONFIRMED', message: 'The player has not confirmed sponsored-slot support in an authenticated heartbeat.' }
        : undefined
  const assignment = display.layoutAssignments[0]
  const candidateLayout = assignment?.template.state === 'PUBLISHED' && assignment.template.mode === 'CUSTOM' && assignment.revision.contract && typeof assignment.revision.contract === 'object' && !Array.isArray(assignment.revision.contract) ? assignment.revision.contract as Record<string, unknown> : null
  const layoutStudioContract = candidateLayout ? deliverableLayoutContract(candidateLayout) : null
  const versionItems = mainItems.map((item) => ({ ...item, offer: Object.fromEntries(Object.entries(item.offer).filter(([key]) => key !== 'scanCount')) }))
  const news = { scrollSpeed: configured?.newsScrollSpeed ?? 42, announcements }
  const includeSponsoredSlot = v3 || threeZoneAvailable
  const sponsorDiagnostic = sponsoredLayoutIssue ?? sponsoredSlotState
  const digest = createHash('sha256').update(JSON.stringify({ displayId, layout, leadCampaignId, layoutStudioContract, news, deliveryReasons: reasons, items: versionItems, ...(includeSponsoredSlot ? { sponsoredItem } : {}), sponsoredSlotDiagnostic: sponsorDiagnostic })).digest('hex')
  return { manifest: { manifestId: `manifest-${digest.slice(0, 24)}`, version: manifestVersionFromDigest(digest), generatedAt: now.toISOString(), expiresAt: manifestValidUntil(now).toISOString(), deliveryReasons: reasons, layout, ...(layoutStudioContract ? { layoutStudioContract } : {}), news, items: mainItems, ...(includeSponsoredSlot ? { sponsoredItem } : {}), sponsoredSlotDiagnostic: sponsorDiagnostic }, reasons }
}
const emptyManifest = (now: Date): DisplayManifest => ({ manifestId: 'manifest-empty', version: 0, generatedAt: now.toISOString(), expiresAt: manifestValidUntil(now).toISOString(), deliveryReasons: [], layout: { type: 'FOUR_ZONE', contractVersion: 2, primaryWidthPercent: 80, adHeightPercent: 88, qrHeightPercent: 50, newsScrollSpeed: 42 }, news: { scrollSpeed: 42, announcements: [] }, items: [] })
