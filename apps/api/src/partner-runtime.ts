import type { FastifyInstance } from 'fastify'
import { randomBytes, createHash, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { z } from 'zod'
import { prisma } from './prisma.js'
import { ApiError } from './errors.js'
import { config } from './config.js'
import { normalizedRideEventSchema, PARTNER_SCOPES, type PartnerScope } from './domain/partner-integration.js'

const env = (): 'SANDBOX'|'STAGING'|'PRODUCTION' => {
  const value = process.env.OORO_PARTNER_ENVIRONMENT
  if (value === 'sandbox' || value === 'SANDBOX') return 'SANDBOX'
  if (value === 'staging' || value === 'STAGING') return 'STAGING'
  return 'PRODUCTION'
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const jwtKey = () => createHash('sha256').update(config.jwtSecret).update(':partner-oauth-v1').digest()
const encryptionKey = () => createHash('sha256').update(config.documentStorageKey).update(':partner-webhook-v1').digest()
const encrypt = (value: string) => { const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv); const data=Buffer.concat([cipher.update(value),cipher.final()]); return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url') }
const decrypt = (value: string) => { const bytes=Buffer.from(value,'base64url'); const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),bytes.subarray(0,12)); decipher.setAuthTag(bytes.subarray(12,28)); return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString() }
const tokenSchema=z.object({grant_type:z.literal('client_credentials'),scope:z.string().optional()}).strict()
const safeString=(value:unknown,max=128)=>typeof value==='string'?value.slice(0,max):''

export async function registerPartnerRuntime(app: FastifyInstance) {
 app.post('/oauth/token',async(request,reply)=>{
  const input=tokenSchema.safeParse(request.body); if(!input.success) throw new ApiError('INVALID_REQUEST','Use client_credentials grant.',400)
  const auth=request.headers.authorization; const match=typeof auth==='string'?/^Basic ([A-Za-z0-9+/=]+)$/.exec(auth):null
  if(!match) throw new ApiError('INVALID_CLIENT','Client authentication required.',401)
  let decoded=''; try{decoded=Buffer.from(match[1]!, 'base64').toString('utf8')}catch{}
  const split=decoded.indexOf(':'); if(split<1) throw new ApiError('INVALID_CLIENT','Client authentication failed.',401)
  const clientId=decoded.slice(0,split), secret=decoded.slice(split+1)
  const client=await prisma.partnerClientCredential.findUnique({where:{clientId},include:{partner:true}})
  if(!client||client.environment!==env()||client.partner.status!=='ACTIVE'||client.revokedAt||client.expiresAt&&client.expiresAt<=new Date()||hash(secret)!==client.secretHash) throw new ApiError('INVALID_CLIENT','Client authentication failed.',401)
  const granted=client.scopes.filter(scope=>PARTNER_SCOPES.includes(scope as PartnerScope)); const requested=input.data.scope?.split(/\s+/).filter(Boolean)
  if(requested?.some(scope=>!granted.includes(scope))) throw new ApiError('INVALID_SCOPE','Requested scope is not granted.',400)
  const scopes=requested??granted, now=Math.floor(Date.now()/1000), exp=now+Math.min(900,Math.max(60,config.accessTtlSeconds))
  const accessToken=await new SignJWT({partnerId:client.partnerId,clientId:client.clientId,environment:client.environment,scope:scopes.join(' ')}).setProtectedHeader({alg:'HS256',typ:'JWT'}).setIssuer('ooro-partner-api').setAudience(`ooro-partner-api:${client.environment}`).setIssuedAt(now).setExpirationTime(exp).sign(jwtKey())
  return reply.send({access_token:accessToken,token_type:'Bearer',expires_in:exp-now,scope:scopes.join(' '),requestId:request.id})
 })
 app.addHook('preHandler',async(request)=>{
  if(!request.url.startsWith('/partner/v1/')) return
  const header=request.headers.authorization; const match=typeof header==='string'?/^Bearer ([A-Za-z0-9._-]+)$/.exec(header):null
  if(!match) throw new ApiError('UNAUTHORIZED','Partner bearer token required.',401)
  let claims:any; try{claims=(await jwtVerify(match[1]!,jwtKey(),{issuer:'ooro-partner-api',audience:`ooro-partner-api:${env()}`})).payload}catch{throw new ApiError('UNAUTHORIZED','Partner token is invalid or expired.',401)}
  if(claims.environment!==env()||typeof claims.partnerId!=='string'||typeof claims.clientId!=='string') throw new ApiError('UNAUTHORIZED','Partner token environment is invalid.',401)
  const client=await prisma.partnerClientCredential.findUnique({where:{clientId:claims.clientId},include:{partner:true}})
  if(!client||client.revokedAt||client.environment!==env()||client.partnerId!==claims.partnerId||client.partner.status!=='ACTIVE') throw new ApiError('UNAUTHORIZED','Partner client is revoked or unavailable.',401)
  ;(request as any).partner={partnerId:client.partnerId,clientId:client.clientId,environment:client.environment,scopes:String(claims.scope??'').split(' ')}
 })
 app.post('/partner/v1/mobility/events',async(request,reply)=>{
  const p=(request as any).partner as {partnerId:string;environment:string;scopes:string[]}; if(!p.scopes.includes('mobility.events:write')) throw new ApiError('INSUFFICIENT_SCOPE','Required partner scope is missing.',403)
  const limit=await prisma.partnerEventReceipt.count({where:{partnerId:p.partnerId,environment:p.environment,receivedAt:{gte:new Date(Date.now()-60_000)}}}); if(limit>=120) throw new ApiError('RATE_LIMITED','Partner event rate limit exceeded.',429)
  const parsed=normalizedRideEventSchema.safeParse(request.body); if(!parsed.success) throw new ApiError('VALIDATION_ERROR','Mobility event is invalid or contains disallowed data.',422)
  const idempotency=safeString(request.headers['idempotency-key']); if(idempotency.length<16||idempotency.length>128) throw new ApiError('IDEMPOTENCY_KEY_REQUIRED','A bounded Idempotency-Key header is required.',400)
  const event=parsed.data, payloadHash=hash(JSON.stringify(event))
  const existing=await prisma.partnerEventReceipt.findUnique({where:{partnerId_environment_eventId:{partnerId:p.partnerId,environment:p.environment,eventId:event.eventId}}})
  if(existing){if(existing.payloadHash!==payloadHash)throw new ApiError('EVENT_ID_REUSE','Event ID was already used with a different payload.',409);return reply.code(200).send({data:{status:'DUPLICATE',eventId:event.eventId},requestId:request.id})}
  try{await prisma.$transaction(async tx=>{await tx.partnerEventReceipt.create({data:{partnerId:p.partnerId,environment:p.environment,eventId:event.eventId,payloadHash,eventType:event.eventType,occurredAt:new Date(event.occurredAt),requestId:request.id}});await tx.auditLog.create({data:{actorRole:'PARTNER',action:'PARTNER_MOBILITY_EVENT_ACCEPTED',entityType:'PartnerEventReceipt',entityId:event.eventId,after:{partnerId:p.partnerId,environment:p.environment,eventType:event.eventType,requestId:request.id}}})})}catch(error){if((error as {code?:string}).code==='P2002')return reply.code(200).send({data:{status:'DUPLICATE',eventId:event.eventId},requestId:request.id});throw error}
  return reply.code(202).send({data:{status:'ACCEPTED',eventId:event.eventId},requestId:request.id})
 })
 // No downstream ride/proof/campaign effects occur from partner submitted events.
 // Reserved campaign, inventory, delivery, analytics and webhook endpoints stay unavailable until scoped services land.
}
