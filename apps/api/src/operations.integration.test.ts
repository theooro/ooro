import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { app } from './server.js'
import { prisma } from './prisma.js'
import { hashSecret } from './http.js'
import { buildDisplayManifest } from './domain/campaign-eligibility.js'
import { standardV3Draft } from './domain/layout-studio.js'

// Opt in only against a disposable local audit database. No staging/production writes.
const enabled=process.env.OORO_INTEGRATION_TESTS==='true' && /127\.0\.0\.1:55432\/ooro_audit/.test(process.env.DATABASE_URL??'')
test('state-based delivery: unmetered manifest grant, idempotent proofs, pause and legacy scheduled safety', {skip:!enabled},async()=>{
 const rawToken=`audit-device-${randomUUID()}`
 const screen=await prisma.display.create({data:{deviceId:randomUUID(),name:'State delivery audit screen',state:'READY',deviceTokenHash:hashSecret(rawToken),supportsDeliveryQuota:true}})
 const campaign=await prisma.campaign.create({data:{name:'State delivery audit campaign',status:'ACTIVE',commercialFundingStatus:'PAID',startsAt:new Date(Date.now()-24*60*60*1000),endsAt:new Date(Date.now()+24*60*60*1000),offlinePlaysPerDisplay:2,creatives:{create:{name:'Approved audit image',status:'APPROVED',type:'IMAGE',asset:{create:{fileName:'audit.png',storageKey:`audit/${randomUUID()}.png`,url:'https://example.com/audit.png',checksum:'a'.repeat(64),mimeType:'image/png',active:true}}}}},include:{creatives:true}})
 const assignment=await prisma.displayCampaignAssignment.create({data:{campaignId:campaign.id,displayId:screen.id,active:true,offlinePlaysAuthorized:2,offlinePlaysConsumed:0,unlimitedOfflineAuthorized:false}})
 const customContract={...standardV3Draft(),mode:'CUSTOM' as const,preset:'CUSTOM_CANVAS' as const,profileId:'OORO_PREMIUM' as const,zones:[{id:'rotating',type:'IMAGE' as const,label:'Rotation',schemaVersion:1,geometry:{x:0,y:0,width:1,height:1},zIndex:0,fit:'FIT' as const,contentBinding:{kind:'NONE' as const},visible:true,rotation:{version:1 as const,mode:'SEQUENTIAL' as const,items:[{referenceId:campaign.creatives[0]!.id,durationSeconds:10}]}}]}
 const layout=await prisma.layoutTemplate.create({data:{name:'Audit custom rotation',mode:'CUSTOM',preset:'CUSTOM_CANVAS',state:'PUBLISHED',profileId:'OORO_PREMIUM',draftContract:customContract}})
 const revision=await prisma.layoutRevision.create({data:{templateId:layout.id,revision:1,contract:customContract,contractHash:'a'.repeat(64),validation:{valid:true,issues:[]}}})
 await prisma.layoutAssignment.create({data:{displayId:screen.id,templateId:layout.id,revisionId:revision.id,state:'ACTIVE',compatibility:{testOnly:true}}})
 const deviceHeaders={authorization:`Bearer ${rawToken}`}
 try {
  const manifestResponse=await app.inject({method:'GET',url:'/api/device/manifest',headers:deviceHeaders})
  assert.equal(manifestResponse.statusCode,200,manifestResponse.body)
  const manifestData=manifestResponse.json().data
  assert.ok(Number.isFinite(Date.parse(manifestData.authenticatedServerTime)))
  assert.ok(Date.parse(manifestData.generatedAt)<=Date.parse(manifestData.authenticatedServerTime))
  assert.ok(Date.parse(manifestData.authenticatedServerTime)<Date.parse(manifestData.validUntil))
  const {manifest}=await buildDisplayManifest(screen.id)
  assert.equal(manifest.items.length,1)
  assert.deepEqual(manifest.items[0].deliveryQuota,{id:`${campaign.id}:${screen.id}`,revision:assignment.offlineQuotaRevision,remainingPlays:null,unlimited:true})
  assert.equal('startsAt' in manifest.items[0],false)
  assert.equal('endsAt' in manifest.items[0],false)
  assert.deepEqual((manifest.layoutStudioContract?.zones as Array<{rotation?:{items:Array<{referenceId:string;durationSeconds:number}>}}>)?.[0]?.rotation?.items,[{referenceId:campaign.creatives[0]!.id,durationSeconds:10}])
  const legacy=await prisma.campaign.create({data:{name:'Legacy scheduled audit campaign',status:'SCHEDULED',commercialFundingStatus:'PAID',startsAt:new Date('2020-01-01'),endsAt:new Date('2020-01-02'),creatives:{create:{name:'Legacy image',status:'APPROVED',type:'IMAGE',asset:{create:{fileName:'legacy.png',storageKey:`audit/${randomUUID()}.png`,url:'https://example.com/legacy.png',checksum:'b'.repeat(64),mimeType:'image/png'}}}}},include:{creatives:true}})
  await prisma.displayCampaignAssignment.create({data:{campaignId:legacy.id,displayId:screen.id,active:true,offlinePlaysAuthorized:10}})
  assert.equal((await buildDisplayManifest(screen.id)).manifest.items.some(item=>item.campaignId===legacy.id),false)
  assert.equal((await prisma.campaign.findUniqueOrThrow({where:{id:legacy.id}})).status,'SCHEDULED')
  const sendProof=async(eventId:string)=>app.inject({method:'POST',url:'/api/device/proof-of-play',headers:deviceHeaders,payload:{events:[{eventId,campaignId:campaign.id,creativeId:campaign.creatives[0].id,assetId:(await prisma.asset.findFirstOrThrow({where:{creativeId:campaign.creatives[0].id}})).id,scheduleItemId:campaign.creatives[0].id,deliveryGrantId:`${campaign.id}:${screen.id}`,deliveryQuotaRevision:assignment.offlineQuotaRevision,startedAt:new Date().toISOString(),endedAt:new Date(Date.now()+10000).toISOString(),expectedDuration:10,actualDuration:10,success:true}]}})
  const firstId=randomUUID()
  const first=await sendProof(firstId);assert.equal(first.statusCode,200,first.body)
  assert.deepEqual(first.json().data.acceptedEventIds,[firstId])
  const retry=await sendProof(firstId);assert.equal(retry.statusCode,200,retry.body)
  assert.equal((await prisma.displayCampaignAssignment.findUniqueOrThrow({where:{id:assignment.id}})).offlinePlaysConsumed,0)
  const second=await sendProof(randomUUID());assert.equal(second.statusCode,200,second.body)
  assert.equal((await prisma.displayCampaignAssignment.findUniqueOrThrow({where:{id:assignment.id}})).offlinePlaysConsumed,0)
  const beyondLegacyQuota=await sendProof(randomUUID());assert.equal(beyondLegacyQuota.statusCode,200,beyondLegacyQuota.body)
  assert.equal((await prisma.displayCampaignAssignment.findUniqueOrThrow({where:{id:assignment.id}})).offlinePlaysConsumed,0)
  assert.equal((await buildDisplayManifest(screen.id)).manifest.items.some(item=>item.campaignId===campaign.id),true)
  await prisma.campaign.update({where:{id:campaign.id},data:{status:'PAUSED'}})
  assert.equal((await buildDisplayManifest(screen.id)).manifest.items.length,0)
 } finally {
  await app.close();await prisma.$disconnect()
 }
})
