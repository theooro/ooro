import test from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import net from 'node:net'
import dnsPromises from 'node:dns/promises'
import { signPartnerWebhook, verifyPartnerWebhook } from './domain/partner-integration.js'
import { installOfflineNetworkGuard } from './test-support/offline-network-guard.js'
import type { PartnerWebhookTransportRequest } from './partner-runtime.js'

installOfflineNetworkGuard()

const DATABASE_URL = process.env.DATABASE_URL ?? ''
const hasDisposableDatabase = process.env.OORO_PARTNER_RUNTIME_TESTS === 'true' && /^postgresql:\/\/[^@/]+@127\.0\.0\.1:55432\/ooro_test(?:\?|$)/.test(DATABASE_URL)
type Resolved = { address: string; family: 4 | 6 }
type FakeClock = { now: () => Date; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; advanceTo: (date: Date) => void; fireTimers: () => void }

function makeClock(initial: Date): FakeClock {
  let now = new Date(initial)
  let nextId = 0
  const timers = new Map<number, () => void>()
  const setTimeoutFake = ((callback: () => void) => {
    const id = ++nextId
    timers.set(id, callback)
    return id as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout
  const clearTimeoutFake = ((id: ReturnType<typeof setTimeout>) => { timers.delete(Number(id)) }) as typeof clearTimeout
  return {
    now: () => new Date(now),
    setTimeout: setTimeoutFake,
    clearTimeout: clearTimeoutFake,
    advanceTo: date => { now = new Date(date) },
    fireTimers: () => { const current = [...timers.values()]; timers.clear(); for (const callback of current) callback() },
  }
}

async function* bytes(...chunks: number[][]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) yield Uint8Array.from(chunk)
}

const publicIp: Resolved = { address: '93.184.216.34', family: 4 }

test('offline guard rejects public DNS and external TCP while permitting only the disposable PostgreSQL target', async () => {
  await assert.rejects(dnsPromises.lookup('example.com'), /OFFLINE_TEST_DNS_BLOCKED/)
  const socket = new net.Socket()
  assert.throws(() => socket.connect(443, '203.0.113.9'), /OFFLINE_TEST_NETWORK_BLOCKED/)
  socket.destroy()
  // The database integration test below proves that 127.0.0.1:55432 remains permitted.
})

test('successful HTTPS delivery signs exact body bytes with timestamp and pins the first vetted address', async () => {
  const { deliverPartnerWebhookRequest } = await import('./partner-runtime.js')
  const clock = makeClock(new Date('2026-11-26T12:00:00.000Z'))
  const secret = 'offline-fixture-signing-secret'
  const body = JSON.stringify({ id: 'fixture-event', type: 'campaign.submission.updated', data: { status: 'IN_REVIEW' } })
  const timestamp = Math.floor(clock.now().getTime() / 1000)
  const signatureValue = signPartnerWebhook(secret, timestamp, body)
  let captured: { requestId?: string; signature?: string; address?: string } = {}
  let dnsCalls = 0
  const dependencies = {
    resolve: async (_hostname: string) => {
      dnsCalls += 1
      return dnsCalls === 1 ? [publicIp] : [{ address: '127.0.0.1', family: 4 as const }]
    },
    transport: async (request: PartnerWebhookTransportRequest, _signal: AbortSignal) => {
      captured = { requestId: request.headers['x-ooro-delivery-id'], signature: request.headers['x-ooro-signature'], address: request.pinnedAddress.address }
      return { status: 204, body: bytes() }
    },
    clock,
    retryDelayMs: (attempt: number) => attempt * 1000,
  }
  const result = await deliverPartnerWebhookRequest('https://partner.fixture.test/hook', body, {
    'content-type': 'application/json',
    'x-ooro-delivery-id': 'fixture-delivery-1',
    'x-ooro-signature': `t=${timestamp},v1=${signatureValue}`,
  }, dependencies)
  assert.equal(result.status, 204)
  assert.equal(captured.requestId, 'fixture-delivery-1')
  assert.equal(captured.address, publicIp.address)
  assert.equal(dnsCalls, 1, 'the hostname is resolved once; connection uses the validated pin')
  const signature = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(captured.signature ?? '')
  assert.ok(signature)
  assert.equal(Number(signature[1]), timestamp)
  assert.equal(verifyPartnerWebhook(secret, Number(signature[1]), body, signature[2]!, timestamp), true)
})

test('DNS rebinding answers are rejected and private IPv4/IPv6 literals never reach transport', async () => {
  const { deliverPartnerWebhookRequest, pinnedPartnerWebhookLookup } = await import('./partner-runtime.js')
  const clock = makeClock(new Date())
  let calls = 0
  const dependencies = {
    resolve: async () => { calls += 1; return [publicIp, { address: '169.254.169.254', family: 4 as const }] },
    transport: async () => { throw new Error('transport must not run') },
    clock,
    retryDelayMs: () => 1000,
  }
  await assert.rejects(deliverPartnerWebhookRequest('https://rebind.fixture.test/hook', '{}', {}, dependencies), /ENDPOINT_REJECTED/)
  assert.equal(calls, 1)
  const pinned = pinnedPartnerWebhookLookup(publicIp)
  const connectionAddress = await new Promise<string>((resolve, reject) => {
    pinned('rebind.fixture.test', { all: true }, (error, addresses) => {
      if (error) reject(error)
      else resolve(Array.isArray(addresses) ? addresses[0]!.address : addresses)
    })
  })
  assert.equal(connectionAddress, publicIp.address, 'the HTTPS connector is pinned and cannot perform a second DNS lookup')
  for (const url of ['https://127.0.0.1/hook', 'https://10.1.2.3/hook', 'https://[::1]/hook', 'https://[fd00:ec2::254]/hook', 'https://[fe80::1]/hook']) {
    await assert.rejects(deliverPartnerWebhookRequest(url, '{}', {}, dependencies), /ENDPOINT_REJECTED/)
  }
}
)

test('redirects and streaming responses over the byte cap abort delivery', async () => {
  const { deliverPartnerWebhookRequest } = await import('./partner-runtime.js')
  const clock = makeClock(new Date())
  const base = { resolve: async () => [publicIp], clock, retryDelayMs: () => 1000 }
  await assert.rejects(deliverPartnerWebhookRequest('https://partner.fixture.test/hook', '{}', {}, {
    ...base, transport: async () => ({ status: 302, body: bytes() }),
  }), /REDIRECT_REJECTED/)
  let aborted = false
  await assert.rejects(deliverPartnerWebhookRequest('https://partner.fixture.test/hook', '{}', {}, {
    ...base,
    transport: async (_request: unknown, signal: AbortSignal) => {
      signal.addEventListener('abort', () => { aborted = true }, { once: true })
      return { status: 200, body: bytes([1, 2, 3], [4, 5, 6]) }
    },
  }, 5), /RESPONSE_TOO_LARGE/)
  assert.equal(aborted, true)
})

test('timeout aborts the injected transport', async () => {
  const { deliverPartnerWebhookRequest } = await import('./partner-runtime.js')
  const clock = makeClock(new Date())
  let aborted = false
  let notifyTransport!: () => void
  const transportStarted = new Promise<void>(resolve => { notifyTransport = resolve })
  const dependencies = {
    resolve: async () => [publicIp],
    transport: async (_request: unknown, signal: AbortSignal) => new Promise<{status:number;body:AsyncIterable<Uint8Array>}>((_resolve, reject) => {
      notifyTransport()
      signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')) }, { once: true })
    }),
    clock,
    retryDelayMs: () => 1000,
  }
  const request = deliverPartnerWebhookRequest('https://partner.fixture.test/hook', '{}', {}, dependencies)
  await transportStarted
  clock.fireTimers()
  await assert.rejects(request, /DELIVERY_TIMEOUT/)
  assert.equal(aborted, true)
})

test('worker retries have eight bounded attempts with injected backoff and one concurrent claim', { skip: !hasDisposableDatabase }, async () => {
  const [{ prisma }, { config }, { deliverDuePartnerWebhooks }] = await Promise.all([import('./prisma.js'), import('./config.js'), import('./partner-runtime.js')])
  const partner = await prisma.partnerOrganization.create({ data: { name: `transport-fixture-${randomUUID()}` } })
  const iv = randomBytes(12)
  const key = createHash('sha256').update(config.documentStorageKey).update(':partner-webhook-v1').digest()
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update('fixture-secret'), cipher.final()])
  const secretCiphertext = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
  const subscription = await prisma.partnerWebhookSubscription.create({ data: {
    partnerId: partner.id, environment: 'SANDBOX', endpointUrl: 'https://partner.fixture.test/events',
    encryptedSecret: secretCiphertext, eventTypes: ['RIDE_COMPLETED'],
  } })
  const deliveryIds: string[] = []
  const base = new Date('2026-11-26T12:00:00Z')
  let fixtureNow = new Date(base)
  const createDelivery = async () => {
    const item = await prisma.partnerWebhookDelivery.create({ data: {
      partnerId: partner.id, subscriptionId: subscription.id, environment: 'SANDBOX',
      eventId: randomUUID(), eventType: 'RIDE_COMPLETED', body: { id: randomUUID(), type: 'RIDE_COMPLETED', data: {} }, nextAttemptAt: fixtureNow,
    } })
    deliveryIds.push(item.id)
    return item
  }
  try {
    let current = new Date(base)
    const clock = {
      now: () => new Date(current),
      setTimeout,
      clearTimeout,
      advanceTo: (date: Date) => { current = new Date(date) },
    }
    const delays: number[] = []
    let attempts = 0
    const failing = {
      resolve: async () => [publicIp],
      transport: async () => { attempts += 1; return { status: 503, body: bytes() } },
      clock,
      retryDelayMs: (attempt: number) => { const delay = attempt * 1000; delays.push(delay); return delay },
    }
    const failed = await createDelivery()
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const stored = await prisma.partnerWebhookDelivery.findUniqueOrThrow({ where: { id: failed.id } })
      if (attempt > 1) clock.advanceTo(stored.nextAttemptAt)
      await deliverDuePartnerWebhooks(10, failing)
    }
    const dead = await prisma.partnerWebhookDelivery.findUniqueOrThrow({ where: { id: failed.id } })
    assert.equal(dead.status, 'FAILED', JSON.stringify({status:dead.status,attempts:dead.attempts,nextAttemptAt:dead.nextAttemptAt,lastErrorCode:dead.lastErrorCode}))
    assert.equal(dead.attempts, 8)
    assert.equal(dead.lastStatusCode, 503)
    assert.deepEqual(delays, [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000])
    assert.equal(attempts, 8)
    assert.deepEqual(await deliverDuePartnerWebhooks(10, failing), { processed: 0 })
    assert.equal(attempts, 8, 'automatic delivery stops after eight attempts until an authorized replay')

    fixtureNow = new Date(base)
    const concurrentItem = await createDelivery()
    current = new Date(base)
    let sends = 0
    let releaseSend!: () => void
    let notifySend!: () => void
    const sendStarted = new Promise<void>(resolve => { notifySend = resolve })
    const release = new Promise<void>(resolve => { releaseSend = resolve })
    const concurrentDeps = {
      resolve: async () => [publicIp],
      transport: async (request: PartnerWebhookTransportRequest) => {
        sends += 1
        const sentSignature = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(request.headers['x-ooro-signature'] ?? '')
        assert.ok(sentSignature)
        assert.equal(verifyPartnerWebhook('fixture-secret', Number(sentSignature[1]), request.body, sentSignature[2]!, Number(sentSignature[1])), true)
        notifySend()
        await release
        return { status: 204, body: bytes() }
      },
      clock,
      retryDelayMs: () => 1000,
    }
    const first = deliverDuePartnerWebhooks(10, concurrentDeps)
    await sendStarted
    const second = deliverDuePartnerWebhooks(10, concurrentDeps)
    releaseSend()
    await Promise.all([first, second])
    assert.equal(sends, 1)
    const delivered = await prisma.partnerWebhookDelivery.findUniqueOrThrow({ where: { id: concurrentItem.id } })
    assert.equal(delivered.status, 'DELIVERED')
    assert.equal(delivered.attempts, 1)
  } finally {
    await prisma.partnerWebhookDelivery.deleteMany({ where: { id: { in: deliveryIds } } })
    await prisma.partnerWebhookSubscription.delete({ where: { id: subscription.id } })
    await prisma.partnerOrganization.delete({ where: { id: partner.id } })
    await prisma.$disconnect()
  }
})
