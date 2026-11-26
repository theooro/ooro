import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export const PARTNER_API_VERSION = 'v1' as const
export const PARTNER_SCOPES = [
  'mobility.events:write', 'campaigns:submit', 'campaigns:read', 'inventory:read',
  'delivery:read', 'analytics.qr:read', 'webhooks:manage',
] as const
export type PartnerScope = typeof PARTNER_SCOPES[number]
export type PartnerEnvironment = 'SANDBOX' | 'STAGING' | 'PRODUCTION'

// Deliberately excludes passenger, origin/destination, route, address, and precise trip identifiers.
export const normalizedRideEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.enum(['RIDE_REQUESTED','RIDE_ACCEPTED','RIDE_ACTIVE','RIDE_CANCELLED','RIDE_COMPLETED']),
  occurredAt: z.string().datetime({ offset: true }),
  consent: z.literal(true),
  context: z.object({
    serviceArea: z.string().trim().min(1).max(80).optional(),
    vehicleClass: z.enum(['AUTO','CAB','TWO_WHEELER']).optional(),
    aggregateTripBand: z.enum(['SHORT','MEDIUM','LONG']).optional(),
    feature: z.enum(['MOBILITY_VERIFICATION','SERVICEABILITY']).optional(),
  }).strict().default({}),
}).strict().superRefine((event, ctx) => {
  if (Date.parse(event.occurredAt) > Date.now() + 5 * 60_000) ctx.addIssue({ code: 'custom', path: ['occurredAt'], message: 'Event timestamp is too far in the future.' })
  if (Date.now() - Date.parse(event.occurredAt) > 7 * 24 * 60 * 60_000) ctx.addIssue({ code: 'custom', path: ['occurredAt'], message: 'Events older than seven days cannot be replayed.' })
})
export type NormalizedRideEvent = z.infer<typeof normalizedRideEventSchema>

export type PartnerAdapterContext = { partnerId: string; environment: PartnerEnvironment; requestId: string }
export interface MobilityPartnerAdapter {
  readonly providerId: string
  normalize(input: unknown, context: PartnerAdapterContext): Promise<NormalizedRideEvent>
}

export type PartnerCredential = { partnerId: string; clientId: string; environment: PartnerEnvironment; scopes: PartnerScope[]; secretHash: string; revokedAt: number | null; expiresAt: number | null }
export type PartnerPrincipal = Pick<PartnerCredential, 'partnerId' | 'clientId' | 'environment' | 'scopes'>
export function hashPartnerSecret(secret: string): string { return createHash('sha256').update(secret).digest('hex') }
export function issuePartnerCredential(input: Omit<PartnerCredential, 'secretHash' | 'revokedAt' | 'expiresAt'> & { expiresAt?: number | null }) {
  const secret = `ooro_${input.environment.toLowerCase()}_${randomBytes(32).toString('base64url')}`
  return { credential: { ...input, secretHash: hashPartnerSecret(secret), revokedAt: null, expiresAt: input.expiresAt ?? null }, secret }
}
export function authenticatePartner(credential: PartnerCredential | undefined, presentedSecret: string, environment: PartnerEnvironment, now = Date.now()): PartnerPrincipal | null {
  if (!credential || credential.revokedAt !== null || credential.environment !== environment || (credential.expiresAt !== null && credential.expiresAt <= now)) return null
  const actual = Buffer.from(credential.secretHash, 'hex'); const expected = Buffer.from(hashPartnerSecret(presentedSecret), 'hex')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
  return { partnerId: credential.partnerId, clientId: credential.clientId, environment: credential.environment, scopes: credential.scopes }
}
export function requirePartnerScope(principal: PartnerPrincipal, scope: PartnerScope): void {
  if (!principal.scopes.includes(scope)) throw Object.assign(new Error('Partner credential lacks the required scope.'), { code: 'INSUFFICIENT_SCOPE', statusCode: 403 })
}
export function partnerTenantWhere<T extends object>(principal: PartnerPrincipal, where: T): T & { partnerId: string } { return { ...where, partnerId: principal.partnerId } }

export class PartnerRateLimiter {
  private readonly buckets = new Map<string, { startedAt: number; count: number }>()
  constructor(private readonly limit: number, private readonly windowMs: number) { if (!Number.isInteger(limit) || limit < 1 || windowMs < 1) throw new Error('Invalid rate limit.') }
  consume(partnerId: string, environment: PartnerEnvironment, now = Date.now()): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const key = `${environment}:${partnerId}`; const current = this.buckets.get(key)
    const bucket = !current || now - current.startedAt >= this.windowMs ? { startedAt: now, count: 0 } : current
    if (bucket.count >= this.limit) return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((bucket.startedAt + this.windowMs - now) / 1000)) }
    bucket.count += 1; this.buckets.set(key, bucket)
    return { allowed: true, remaining: this.limit - bucket.count, retryAfterSeconds: 0 }
  }
}

export type EventReceipt = { partnerId: string; environment: PartnerEnvironment; eventId: string; payloadHash: string; requestId: string; receivedAt: string }
export type IngestResult = { status: 'ACCEPTED' | 'DUPLICATE'; receipt: EventReceipt }
export class PartnerEventInbox {
  private readonly events = new Map<string, EventReceipt>()
  ingest(principal: PartnerPrincipal, requestId: string, input: unknown, now = new Date()): IngestResult {
    requirePartnerScope(principal, 'mobility.events:write')
    const event = normalizedRideEventSchema.parse(input)
    const key = `${principal.environment}:${principal.partnerId}:${event.eventId}`
    const payloadHash = createHash('sha256').update(JSON.stringify(event)).digest('hex')
    const existing = this.events.get(key)
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw Object.assign(new Error('Event ID was already used with a different payload.'), { code: 'EVENT_ID_REUSE', statusCode: 409 })
      return { status: 'DUPLICATE', receipt: existing }
    }
    const receipt = { partnerId: principal.partnerId, environment: principal.environment, eventId: event.eventId, payloadHash, requestId, receivedAt: now.toISOString() }
    this.events.set(key, receipt)
    return { status: 'ACCEPTED', receipt }
  }
}

export type WebhookEnvelope = { id: string; type: string; createdAt: string; data: Record<string, unknown> }
export function signPartnerWebhook(secret: string, timestampSeconds: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex')
}
export function verifyPartnerWebhook(secret: string, timestampSeconds: number, body: string, signature: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): boolean {
  if (!Number.isInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds || !/^[a-f0-9]{64}$/.test(signature)) return false
  const expected = Buffer.from(signPartnerWebhook(secret, timestampSeconds, body), 'hex'); const received = Buffer.from(signature, 'hex')
  return expected.length === received.length && timingSafeEqual(expected, received)
}
export function webhookDeliveryKey(partnerId: string, environment: PartnerEnvironment, eventId: string) { return `${environment}:${partnerId}:${eventId}` }
