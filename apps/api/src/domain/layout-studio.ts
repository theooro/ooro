import { z } from 'zod'

export const layoutProfileIds = ['OORO_AUTO_LITE', 'OORO_PREMIUM', 'OORO_RETAIL_EVENT', 'MBOX_ANDROID10_1280_720_V1'] as const
export const MBOX_PROFILE_ID = 'MBOX_ANDROID10_1280_720_V1' as const
export const certificationChecks = ['renderer', 'resources', 'offlineFallback', 'playback', 'proofIsolation'] as const
export type CertificationCheck = typeof certificationChecks[number]
export type WidgetCertification = { provider: string | null; reason: string; checks: Record<CertificationCheck, boolean>; evidence: string[] }

const pending = (provider: string | null, reason: string): WidgetCertification => ({
  provider, reason, checks: { renderer: false, resources: false, offlineFallback: false, playback: false, proofIsolation: false }, evidence: [],
})

/** Reviewed source registry, never supplied by a browser, draft or environment override. */
export const mboxProfile = {
  id: MBOX_PROFILE_ID, revision: 1, label: 'MBOX · Android 10 · 1280×720 · acceptance pending',
  hardware: { model: 'MBOX', apiLevel: 29, abi: 'armeabi-v7a', densityDpi: 213, memoryKiB: 3891432, hardware: 'sun50iw9p1', boardPlatform: 'cupid', firmwareFingerprintSha256: '10c10aab9b732bfa48740800d877da2a3bb27d9b141b70fffae9dbb946df5cab' },
  player: { packageName: 'com.ooro.screenplayer', observedVersionCode: 4, candidateVersionCode: 5, rendererContractVersion: 1 },
  target: { width: 1280, height: 720 }, screenType: 'AUTO_SCREEN' as const,
  // Proposed first acceptance envelope; these are not measured/certified limits.
  proposedLimits: { zones: 2, imageZones: 1, videoDecoders: 0, rotationItems: 0 },
  acceptance: pending('Versioned MBOX Custom renderer/resource envelope', 'Resource envelope acceptance is pending.'),
  widgets: {
    IMAGE: pending('Manifest-backed verified local image decoder', 'Custom Image renderer, resource, offline and proof-isolation acceptance has not passed on this profile.'),
    TEXT: pending('Persisted zone label rendered by Compose Text', 'Custom static Text clipping, resource and offline acceptance has not passed on this profile.'),
    LOGO: pending('Manifest-backed verified local image decoder', 'Logo bounds and resource acceptance is pending.'),
    BACKGROUND_IMAGE: pending('Manifest-backed verified local image decoder', 'Background image decode/memory and layering acceptance is pending.'),
    VIDEO: pending('Media3 with a manifest-backed verified local asset', 'Custom Video decoder count, sustained playback, offline recovery and proof isolation are not certified.'),
    MAIN_AD: pending('Separately authorized primary campaign pipeline', 'Custom main-slot playback and paid-proof attribution are not certified.'),
    SPONSORED_AD: pending('Separately authorized sponsored image pipeline', 'Custom sponsor-slot playback and proof attribution are not certified.'),
    QR_OFFER: pending('Manifest-authorized destination and native QR encoder', 'Preset QR tests do not certify Custom QR bindings or resource limits.'),
    CLOCK: pending(null, 'No Custom clock provider is implemented; a static label is not a clock.'),
    WEATHER: pending(null, 'No authenticated weather data source or Custom weather provider exists.'),
    TICKER: pending(null, 'The preset news ticker is not connected to a Custom widget data source or runtime.'),
    NAVIGATION_MAP: pending(null, 'The preset navigation path is not connected to a certified Custom map provider/data source.'),
    STATIC_QR: pending(null, 'No Custom static-QR runtime and authorized destination adapter exists.'),
    EXTERNAL_DESTINATION: pending(null, 'No Custom external-destination runtime exists.'),
  } satisfies Record<WidgetType, WidgetCertification>,
}

export function widgetCertified(certification: WidgetCertification): boolean {
  return certification.provider !== null && certification.evidence.length > 0 && certificationChecks.every(check => certification.checks[check])
}

