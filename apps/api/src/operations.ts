import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from './prisma.js'
import { requirePermission, response } from './http.js'
import { config } from './config.js'
import { getDisplayConnectivity, isVerifiedCurrentPlayback } from './domain/display-health.js'

const safe = (data: unknown) => JSON.parse(JSON.stringify(data,(_,v)=>typeof v==='bigint'?v.toString():v))
export function registerOperations(app: FastifyInstance) {
 app.get('/api/admin/scheduler', async (request,reply) => {
  await requirePermission(request,'operations:write')
  const [screens,groups,routes,depots,vehicles] = await Promise.all([
   prisma.display.findMany({select:{id:true,name:true,state:true,vehicleId:true},take:1000}),
   prisma.screenGroup.findMany({include:{members:true}}),prisma.route.findMany(),prisma.depot.findMany(),
   prisma.vehicle.findMany({select:{id:true,registrationNumber:true,type:true,city:true,routeId:true,depotId:true}})
  ])
  // Kept as a compatibility data route for screen-group administration. No
  // scheduling rules or date-window campaign data are returned here.
  return reply.send(response(request,safe({schedules:[],campaigns:[],screens,groups,routes,depots,vehicles})))
 })
 app.post('/api/admin/screen-groups',async(request,reply)=>{
  const actor=await requirePermission(request,'operations:write')
  const input=z.object({id:z.string().uuid().optional(),name:z.string().trim().min(1).max(120),screenIds:z.array(z.string().uuid()).max(1000)}).parse(request.body)
  const result=await prisma.$transaction(async tx=>{
   const group=input.id ? await tx.screenGroup.update({where:{id:input.id},data:{name:input.name}}) : await tx.screenGroup.create({data:{name:input.name}})
   await tx.screenGroupMember.deleteMany({where:{groupId:group.id}})
   await tx.screenGroupMember.createMany({data:[...new Set(input.screenIds)].map(displayId=>({groupId:group.id,displayId}))})
   await tx.auditLog.create({data:{actorId:actor.userId,actorRole:actor.role,action:'SCREEN_GROUP_UPDATED',entityType:'ScreenGroup',entityId:group.id,after:input,requestId:request.id}})
   return group
  });return reply.send(response(request,result))
 })
 app.get('/api/admin/overview',async(request,reply)=>{
  await requirePermission(request,'admin:read')
  const now=new Date(); const india=new Date(now.getTime()+330*60000); const today=new Date(india.toISOString().slice(0,10)+'T00:00:00+05:30')
  const [screens,active,legacyScheduled,pending,creatives,plays,failedCommands]=await Promise.all([
   prisma.display.findMany({where:{state:{notIn:['DELETED','DISABLED']}},select:{lastHeartbeatAt:true,currentPlaybackState:true,currentCampaignId:true,currentCreativeId:true,currentPlaybackStartedAt:true,proofs:{where:{status:'VALID',playbackCompleted:true},orderBy:{playbackStartedAt:'desc'},take:1,select:{campaignId:true,creativeId:true,playbackStartedAt:true,playbackCompleted:true,status:true}}}}),prisma.campaign.count({where:{status:'ACTIVE'}}),prisma.campaign.count({where:{status:'SCHEDULED'}}),prisma.campaign.count({where:{status:{in:['PENDING_REVIEW','CAMPAIGN_PENDING_REVIEW']}}}),prisma.creative.count({where:{status:'PENDING_REVIEW'}}),prisma.proofOfPlay.count({where:{playbackStartedAt:{gte:today},playbackCompleted:true}}),prisma.displayCommand.count({where:{commandType:{in:['SYNC_MANIFEST','REFRESH_MANIFEST']},status:'FAILED'}})
  ])
  const online=screens.filter(s=>getDisplayConnectivity(s.lastHeartbeatAt??undefined,now,config.heartbeatOnlineSeconds,config.heartbeatDegradedSeconds)==='ONLINE')
  const playing=online.filter(s=>isVerifiedCurrentPlayback({lastHeartbeatAt:s.lastHeartbeatAt,currentCampaignId:s.currentCampaignId,currentCreativeId:s.currentCreativeId,currentPlaybackStartedAt:s.currentPlaybackStartedAt,currentPlaybackState:s.currentPlaybackState,proof:s.proofs[0]},now,config.heartbeatOnlineSeconds*1000)).length
  return reply.send(response(request,{total:screens.length,online:online.length,offline:screens.length-online.length,playing,idle:online.filter(s=>['IDLE','READY'].includes(s.currentPlaybackState??'')).length,errors:screens.filter(s=>['ERROR','FAILED'].includes(s.currentPlaybackState??'')).length,activeCampaigns:active,legacyScheduledCampaigns:legacyScheduled,pendingCampaigns:pending,pendingCreatives:creatives,playsToday:plays,manifestFailures:failedCommands}))
 })
 app.get('/api/admin/audit-log',async(request,reply)=>{
  await requirePermission(request,'operations:write');const q=z.object({skip:z.coerce.number().int().min(0).max(100000).default(0),entityId:z.string().optional()}).parse(request.query)
  return reply.send(response(request,await prisma.auditLog.findMany({where:{entityId:q.entityId},select:{id:true,createdAt:true,action:true,entityType:true,entityId:true,actorRole:true},orderBy:{createdAt:'desc'},take:50,skip:q.skip})))
 })
}
