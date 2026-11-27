import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ConsentGatedDriverContextV1 } from "./driver-context-v1";

test("future driver context requires explicit consent and can be stopped", async () => {
  const expiry = new Date(Date.now() + 60_000).toISOString(); let consent = false; let published = 0; let revoked = 0;
  const provider = new ConsentGatedDriverContextV1(async () => consent, async value => { published += 1; assert.equal(value.permissionGranted, true); }, async () => { revoked += 1; });
  await assert.rejects(provider.startSharing({ purpose: "CURRENT_LOCATION", expiresAt: expiry, context: { latitude: 12.9, longitude: 77.6 } }), /DRIVER_CONTEXT_CONSENT_REQUIRED/);
  assert.equal(provider.getShareState(), "STOPPED"); assert.equal(published, 0);
  consent = true;
  await provider.startSharing({ purpose: "CURRENT_LOCATION", expiresAt: expiry, context: { latitude: 12.9, longitude: 77.6 } });
  assert.equal(provider.getShareState(), "SHARING"); assert.equal(published, 1);
  await provider.stopSharing(); assert.equal(provider.getShareState(), "STOPPED"); assert.equal(revoked, 1);
});
