import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { parsePairingResponse } from './pairing-response';
test('recovery responses validate envelopes, binding, status and expiry', () => {
  const screenId = randomUUID();
  const data = { displayId: screenId, pairingCode: randomBytes(10).toString('hex'), status: 'ACTIVE', expiresAt: null };
  assert.ok(parsePairingResponse({ data }, screenId).screenId === screenId);
  assert.ok(parsePairingResponse(data, screenId).screenId === screenId);
  assert.ok(parsePairingResponse({ ...data, status: 'REVOKED', pairingCode: null }, screenId).code === null);
  for (const bad of [{}, { ...data, displayId: randomUUID() }, { ...data, pairingCode: undefined }, { ...data, status: 'USED' }, { ...data, expiresAt: 'invalid' }, { ...data, expiresAt: new Date(0).toISOString() }]) assert.throws(() => parsePairingResponse(bad, screenId));
});