export const profileOptions = [
  { id: 'OORO_AUTO_LITE', label: 'OORO Auto Lite · unverified Custom runtime', target: { width: 1280, height: 720 }, screenType: 'AUTO_SCREEN' },
  { id: 'OORO_PREMIUM', label: 'OORO Premium · unverified Custom runtime', target: { width: 1280, height: 720 }, screenType: 'PREMIUM_DISPLAY' },
  { id: 'OORO_RETAIL_EVENT', label: 'OORO Retail / Event · unverified Custom runtime', target: { width: 1080, height: 1920 }, screenType: 'RETAIL_EVENT' },
  { id: MBOX_PROFILE_ID, label: mboxProfile.label, target: mboxProfile.target, screenType: mboxProfile.screenType },
] as const

export const publicationIssueCodes = new Set(['NO_VISIBLE_ZONES', 'CAPABILITY_PROFILE_UNVERIFIED', 'WIDGET_CERTIFICATION_REQUIRED', 'WIDGET_PROVIDER_UNAVAILABLE', 'PROFILE_RESOURCE_BUDGET_UNVERIFIED', 'PROFILE_RESOURCE_LIMIT_EXCEEDED', 'PROFILE_WIDGET_UNSUPPORTED'])

export function layoutCapabilityIssues(draft: LayoutDraft): LayoutIssue[] {
  if (draft.mode !== 'CUSTOM') return []
  const declaredProfile = profileOptions.find(profile => profile.id === draft.profileId)
  if (draft.screenType && draft.screenType !== declaredProfile?.screenType) return [{ code: 'PROFILE_TARGET_MISMATCH', message: 'Screen type must match the selected hardware profile.' }]
  if (draft.profileId !== MBOX_PROFILE_ID && draft.capabilityProfileVersion !== undefined) return [{ code: 'PROFILE_VERSION_MISMATCH', message: 'Only versioned hardware profiles accept a capabilityProfileVersion.' }]
  if (draft.profileId !== MBOX_PROFILE_ID) return [{ code: 'CAPABILITY_PROFILE_UNVERIFIED', message: `Custom layouts cannot be published for ${draft.profileId} until its runtime capabilities and resource budget are certified.` }]
  const issues: LayoutIssue[] = []
  if (draft.capabilityProfileVersion !== mboxProfile.revision) issues.push({ code: 'PROFILE_VERSION_MISMATCH', message: 'MBOX requires capability profile revision 1.' })
  if (draft.target.width !== mboxProfile.target.width || draft.target.height !== mboxProfile.target.height || draft.screenType !== mboxProfile.screenType) issues.push({ code: 'PROFILE_TARGET_MISMATCH', message: 'MBOX revision 1 requires AUTO_SCREEN at native landscape 1280×720.' })
  for (const zone of draft.zones.filter(zone => zone.visible)) {
    const certification = mboxProfile.widgets[zone.type]
    if (!['IMAGE', 'TEXT'].includes(zone.type)) issues.push({ code: 'PROFILE_WIDGET_UNSUPPORTED', zoneId: zone.id, message: `${zone.type} is outside the MBOX revision 1 candidate envelope (one Image plus static Text only).` })
    if (!widgetCertified(certification)) issues.push({ code: certification.provider ? 'WIDGET_CERTIFICATION_REQUIRED' : 'WIDGET_PROVIDER_UNAVAILABLE', zoneId: zone.id, message: `${zone.label}: ${certification.reason}` })
  }
  // Do not turn proposed budgets into certified limits just because a widget has a renderer.
  if (!widgetCertified(mboxProfile.acceptance)) issues.push({ code: 'PROFILE_RESOURCE_BUDGET_UNVERIFIED', message: 'The MBOX Custom resource envelope has not passed device-profile acceptance; publication remains blocked.' })
  if (draft.zones.length > mboxProfile.proposedLimits.zones || draft.zones.filter(zone => ['IMAGE', 'LOGO', 'BACKGROUND_IMAGE'].includes(zone.type)).length > mboxProfile.proposedLimits.imageZones || draft.zones.some(zone => zone.rotation)) issues.push({ code: 'PROFILE_RESOURCE_LIMIT_EXCEEDED', message: 'The initial MBOX candidate envelope is one image plus one static text zone, without rotation or video. It is not yet certified.' })
  return issues
}


