import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTrustedDatabaseTime, readTrustedDatabaseTime, trustedServerInstanceId } from './trusted-server-time.js'

test('trusted manifest time uses the database timestamp exactly at millisecond precision', () => {
    const databaseTime = new Date('2026-11-21T21:00:00.123Z')
    const result = normalizeTrustedDatabaseTime(databaseTime)
    assert.equal(result.toISOString(), '2026-11-21T21:00:00.123Z')
    assert.notEqual(result, databaseTime)
})

test('trusted manifest time rejects a missing or invalid database timestamp', () => {
    assert.throws(() => normalizeTrustedDatabaseTime(undefined), /trusted database time is unavailable/)
    assert.throws(() => normalizeTrustedDatabaseTime(new Date(Number.NaN)), /trusted database time is unavailable/)
})

test('trusted manifest time does not use an API process clock when instances have small clock skew', () => {
    const databaseTime = new Date('2026-11-21T21:00:00.000Z')
    const aheadProcessClock = new Date('2026-11-21T21:00:01.500Z')
    const behindProcessClock = new Date('2026-11-21T20:59:58.500Z')
    assert.equal(normalizeTrustedDatabaseTime(databaseTime).toISOString(), '2026-11-21T21:00:00.000Z')
    assert.notEqual(aheadProcessClock, databaseTime)
    assert.notEqual(behindProcessClock, databaseTime)
})

test('consecutive manifest requests read consecutive timestamps from the shared database clock', async () => {
  const databaseTimes = [new Date('2026-11-21T21:00:00.000Z'), new Date('2026-11-21T21:00:02.000Z')]
  const readDatabaseClock = async () => databaseTimes.shift()
  const first = await readTrustedDatabaseTime(readDatabaseClock)
  const second = await readTrustedDatabaseTime(readDatabaseClock)
  assert.equal(second.getTime() - first.getTime(), 2_000)
})

test('trusted server instance identifier is opaque and stable for one process identity', () => {
    const first = trustedServerInstanceId({ OORO_SERVER_INSTANCE_ID: 'staging-node-a' } as NodeJS.ProcessEnv)
    assert.equal(first, trustedServerInstanceId({ OORO_SERVER_INSTANCE_ID: 'staging-node-a' } as NodeJS.ProcessEnv))
    assert.notEqual(first, 'staging-node-a')
    assert.notEqual(first, trustedServerInstanceId({ OORO_SERVER_INSTANCE_ID: 'staging-node-b' } as NodeJS.ProcessEnv))
})
