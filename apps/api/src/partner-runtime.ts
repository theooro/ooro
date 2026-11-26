import type { FastifyInstance, FastifyRequest } from 'fastify'
import { createHash, randomBytes, randomUUID, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto'
import { lookup as systemLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import https, { type RequestOptions } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { SignJWT, jwtVerify } from 'jose'
import { z } from 'zod'
import { prisma } from './prisma.js'
import { ApiError } from './errors.js'
import { config } from './config.js'
import { requireRoles } from './http.js'
import { normalizedRideEventSchema, PARTNER_SCOPES, type PartnerScope, type PartnerEnvironment } from './domain/partner-integration.js'

const env = (): PartnerEnvironment => {
  const value = process.env.OORO_PARTNER_ENVIRONMENT?.toUpperCase()
  if (value === 'SANDBOX' || value === 'STAGING' || value === 'PRODUCTION') return value
  return 'PRODUCTION'
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const jwtKey = () => createHash('sha256').update(config.jwtSecret).update(':partner-oauth-v1').digest()
const tokenSchema=z.object({grant_type:z.literal('client_credentials'),scope:z.string().optional()}).strict()
const safeHashEqual=(a:string,b:string)=>{const x=Buffer.from(a,'hex'),y=Buffer.from(b,'hex');return x.length===y.length&&timingSafeEqual(x,y)}
const safeString=(value:unknown,max=128)=>typeof value==='string'?value.slice(0,max):''
const canonicalJson=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonicalJson).join(',')}]`:value&&typeof value==='object'?`{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`:JSON.stringify(value)
const encryptionKey=()=>createHash('sha256').update(config.documentStorageKey).update(':partner-webhook-v1').digest()
const encrypt=(value:string)=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv),data=Buffer.concat([cipher.update(value),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url')}
const decrypt=(value:string)=>{const bytes=Buffer.from(value,'base64url'),decipher=createDecipheriv('aes-256-gcm',encryptionKey(),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString()}
const newSecret=(environment:string)=>`ooro_${environment.toLowerCase()}_${randomBytes(32).toString('base64url')}`
const adminRole=['ADMIN','SUPER_ADMIN']
const PARTNER_WEBHOOK_EVENTS=['RIDE_REQUESTED','RIDE_ACCEPTED','RIDE_ACTIVE','RIDE_CANCELLED','RIDE_COMPLETED','campaign.submission.updated'] as const

type ResolvedPartnerWebhookAddress = { address: string; family: 4 | 6 }
export type PartnerWebhookTransportRequest = {
  url: string
  body: string
  headers: Record<string, string>
  pinnedAddress: ResolvedPartnerWebhookAddress
  timeoutMs: number
  maxResponseBytes: number
}
export type PartnerWebhookDependencies = {
  resolve: (hostname: string) => Promise<ResolvedPartnerWebhookAddress[]>
  transport: (request: PartnerWebhookTransportRequest, signal: AbortSignal) => Promise<{ status: number; body: AsyncIterable<Uint8Array> }>
  clock: {
    now: () => Date
    setTimeout: typeof setTimeout
    clearTimeout: typeof clearTimeout
  }
  retryDelayMs: (attempt: number) => number
}

export function isPartnerWebhookAddressAllowed(address:string):boolean {
  if(isIP(address)===4){const octets=address.split('.').map(Number),[a=0,b=0]=octets
    return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19))||address==='168.63.129.16')
  }
  const ip=address.toLowerCase().split('%')[0]??address.toLowerCase()
  return !(ip==='::'||ip==='::1'||ip.startsWith('fc')||ip.startsWith('fd')||ip.startsWith('fe8')||ip.startsWith('fe9')||ip.startsWith('fea')||ip.startsWith('feb')||ip.startsWith('ff')||ip.startsWith('::ffff:'))
}
const defaultPartnerWebhookDependencies: PartnerWebhookDependencies = {
  resolve: async hostname => (await systemLookup(hostname, { all: true, verbatim: true })).map(item => ({ address: item.address, family: item.family as 4 | 6 })),
  transport: sendPinnedHttps,
  clock: { now: () => new Date(), setTimeout, clearTimeout },
  retryDelayMs: attempt => Math.min(3_600_000, 5_000 * 2 ** Math.min(10, attempt - 1)),
}

async function sendPinnedHttps(request: PartnerWebhookTransportRequest, signal: AbortSignal): Promise<{ status: number; body: AsyncIterable<Uint8Array> }> {
  const url = new URL(request.url)
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const req = https.request(url, {
      method: 'POST',
      headers: { ...request.headers, 'content-length': String(Buffer.byteLength(request.body)) },
      timeout: request.timeoutMs,
      servername: url.hostname,
      lookup: pinnedPartnerWebhookLookup(request.pinnedAddress),
    }, (response: IncomingMessage) => {
      settled = true
      resolve({ status: response.statusCode ?? 0, body: response as AsyncIterable<Uint8Array> })
    })
    req.setTimeout(request.timeoutMs, () => req.destroy(new Error('DELIVERY_TIMEOUT')))
    req.on('error', error => fail(error.message === 'socket hang up' && signal.aborted ? new Error('DELIVERY_TIMEOUT') : error))
    signal.addEventListener('abort', () => req.destroy(new Error('DELIVERY_TIMEOUT')), { once: true })
    if (signal.aborted) {
      req.destroy(new Error('DELIVERY_TIMEOUT'))
      return
    }
    req.end(request.body)
  })
}

export function pinnedPartnerWebhookLookup(address: ResolvedPartnerWebhookAddress): NonNullable<RequestOptions['lookup']> {
  return (_hostname, options, callback) => {
    if (options && typeof options === 'object' && 'all' in options && options.all) {
      (callback as (error: NodeJS.ErrnoException | null, addresses: ResolvedPartnerWebhookAddress[]) => void)(null, [address])
    } else {
      (callback as (error: NodeJS.ErrnoException | null, address: string, family: number) => void)(null, address.address, address.family)
    }
  }
}

export async function deliverPartnerWebhookRequest(
  urlText: string,
  body: string,
  headers: Record<string, string>,
  dependencies: PartnerWebhookDependencies = defaultPartnerWebhookDependencies,
  maxResponseBytes = 8192,
  timeoutMs = 5000,
): Promise<{ status: number; size: number }> {
  const url = new URL(urlText)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('ENDPOINT_REJECTED')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const literalFamily = isIP(hostname)
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await dependencies.resolve(hostname)
  if (!addresses.length || addresses.some(item => !isPartnerWebhookAddressAllowed(item.address))) throw new Error('ENDPOINT_REJECTED')
  const controller = new AbortController()
  const request: PartnerWebhookTransportRequest = {
    url: url.toString(), body, headers, pinnedAddress: addresses[0]!, timeoutMs, maxResponseBytes,
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, result?: { status: number; size: number }) => {
      if (settled) return
      settled = true
      dependencies.clock.clearTimeout(timer)
      if (error) reject(error)
      else resolve(result!)
    }
    const timer = dependencies.clock.setTimeout(() => {
      controller.abort()
      finish(new Error('DELIVERY_TIMEOUT'))
    }, timeoutMs)
    dependencies.transport(request, controller.signal).then(async response => {
      if (settled) return
      try {
        if (response.status >= 300 && response.status < 400) throw new Error('REDIRECT_REJECTED')
        let size = 0
        for await (const chunk of response.body) {
          size += chunk.byteLength
          if (size > maxResponseBytes) {
            controller.abort()
            throw new Error('RESPONSE_TOO_LARGE')
          }
        }
        finish(undefined, { status: response.status, size })
      } catch (error) {
        controller.abort()
        finish(error instanceof Error ? error : new Error('DELIVERY_FAILED'))
      }
    }, error => finish(error instanceof Error ? error : new Error('DELIVERY_FAILED')))
  })
}

export async function registerPartnerRuntime(app: FastifyInstance) {
 app.post('/oauth/token',async(request,reply)=>{
  const input=tokenSchema.safeParse(request.body); if(!input.success) throw new ApiError('INVALID_REQUEST','Use client_credentials grant.',400)
  const auth=request.headers.authorization; const match=typeof auth==='string'?/^Basic ([A-Za-z0-9+/=]+)$/.exec(auth):null
  if(!match) throw new ApiError('INVALID_CLIENT','Client authentication required.',401)
  let decoded=''; try{decoded=Buffer.from(match[1]!, 'base64').toString('utf8')}catch{}
  const split=decoded.indexOf(':'); if(split<1) throw new ApiError('INVALID_CLIENT','Client authentication failed.',401)
  const clientId=decoded.slice(0,split), secret=decoded.slice(split+1)
  const client=await prisma.partnerClientCredential.findUnique({where:{clientId},include:{partner:true}})
  if(!client||client.environment!==env()||client.partner.status!=='ACTIVE'||client.revokedAt||client.expiresAt&&client.expiresAt<=new Date()||!safeHashEqual(hash(secret),client.secretHash)) throw new ApiError('INVALID_CLIENT','Client authentication failed.',401)
  const granted=client.scopes.filter(scope=>PARTNER_SCOPES.includes(scope as PartnerScope)); const requested=input.data.scope?.split(/\s+/).filter(Boolean)
  if(requested?.some(scope=>!granted.includes(scope))) throw new ApiError('INVALID_SCOPE','Requested scope is not granted.',400)
  const scopes=requested??granted, now=Math.floor(Date.now()/1000), exp=now+Math.min(900,Math.max(60,config.accessTtlSeconds))
  const accessToken=await new SignJWT({partnerId:client.partnerId,clientId:client.clientId,environment:client.environment,scope:scopes.join(' ')}).setProtectedHeader({alg:'HS256',typ:'JWT'}).setIssuer('ooro-partner-api').setAudience(`ooro-partner-api:${client.environment}`).setIssuedAt(now).setExpirationTime(exp).sign(jwtKey())
  return reply.send({access_token:accessToken,token_type:'Bearer',expires_in:exp-now,scope:scopes.join(' '),requestId:request.id})
 })
 app.post('/api/admin/partners',async(request,reply)=>{const auth=await requireRoles(request,adminRole),input=z.object({name:z.string().trim().min(2).max(160)}).strict().parse(request.body),partner=await prisma.partnerOrganization.create({data:{name:input.name}});await prisma.auditLog.create({data:{actorId:auth.userId,actorRole:auth.role,action:'PARTNER_ORGANIZATION_CREATED',entityType:'PartnerOrganization',entityId:partner.id,after:{name:partner.name},requestId:request.id}});return reply.code(201).send({data:{id:partner.id,name:partner.name,status:partner.status},requestId:request.id})})
 app.get('/api/admin/partners',async(request,reply)=>{await requireRoles(request,adminRole);const partners=await prisma.partnerOrganization.findMany({orderBy:{createdAt:'desc'},select:{id:true,name:true,status:true,createdAt:true}});return reply.send({data:partners,requestId:request.id})})
 app.get('/api/admin/partners/submissions',async(request,reply)=>{await requireRoles(request,adminRole);const query=z.object({status:z.enum(['SUBMITTED','IN_REVIEW','REJECTED']).optional(),pageSize:z.coerce.number().int().min(1).max(100).default(50)}).parse(request.query),items=await prisma.partnerCampaignSubmission.findMany({where:{...(query.status?{status:query.status}:{})},select:{id:true,partnerId:true,environment:true,status:true,payload:true,createdAt:true},orderBy:{createdAt:'asc'},take:query.pageSize});return reply.send({data:items,requestId:request.id})})
 app.post('/api/admin/partners/submissions/:submissionId/review',async(request,reply)=>{const auth=await requireRoles(request,adminRole),{submissionId}=request.params as {submissionId:string},input=z.object({decision:z.enum(['IN_REVIEW','REJECTED'])}).strict().parse(request.body),current=await prisma.partnerCampaignSubmission.findUnique({where:{id:submissionId}});if(!current)throw new ApiError('PARTNER_SUBMISSION_NOT_FOUND','Partner submission was not found.',404);if(current.status==='REJECTED'||current.status==='APPROVED')throw new ApiError('PARTNER_SUBMISSION_STATE_CONFLICT','Submission is already in a terminal state.',409);if(input.decision==='IN_REVIEW'&&current.status!=='SUBMITTED')throw new ApiError('PARTNER_SUBMISSION_STATE_CONFLICT','Only submitted campaigns can enter review.',409);await prisma.$transaction(async tx=>{const changed=await tx.partnerCampaignSubmission.updateMany({where:{id:submissionId,status:current.status},data:{status:input.decision}});if(!changed.count)throw new ApiError('PARTNER_SUBMISSION_STATE_CONFLICT','Submission changed during review.',409);const eventId=randomUUID(),eventType='campaign.submission.updated',subscriptions=await tx.partnerWebhookSubscription.findMany({where:{partnerId:current.partnerId,environment:current.environment,active:true,eventTypes:{has:eventType}},select:{id:true}});if(subscriptions.length)await tx.partnerWebhookDelivery.createMany({data:subscriptions.map(subscription=>({partnerId:current.partnerId,subscriptionId:subscription.id,environment:current.environment,eventId,eventType,body:{id:eventId,type:eventType,createdAt:new Date().toISOString(),data:{submissionId,status:input.decision}}}))});await tx.auditLog.create({data:{actorId:auth.userId,actorRole:auth.role,action:`PARTNER_SUBMISSION_${input.decision}`,entityType:'PartnerCampaignSubmission',entityId:submissionId,before:{status:current.status},after:{status:input.decision},requestId:request.id}})});return reply.send({data:{id:submissionId,status:input.decision,campaignApprovalRequired:true,activationRequired:true},requestId:request.id})})
 app.post('/api/admin/partners/submissions/:submissionId/link-campaign',async(request,reply)=>{const auth=await requireRoles(request,adminRole),{submissionId}=request.params as {submissionId:string},input=z.object({campaignId:z.string().uuid()}).strict().parse(request.body),submission=await prisma.partnerCampaignSubmission.findUnique({where:{id:submissionId}});if(!submission||submission.status!=='IN_REVIEW'||submission.campaignId)throw new ApiError('PARTNER_SUBMISSION_STATE_CONFLICT','Only an unlinked submission in review can be linked.',409);const submissionPayload=z.object({creativeIds:z.array(z.string().uuid())}).passthrough().parse(submission.payload),campaign=await prisma.campaign.findUnique({where:{id:input.campaignId},include:{creatives:{select:{id:true,status:true,asset:{select:{active:true}}}},assignments:{where:{active:true},select:{id:true}}}});if(!campaign)throw new ApiError('CAMPAIGN_NOT_FOUND','Campaign was not found.',404);const linkedSubmission=await prisma.partnerCampaignSubmission.findFirst({where:{campaignId:campaign.id}});if(linkedSubmission)throw new ApiError('CAMPAIGN_ALREADY_LINKED','Campaign is already linked to a partner submission.',409);const actual=campaign.creatives.map(item=>item.id).sort(),expected=[...new Set(submissionPayload.creativeIds)].sort();if(campaign.status!=='DRAFT'||campaign.commercialFundingStatus!=='UNFUNDED'||campaign.assignments.length||campaign.creatives.some(item=>item.status!=='APPROVED'||item.asset?.active!==true)||JSON.stringify(actual)!==JSON.stringify(expected))throw new ApiError('CAMPAIGN_NOT_ELIGIBLE_FOR_SUBMISSION','Only a matching unfunded draft with approved active creatives and no active assignments can be linked.',409);const updated=await prisma.$transaction(async tx=>{const changed=await tx.partnerCampaignSubmission.updateMany({where:{id:submissionId,status:'IN_REVIEW',campaignId:null},data:{campaignId:campaign.id}});if(!changed.count)throw new ApiError('PARTNER_SUBMISSION_STATE_CONFLICT','Submission changed while linking.',409);const eventId=randomUUID(),eventType='campaign.submission.updated',subscriptions=await tx.partnerWebhookSubscription.findMany({where:{partnerId:submission.partnerId,environment:submission.environment,active:true,eventTypes:{has:eventType}},select:{id:true}});if(subscriptions.length)await tx.partnerWebhookDelivery.createMany({data:subscriptions.map(subscription=>({partnerId:submission.partnerId,subscriptionId:subscription.id,environment:submission.environment,eventId,eventType,body:{id:eventId,type:eventType,createdAt:new Date().toISOString(),data:{submissionId,campaignId:campaign.id,status:submission.status}}}))});await tx.auditLog.create({data:{actorId:auth.userId,actorRole:auth.role,action:'PARTNER_SUBMISSION_CAMPAIGN_LINKED',entityType:'PartnerCampaignSubmission',entityId:submissionId,before:{campaignId:null},after:{campaignId:campaign.id,campaignStatus:campaign.status,fundingStatus:campaign.commercialFundingStatus},requestId:request.id}});return tx.partnerCampaignSubmission.findUniqueOrThrow({where:{id:submissionId},select:{id:true,campaignId:true,status:true}})}).catch(error=>{if((error as {code?:string}).code==='P2002')throw new ApiError('CAMPAIGN_ALREADY_LINKED','Campaign is already linked to a partner submission.',409);throw error});return reply.send({data:{...updated,campaignApprovalRequired:true,fundingRequired:true,activationRequired:true},requestId:request.id})})
 app.post('/api/admin/partners/:partnerId/clients',async(request,reply)=>{
  const auth=await requireRoles(request,adminRole),params=request.params as {partnerId:string},body=z.object({environment:z.enum(['SANDBOX','STAGING','PRODUCTION']),scopes:z.array(z.enum(PARTNER_SCOPES)).min(1),expiresAt:z.string().datetime().optional()}).strict().parse(request.body)
  const partner=await prisma.partnerOrganization.findUnique({where:{id:params.partnerId}});if(!partner||partner.status!=='ACTIVE')throw new ApiError('PARTNER_NOT_FOUND','Active partner was not found.',404)
  const secret=newSecret(body.environment),clientId=`pc_${randomBytes(18).toString('hex')}`
  const client=await prisma.$transaction(async tx=>{const created=await tx.partnerClientCredential.create({data:{partnerId:partner.id,environment:body.environment,clientId,secretHash:hash(secret),scopes:body.scopes,expiresAt:body.expiresAt?new Date(body.expiresAt):null}});await tx.auditLog.create({data:{actorId:auth.userId,actorRole:auth.role,action:'PARTNER_CLIENT_CREATED',entityType:'PartnerClientCredential',entityId:created.id,after:{partnerId:partner.id,environment:body.environment,scopes:body.scopes},requestId:request.id}});return created})
  return reply.code(201).send({data:{id:client.id,clientId:client.clientId,partnerId:partner.id,environment:client.environment,scopes:client.scopes,secret},requestId:request.id})
 })
 app.post('/api/admin/partners/clients/:clientId/rotate',async(request,reply)=>{
  const auth=await requireRoles(request,adminRole),{clientId}=request.params as {clientId:string},old=await prisma.partnerClientCredential.findUnique({where:{clientId}});if(!old||old.revokedAt)throw new ApiError('CLIENT_NOT_FOUND','Active partner client was not found.',404)
  const secret=newSecret(old.environment),newClientId=`pc_${randomBytes(18).toString('hex')}`
  const rotated=await prisma.$transaction(async tx=>{const changed=await tx.partnerClientCredential.updateMany({where:{id:old.id,revokedAt:null},data:{revokedAt:new Date()}});if(changed.count!==1)throw new ApiError('CLIENT_STATE_CONFLICT','Partner client changed during rotation.',409);const client=await tx.partnerClientCredential.create({data:{partnerId:old.partnerId,environment:old.environment,clientId:newClientId,secretHash:hash(secret),scopes:old.scopes,rotatedFromId:old.id}});await tx.auditLog.create({data:{actorId:auth.userId,actorRole:auth.role,action:'PARTNER_CLIENT_ROTATED',entityType:'PartnerClientCredential',entityId:old.id,after:{replacementId:client.id,environment:old.environment},requestId:request.id}});return client})
  return reply.code(201).send({data:{id:rotated.id,clientId:rotated.clientId,partnerId:rotated.partnerId,environment:rotated.environment,scopes:rotated.scopes,secret},requestId:request.id})
 })
 app.post('/api/admin/partners/clients/:clientId/revoke',async(request,reply)=>{
  const auth=await requireRoles(request,adminRole),{clientId}=request.params as {clientId:string},client=await prisma.partnerClientCredential.findUnique({where:{clientId}});if(!client)throw new ApiError('CLIENT_NOT_FOUND','Partner client was not found.',404)
  await prisma.$transaction(async tx=>{await tx.partnerClientCredential.updateMany({where:{id:client.id,revokedAt:null},data:{revokedAt:new Date()}});await tx.auditLog.create({data:{actorId:auth.userId,actorRole:auth.role,action:'PARTNER_CLIENT_REVOKED',entityType:'PartnerClientCredential',entityId:client.id,after:{environment:client.environment},requestId:request.id}})})
  return reply.send({data:{id:client.id,revoked:true},requestId:request.id})
 })
 app.post('/api/admin/partners/webhooks/deliver-due',async(request,reply)=>{const auth=await requireRoles(request,adminRole),result=await deliverDuePartnerWebhooks();await prisma.auditLog.create({data:{actorId:auth.userId,actorRole:auth.role,action:'PARTNER_WEBHOOK_BATCH_DISPATCHED',entityType:'PartnerWebhookDelivery',entityId:'outbox-batch',after:{processed:result.processed},requestId:request.id}});return reply.send({data:result,requestId:request.id})})
 app.addHook('preHandler',async(request)=>{
  if(!request.url.startsWith('/partner/v1/')) return
  const header=request.headers.authorization; const match=typeof header==='string'?/^Bearer ([A-Za-z0-9._-]+)$/.exec(header):null
  if(!match) throw new ApiError('UNAUTHORIZED','Partner bearer token required.',401)
  let claims:Record<string, unknown>; try{claims=(await jwtVerify(match[1]!,jwtKey(),{issuer:'ooro-partner-api',audience:`ooro-partner-api:${env()}`})).payload}catch{throw new ApiError('UNAUTHORIZED','Partner token is invalid or expired.',401)}
  if(claims.environment!==env()||typeof claims.partnerId!=='string'||typeof claims.clientId!=='string') throw new ApiError('UNAUTHORIZED','Partner token environment is invalid.',401)
  const client=await prisma.partnerClientCredential.findUnique({where:{clientId:claims.clientId},include:{partner:true}})
  if(!client||client.revokedAt||client.environment!==env()||client.partnerId!==claims.partnerId||client.partner.status!=='ACTIVE') throw new ApiError('UNAUTHORIZED','Partner client is revoked or unavailable.',401)
  const tokenScopes=String(claims.scope??'').split(' ').filter((scope):scope is PartnerScope=>PARTNER_SCOPES.includes(scope as PartnerScope))
  if(tokenScopes.some(scope=>!client.scopes.includes(scope)))throw new ApiError('UNAUTHORIZED','Partner token scopes are no longer granted.',401)
  request.partner={partnerId:client.partnerId,clientId:client.clientId,environment:client.environment as PartnerEnvironment,scopes:tokenScopes}
 })
 app.post('/partner/v1/mobility/events',async(request,reply)=>{
  const p=request.partner; if(!p) throw new ApiError('UNAUTHORIZED','Partner token required.',401); if(!p.scopes.includes('mobility.events:write')) throw new ApiError('INSUFFICIENT_SCOPE','Required partner scope is missing.',403)
  const limit=await prisma.partnerEventReceipt.count({where:{partnerId:p.partnerId,environment:p.environment,receivedAt:{gte:new Date(Date.now()-60_000)}}}); if(limit>=120) throw new ApiError('RATE_LIMITED','Partner event rate limit exceeded.',429)
  const parsed=normalizedRideEventSchema.safeParse(request.body); if(!parsed.success) throw new ApiError('VALIDATION_ERROR','Mobility event is invalid or contains disallowed data.',422)
  const idempotency=safeString(request.headers['idempotency-key']); if(idempotency.length<16||idempotency.length>128) throw new ApiError('IDEMPOTENCY_KEY_REQUIRED','A bounded Idempotency-Key header is required.',400)
  const event=parsed.data, payloadHash=hash(JSON.stringify(event)), keyHash=hash(`${p.partnerId}:${p.environment}:${idempotency}`)
  const idemScope=`partner-event:${p.partnerId}:${p.environment}:${payloadHash}`
  const idem=await prisma.idempotencyKey.findUnique({where:{key:keyHash}})
  if(idem){if(idem.scope!==idemScope)throw new ApiError('IDEMPOTENCY_CONFLICT','Idempotency-Key was already used with a different payload or partner.',409);return reply.code(Number((idem.response as {httpStatus?:number}).httpStatus??200)).send((idem.response as {body?:unknown}).body)}
  const existing=await prisma.partnerEventReceipt.findUnique({where:{partnerId_environment_eventId:{partnerId:p.partnerId,environment:p.environment,eventId:event.eventId}}})
  if(existing&&existing.payloadHash!==payloadHash)throw new ApiError('EVENT_ID_REUSE','Event ID was already used with a different payload.',409)
  const httpStatus=existing?200:202
  const body={data:{status:existing?'DUPLICATE':'ACCEPTED',eventId:event.eventId},requestId:request.id}
  const stored={httpStatus,body}
  try{await prisma.$transaction(async tx=>{
    if(!existing) {
      await tx.partnerEventReceipt.create({data:{partnerId:p.partnerId,environment:p.environment,eventId:event.eventId,payloadHash,eventType:event.eventType,occurredAt:new Date(event.occurredAt),requestId:request.id}})
      const subscriptions=await tx.partnerWebhookSubscription.findMany({where:{partnerId:p.partnerId,environment:p.environment,active:true,eventTypes:{has:event.eventType}},select:{id:true}})
      if(subscriptions.length) await tx.partnerWebhookDelivery.createMany({data:subscriptions.map(subscription=>({partnerId:p.partnerId,subscriptionId:subscription.id,environment:p.environment,eventId:event.eventId,eventType:event.eventType,body:{id:event.eventId,type:event.eventType,createdAt:new Date().toISOString(),data:{occurredAt:event.occurredAt,context:event.context}}}))})
    }
    await tx.idempotencyKey.create({data:{key:keyHash,scope:idemScope,response:stored,expiresAt:new Date(Date.now()+7*24*60*60_000)}})
    if(!existing) await tx.auditLog.create({data:{actorRole:'PARTNER',action:'PARTNER_MOBILITY_EVENT_ACCEPTED',entityType:'PartnerEventReceipt',entityId:event.eventId,after:{partnerId:p.partnerId,environment:p.environment,eventType:event.eventType,requestId:request.id}}})
  })}catch(error){
    if((error as {code?:string}).code==='P2002'){
      const winner=await prisma.idempotencyKey.findUnique({where:{key:keyHash}})
      if(winner){if(winner.scope!==idemScope)throw new ApiError('IDEMPOTENCY_CONFLICT','Idempotency-Key was already used with a different payload or partner.',409);return reply.code(Number((winner.response as {httpStatus?:number}).httpStatus??200)).send((winner.response as {body?:unknown}).body)}
      const duplicate=await prisma.partnerEventReceipt.findUnique({where:{partnerId_environment_eventId:{partnerId:p.partnerId,environment:p.environment,eventId:event.eventId}}})
      if(duplicate?.payloadHash===payloadHash){
        const duplicateBody={data:{status:'DUPLICATE',eventId:event.eventId},requestId:request.id}
        try{await prisma.idempotencyKey.create({data:{key:keyHash,scope:idemScope,response:{httpStatus:200,body:duplicateBody},expiresAt:new Date(Date.now()+7*24*60*60_000)}})}catch(insertError){
          if((insertError as {code?:string}).code!=='P2002')throw insertError
          const winner=await prisma.idempotencyKey.findUnique({where:{key:keyHash}})
          if(winner){if(winner.scope!==idemScope)throw new ApiError('IDEMPOTENCY_CONFLICT','Idempotency-Key was already used with a different payload or partner.',409);return reply.code(Number((winner.response as {httpStatus?:number}).httpStatus??200)).send((winner.response as {body?:unknown}).body)}
        }
        return reply.code(200).send(duplicateBody)
      }
      if(duplicate) throw new ApiError('EVENT_ID_REUSE','Event ID was already used with a different payload.',409)
    }
    throw error
  }
  return reply.code(httpStatus).send(body)
 })
 const scoped=(request:FastifyRequest,scope:PartnerScope)=>{const p=request.partner;if(!p)throw new ApiError('UNAUTHORIZED','Partner token required.',401);if(!p.scopes.includes(scope))throw new ApiError('INSUFFICIENT_SCOPE','Required partner scope is missing.',403);return p}
 app.post('/partner/v1/campaign-submissions',async(request,reply)=>{const p=scoped(request,'campaigns:submit'),input=z.object({name:z.string().trim().min(1).max(120),objective:z.string().max(1000).optional(),budgetCents:z.number().int().positive().max(100_000_000),serviceArea:z.string().trim().min(1).max(80),startsAt:z.string().datetime(),endsAt:z.string().datetime(),creativeIds:z.array(z.string().uuid()).min(1).max(20)}).strict().parse(request.body);if(Date.parse(input.endsAt)<=Date.parse(input.startsAt))throw new ApiError('INVALID_CAMPAIGN_WINDOW','Campaign end must be after start.',422);const approved=await prisma.creative.findMany({where:{id:{in:input.creativeIds},status:'APPROVED',asset:{is:{active:true}}},select:{id:true}});if(approved.length!==new Set(input.creativeIds).size)throw new ApiError('CREATIVES_NOT_ELIGIBLE','Every submitted creative must be an approved active asset.',422);const key=safeString(request.headers['idempotency-key']);if(key.length<16||key.length>128)throw new ApiError('IDEMPOTENCY_KEY_REQUIRED','A bounded Idempotency-Key header is required.',400);const payload=input as unknown as object,unique={partnerId_environment_idempotencyKey:{partnerId:p.partnerId,environment:p.environment,idempotencyKey:key}},old=await prisma.partnerCampaignSubmission.findUnique({where:unique});if(old){if(canonicalJson(old.payload)!==canonicalJson(payload))throw new ApiError('IDEMPOTENCY_CONFLICT','Idempotency-Key was already used with another submission.',409);return reply.code(200).send({data:{id:old.id,status:old.status},requestId:request.id})}try{const item=await prisma.partnerCampaignSubmission.create({data:{partnerId:p.partnerId,environment:p.environment,idempotencyKey:key,payload:payload as never,status:'SUBMITTED'}});return reply.code(202).send({data:{id:item.id,status:item.status,approvalRequired:true,activationRequired:true},requestId:request.id})}catch(error){if((error as {code?:string}).code!=='P2002')throw error;const raced=await prisma.partnerCampaignSubmission.findUnique({where:unique});if(!raced)throw error;if(canonicalJson(raced.payload)!==canonicalJson(payload))throw new ApiError('IDEMPOTENCY_CONFLICT','Idempotency-Key was already used with another submission.',409);return reply.code(200).send({data:{id:raced.id,status:raced.status},requestId:request.id})}})
 app.get('/partner/v1/campaigns/:submissionId',async(request,reply)=>{const p=scoped(request,'campaigns:read'),{submissionId}=request.params as {submissionId:string},item=await prisma.partnerCampaignSubmission.findFirst({where:{id:submissionId,partnerId:p.partnerId,environment:p.environment},select:{id:true,status:true,campaignId:true,createdAt:true}});if(!item)throw new ApiError('CAMPAIGN_NOT_FOUND','Partner campaign submission was not found.',404);return reply.send({data:item,requestId:request.id})})
 app.get('/partner/v1/inventory/summary',async(request,reply)=>{const p=scoped(request,'inventory:read'),row=await prisma.screenInventoryConfig.aggregate({where:{commercialEnabled:true,screen:{pairingStatus:'PAIRED',lastHeartbeatAt:{gte:new Date(Date.now()-5*60_000)}}},_sum:{commercialSlots:true},_count:{_all:true}});return reply.send({data:{environment:p.environment,onlineScreens:row._count._all,commercialSlots:row._sum.commercialSlots??0,granularity:'global'},requestId:request.id})})
 app.get('/partner/v1/delivery/summary',async(request,reply)=>{const p=scoped(request,'delivery:read'),rows=await prisma.partnerCampaignSubmission.findMany({where:{partnerId:p.partnerId,environment:p.environment,campaignId:{not:null}},select:{campaignId:true}}),ids=rows.flatMap(row=>row.campaignId?[row.campaignId]:[]),counts=ids.length?await prisma.proofOfPlay.groupBy({by:['status'],where:{campaignId:{in:ids}},_count:{_all:true}}):[];return reply.send({data:{campaignCount:ids.length,proofs:counts.map(row=>({status:row.status,count:row._count._all}))},requestId:request.id})})
 app.get('/partner/v1/analytics/qr',async(request,reply)=>{const p=scoped(request,'analytics.qr:read'),rows=await prisma.partnerCampaignSubmission.findMany({where:{partnerId:p.partnerId,environment:p.environment,campaignId:{not:null}},select:{campaignId:true}}),ids=rows.flatMap(row=>row.campaignId?[row.campaignId]:[]),scans=ids.length?await prisma.qrScan.count({where:{campaignId:{in:ids}}}):0;return reply.send({data:{campaignCount:ids.length,scans},requestId:request.id})})
 app.get('/partner/v1/webhook-subscriptions',async(request,reply)=>{const p=scoped(request,'webhooks:manage'),items=await prisma.partnerWebhookSubscription.findMany({where:{partnerId:p.partnerId,environment:p.environment},select:{id:true,endpointUrl:true,eventTypes:true,active:true,createdAt:true,updatedAt:true}});return reply.send({data:items,requestId:request.id})})
 app.delete('/partner/v1/webhook-subscriptions/:subscriptionId',async(request,reply)=>{const p=scoped(request,'webhooks:manage'),{subscriptionId}=request.params as {subscriptionId:string},updated=await prisma.partnerWebhookSubscription.updateMany({where:{id:subscriptionId,partnerId:p.partnerId,environment:p.environment,active:true},data:{active:false}});if(!updated.count)throw new ApiError('SUBSCRIPTION_NOT_FOUND','Webhook subscription was not found.',404);return reply.send({data:{id:subscriptionId,active:false},requestId:request.id})})
 app.post('/partner/v1/webhook-subscriptions',async(request,reply)=>{const p=scoped(request,'webhooks:manage'),input=z.object({endpointUrl:z.string().url().max(2048),eventTypes:z.array(z.enum(PARTNER_WEBHOOK_EVENTS)).min(1).max(PARTNER_WEBHOOK_EVENTS.length)}).strict().parse(request.body),url=new URL(input.endpointUrl);if(url.protocol!=='https:'||url.username||url.password)throw new ApiError('WEBHOOK_ENDPOINT_REJECTED','Webhook endpoint must be public HTTPS.',422);try{const host=url.hostname.replace(/^\[|\]$/g,'');if(isIP(host)&&!isPartnerWebhookAddressAllowed(host))throw new Error('blocked');const resolved=isIP(host)?[{address:host,family:isIP(host) as 4|6}]:await defaultPartnerWebhookDependencies.resolve(url.hostname);if(!resolved.length||resolved.some(item=>!isPartnerWebhookAddressAllowed(item.address)))throw new Error('blocked')}catch{throw new ApiError('WEBHOOK_ENDPOINT_REJECTED','Webhook endpoint resolves to a disallowed address.',422)}const secret=randomBytes(32).toString('base64url'),item=await prisma.partnerWebhookSubscription.create({data:{partnerId:p.partnerId,environment:p.environment,endpointUrl:input.endpointUrl,eventTypes:input.eventTypes,encryptedSecret:encrypt(secret)}});return reply.code(201).send({data:{id:item.id,endpointUrl:item.endpointUrl,eventTypes:item.eventTypes,signingSecret:secret},requestId:request.id})})
 app.post('/partner/v1/webhook-deliveries/:eventId/retry',async(request,reply)=>{const p=scoped(request,'webhooks:manage'),{eventId}=request.params as {eventId:string},item=await prisma.partnerWebhookDelivery.findFirst({where:{partnerId:p.partnerId,environment:p.environment,eventId,status:'FAILED',replayCount:{lt:3}}});if(!item)throw new ApiError('DELIVERY_NOT_REPLAYABLE','No failed delivery is available for this partner/event or replay limit was reached.',404);const updated=await prisma.$transaction(async tx=>{const changed=await tx.partnerWebhookDelivery.updateMany({where:{id:item.id,status:'FAILED',replayCount:{lt:3}},data:{status:'PENDING',attempts:0,replayCount:{increment:1},claimedAt:null,nextAttemptAt:new Date(),lastErrorCode:null}});if(!changed.count)throw new ApiError('DELIVERY_NOT_REPLAYABLE','Delivery changed or replay limit was reached.',409);const delivery=await tx.partnerWebhookDelivery.findUniqueOrThrow({where:{id:item.id}});await tx.auditLog.create({data:{actorRole:'PARTNER',action:'PARTNER_WEBHOOK_REPLAY_REQUESTED',entityType:'PartnerWebhookDelivery',entityId:item.id,after:{partnerId:p.partnerId,environment:p.environment,eventId,replayCount:delivery.replayCount,requestId:request.id}}});return delivery});return reply.code(202).send({data:{id:updated.id,status:updated.status,replayCount:updated.replayCount},requestId:request.id})})
 app.get('/partner/v1/webhook-deliveries',async(request,reply)=>{const p=scoped(request,'webhooks:manage'),query=z.object({pageSize:z.coerce.number().int().min(1).max(100).default(25)}).parse(request.query),items=await prisma.partnerWebhookDelivery.findMany({where:{partnerId:p.partnerId,environment:p.environment},select:{id:true,eventId:true,eventType:true,status:true,attempts:true,nextAttemptAt:true,lastStatusCode:true,lastErrorCode:true,deliveredAt:true,createdAt:true},orderBy:{createdAt:'desc'},take:query.pageSize});return reply.send({data:items,requestId:request.id})})
}

export async function deliverDuePartnerWebhooks(limit=50,dependencies:PartnerWebhookDependencies=defaultPartnerWebhookDependencies) {
 const now=dependencies.clock.now(),stale=new Date(now.getTime()-120_000),rows=await prisma.partnerWebhookDelivery.findMany({where:{attempts:{lt:8},subscription:{active:true},OR:[{status:'PENDING',nextAttemptAt:{lte:now}},{status:'PROCESSING',claimedAt:{lt:stale}}]},include:{subscription:true},take:Math.min(100,Math.max(1,limit)),orderBy:{nextAttemptAt:'asc'}});let processed=0
 for(const row of rows){const claimAt=dependencies.clock.now(),claim=await prisma.partnerWebhookDelivery.updateMany({where:{id:row.id,status:row.status,...(row.status==='PROCESSING'?{claimedAt:row.claimedAt}:{nextAttemptAt:{lte:now}})},data:{status:'PROCESSING',claimedAt:claimAt}});if(claim.count!==1)continue;processed++;const timestamp=Math.floor(dependencies.clock.now().getTime()/1000),body=JSON.stringify(row.body),signature=createHmac('sha256',decrypt(row.subscription.encryptedSecret)).update(`${timestamp}.${body}`).digest('hex');try{const result=await deliverPartnerWebhookRequest(row.subscription.endpointUrl,body,{'content-type':'application/json','x-ooro-delivery-id':row.id,'x-ooro-signature':`t=${timestamp},v1=${signature}`},dependencies);if(result.status<200||result.status>=300)throw new Error(`HTTP_${result.status}`);await prisma.partnerWebhookDelivery.updateMany({where:{id:row.id,status:'PROCESSING',claimedAt:claimAt},data:{status:'DELIVERED',claimedAt:null,attempts:{increment:1},lastStatusCode:result.status,deliveredAt:new Date(),lastErrorCode:null}})}catch(error){const attempts=row.attempts+1,message=error instanceof Error?error.message:'',code=/^(ENDPOINT_REJECTED|REDIRECT_REJECTED|RESPONSE_TOO_LARGE|DELIVERY_TIMEOUT|HTTP_\d+)$/.test(message)?message:'DELIVERY_FAILED',statusCode=/^HTTP_(\d+)$/.exec(message)?.[1];await prisma.partnerWebhookDelivery.updateMany({where:{id:row.id,status:'PROCESSING',claimedAt:claimAt},data:{status:attempts>=8?'FAILED':'PENDING',claimedAt:null,attempts,lastStatusCode:statusCode?Number(statusCode):null,lastErrorCode:code,nextAttemptAt:new Date(dependencies.clock.now().getTime()+Math.max(0,Math.min(3_600_000,dependencies.retryDelayMs(attempts))))}})}}return{processed}
}