export const layoutModes = ['STANDARD', 'CUSTOM'] as const
export const layoutPresets = ['OORO_STANDARD_V3', '65_35', '50_50', 'FULLSCREEN', 'MAIN_SIDEBAR', 'GRID', 'CUSTOM_CANVAS'] as const
export const widgetTypes = ['MAIN_AD', 'SPONSORED_AD', 'IMAGE', 'VIDEO', 'QR_OFFER', 'LOGO', 'TEXT', 'BACKGROUND_IMAGE', 'CLOCK', 'WEATHER', 'TICKER', 'NAVIGATION_MAP', 'STATIC_QR', 'EXTERNAL_DESTINATION'] as const

export const layoutRotationItemSchema = z.object({ referenceId: z.string().uuid(), durationSeconds: z.number().int().min(3).max(3600) }).strict()
export const layoutRotationSchema = z.object({ version: z.literal(1), mode: z.literal('SEQUENTIAL'), items: z.array(layoutRotationItemSchema).min(1).max(12) }).strict()

export const layoutZoneSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum(widgetTypes),
  label: z.string().trim().min(1).max(80),
  schemaVersion: z.literal(1),
  geometry: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).strict(),
  zIndex: z.number().int().min(0).max(100),
  fit: z.enum(['FIT', 'CENTER_CROP']).default('FIT'),
  contentBinding: z.object({ kind: z.enum(['NONE', 'APPROVED_CREATIVE', 'APPROVED_SPONSOR', 'AUTHORIZED_DESTINATION']), referenceId: z.string().max(100).optional() }).strict(),
  rotation: layoutRotationSchema.optional(),
  visible: z.boolean().default(true),
}).strict()

export const layoutDraftSchema = z.object({
  contractVersion: z.literal(1),
  mode: z.enum(layoutModes),
  preset: z.enum(layoutPresets),
  profileId: z.enum(layoutProfileIds),
  capabilityProfileVersion: z.number().int().positive().optional(),
  screenType: z.enum(['AUTO_SCREEN', 'PREMIUM_DISPLAY', 'RETAIL_EVENT']).optional(),
  target: z.object({ width: z.number().int().min(320).max(7680), height: z.number().int().min(240).max(4320) }).strict(),
  zones: z.array(layoutZoneSchema).max(24),
}).strict()

export type LayoutZone = z.infer<typeof layoutZoneSchema>
export type WidgetType = typeof widgetTypes[number]
export type LayoutDraft = z.infer<typeof layoutDraftSchema>
export type LayoutIssue = { code: string; message: string; zoneId?: string }

/** Creative media bindings are type checked; layout references never make an item eligible. */
export function creativeTypeMatchesWidget(widgetType: WidgetType, creativeType: string): boolean {
  const mediaType = creativeType.toUpperCase()
  if (widgetType === 'MAIN_AD') return mediaType === 'IMAGE' || mediaType === 'VIDEO'
  if (widgetType === 'SPONSORED_AD') return mediaType === 'IMAGE'
  if (widgetType === 'VIDEO') return mediaType === 'VIDEO'
  if (widgetType === 'IMAGE' || widgetType === 'LOGO' || widgetType === 'BACKGROUND_IMAGE') return mediaType === 'IMAGE'
  return false
}

const standardGeometry = [
  { type: 'MAIN_AD', x: 0, y: 0, width: .8, height: .85 },
  { type: 'SPONSORED_AD', x: 0, y: .85, width: .8, height: .15 },
  { type: 'QR_OFFER', x: .8, y: 0, width: .2, height: .5 },
  { type: 'NAVIGATION_MAP', x: .8, y: .5, width: .2, height: .5 },
] as const

export function standardV3Draft(): LayoutDraft {
  return {
    contractVersion: 1, mode: 'STANDARD', preset: 'OORO_STANDARD_V3', profileId: 'OORO_AUTO_LITE', target: { width: 1280, height: 720 },
    zones: standardGeometry.map((zone, index) => ({ id: `standard-${index + 1}`, type: zone.type, label: zone.type.replaceAll('_', ' '), schemaVersion: 1 as const, geometry: { x: zone.x, y: zone.y, width: zone.width, height: zone.height }, zIndex: index, fit: 'FIT' as const, contentBinding: { kind: 'NONE' as const }, visible: true })),
  }
}

export function validateLayoutDraft(input: unknown): { draft?: LayoutDraft; issues: LayoutIssue[] } {
  const parsed = layoutDraftSchema.safeParse(input)
  if (!parsed.success) return { issues: parsed.error.issues.map(issue => ({ code: 'SCHEMA_INVALID', message: `${issue.path.join('.') || 'layout'}: ${issue.message}` })) }
  const draft = parsed.data
  const issues: LayoutIssue[] = []
  if (!draft.zones.some(zone => zone.visible)) issues.push({ code: 'NO_VISIBLE_ZONES', message: 'A layout requires at least one visible widget.' })
  const ids = new Set<string>()
  let videoZones = 0
  let mainAdZones = 0
  let sponsorZones = 0
  const boundedWidgetZones = new Map<string, number>()
  for (const zone of draft.zones) {
    if (ids.has(zone.id)) issues.push({ code: 'DUPLICATE_ZONE_ID', zoneId: zone.id, message: 'Zone IDs must be unique.' })
    ids.add(zone.id)
    const { x, y, width, height } = zone.geometry
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 + 1e-9 || y + height > 1 + 1e-9) {
      issues.push({ code: 'ZONE_OUT_OF_BOUNDS', zoneId: zone.id, message: `${zone.label} must remain within the screen with a positive size.` })
    }
    if (zone.fit === 'CENTER_CROP' && !['MAIN_AD', 'SPONSORED_AD', 'IMAGE', 'VIDEO', 'LOGO', 'BACKGROUND_IMAGE'].includes(zone.type)) issues.push({ code: 'INVALID_FIT', zoneId: zone.id, message: 'Crop fitting is supported only for media zones.' })
    if (zone.contentBinding.kind !== 'NONE' && !zone.contentBinding.referenceId) issues.push({ code: 'BINDING_REFERENCE_REQUIRED', zoneId: zone.id, message: 'A bound content reference is required.' })
    if (zone.rotation) {
      if (zone.type !== 'IMAGE') issues.push({ code: 'ROTATION_UNSUPPORTED_ZONE', zoneId: zone.id, message: 'Sequential rotation is currently supported only for IMAGE zones.' })
      const refs = zone.rotation.items.map(item => item.referenceId)
      if (new Set(refs).size !== refs.length) issues.push({ code: 'ROTATION_DUPLICATE_ITEM', zoneId: zone.id, message: 'A rotation sequence cannot contain the same creative more than once.' })
      if (zone.contentBinding.kind !== 'NONE') issues.push({ code: 'ROTATION_BINDING_CONFLICT', zoneId: zone.id, message: 'Use either a single content binding or a rotation sequence for this zone.' })
    }
    if (zone.type === 'VIDEO') videoZones += 1
    if (zone.type === 'MAIN_AD') mainAdZones += 1
    if (zone.type === 'SPONSORED_AD') sponsorZones += 1
    if (['CLOCK', 'WEATHER', 'TICKER', 'NAVIGATION_MAP', 'QR_OFFER'].includes(zone.type)) {
      boundedWidgetZones.set(zone.type, (boundedWidgetZones.get(zone.type) ?? 0) + 1)
    }
  }
  if (videoZones > 1 || videoZones + mainAdZones > 1) issues.push({ code: 'VIDEO_DECODER_BUDGET_EXCEEDED', message: 'Layouts may contain at most one possible video playback slot across MAIN_AD and VIDEO zones.' })
  if (mainAdZones > 1) issues.push({ code: 'MULTIPLE_MAIN_AD_ZONES', message: 'A layout may contain at most one primary campaign advertising zone.' })
  if (sponsorZones > 1) issues.push({ code: 'MULTIPLE_SPONSOR_ZONES', message: 'A layout may contain at most one independently authorized sponsored slot.' })
  for (const [type, count] of boundedWidgetZones) if (count > 1) issues.push({ code: 'WIDGET_BUDGET_EXCEEDED', message: `A layout may contain at most one ${type} zone on the current renderer.` })
  const overlayTypes = new Set(['TEXT', 'LOGO', 'CLOCK'])
  for (let left = 0; left < draft.zones.length; left += 1) for (let right = left + 1; right < draft.zones.length; right += 1) {
    const a = draft.zones[left], b = draft.zones[right]
    if (!a || !b || a.type === 'BACKGROUND_IMAGE' || b.type === 'BACKGROUND_IMAGE' || overlayTypes.has(a.type) || overlayTypes.has(b.type)) continue
    const overlaps = a.geometry.x < b.geometry.x + b.geometry.width && a.geometry.x + a.geometry.width > b.geometry.x && a.geometry.y < b.geometry.y + b.geometry.height && a.geometry.y + a.geometry.height > b.geometry.y
    if (overlaps) issues.push({ code: 'ZONE_OVERLAP', zoneId: b.id, message: `${a.label} and ${b.label} overlap. Only background, text, logo and clock overlays may layer.` })
  }
  if (draft.mode === 'STANDARD') {
    const canonical = standardV3Draft()
    if (draft.preset !== 'OORO_STANDARD_V3' || draft.profileId !== 'OORO_AUTO_LITE' || (draft.screenType !== undefined && draft.screenType !== 'AUTO_SCREEN') || draft.capabilityProfileVersion !== undefined || draft.target.width <= draft.target.height || draft.zones.length !== canonical.zones.length || draft.zones.some((zone, i) => {
      const expected = canonical.zones[i]
      return !expected || zone.type !== expected.type || JSON.stringify(zone.geometry) !== JSON.stringify(expected.geometry) || !zone.visible || zone.fit !== 'FIT'
    })) issues.push({ code: 'STANDARD_LOCKED', message: 'OORO Standard V3 geometry is locked and cannot be resized or rearranged.' })
  }
  issues.push(...layoutCapabilityIssues(draft))
  return { draft, issues }
}

export function standardPixelGeometry(width: number, height: number) {
  const rect = (x: number, y: number, w: number, h: number) => normalizedPixelRect({ x, y, width: w, height: h }, width, height)
  const main = rect(0, 0, .8, .85)
  const sponsor = rect(0, .85, .8, .15)
  const qr = rect(.8, 0, .2, .5)
  const navigation = rect(.8, .5, .2, .5)
  return {
    mainAd: main,
    sponsoredAd: sponsor,
    qrOffer: qr,
    navigation,
  }
}

/** Move a normalized zone while keeping every edge on the 1% editor grid. */
export function moveLayoutZoneGeometry(
  geometry: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
  step = 0.01,
) {
  const snap = (value: number) => Math.round(value / step) * step
  const maxX = Math.max(0, 1 - geometry.width)
  const maxY = Math.max(0, 1 - geometry.height)
  return {
    ...geometry,
    x: Math.min(maxX, Math.max(0, snap(geometry.x + dx))),
    y: Math.min(maxY, Math.max(0, snap(geometry.y + dy))),
  }
}

/** Resize a normalized zone, preserving a minimum visible size and canvas bounds. */
export function resizeLayoutZoneGeometry(
  geometry: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
  minimum = 0.05,
  step = 0.01,
) {
  const snap = (value: number) => Math.round(value / step) * step
  const maxWidth = Math.max(minimum, 1 - geometry.x)
  const maxHeight = Math.max(minimum, 1 - geometry.y)
  return {
    ...geometry,
    width: Math.min(maxWidth, Math.max(minimum, snap(geometry.width + dx))),
    height: Math.min(maxHeight, Math.max(minimum, snap(geometry.height + dy))),
  }
}

/** Arrow keys move a selected zone by 0.5%, or 2% with Shift. */
export function keyboardMoveLayoutZoneGeometry(
  geometry: { x: number; y: number; width: number; height: number },
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  shift = false,
) {
  const step = shift ? 0.02 : 0.005
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0
  return {
    ...geometry,
    x: Math.max(0, Math.min(1 - geometry.width, geometry.x + dx)),
    y: Math.max(0, Math.min(1 - geometry.height, geometry.y + dy)),
  }
}

/** Convert screen-space pointer movement to normalized units using the rendered canvas bounds. */
export function pointerDeltaToLayoutUnits(
  deltaX: number,
  deltaY: number,
  renderedWidth: number,
  renderedHeight: number,
) {
  return {
    x: renderedWidth > 0 ? deltaX / renderedWidth : 0,
    y: renderedHeight > 0 ? deltaY / renderedHeight : 0,
  }
}

/** Uses edge rounding to match the Android renderer; adjacent zones share identical rounded boundaries. */
export function normalizedPixelRect(geometry: { x: number; y: number; width: number; height: number }, screenWidth: number, screenHeight: number) {
  const left = Math.round(geometry.x * screenWidth)
  const top = Math.round(geometry.y * screenHeight)
  const right = Math.round((geometry.x + geometry.width) * screenWidth)
  const bottom = Math.round((geometry.y + geometry.height) * screenHeight)
  return { x: left, y: top, width: right - left, height: bottom - top }
}
