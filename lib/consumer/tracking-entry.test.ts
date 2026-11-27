import { strict as assert } from "node:assert";
import { test } from "node:test";
import { resolveTrackingEntry } from "./tracking-entry";

const token = "abcdefghijklmnopqrstuvwxyzABCDEF";
test("tracking entry records through the API and routes to consumer offer without following merchant redirect", async () => {
  let requested = "";
  const fetcher: typeof fetch = async (input, init) => { requested = String(input); assert.equal(init?.redirect, "manual"); return new Response(null, { status: 302, headers: { location: "https://merchant.example.test/redeem" } }); };
  const result = await resolveTrackingEntry(token, "https://api-staging.theooro.com", fetcher);
  assert.equal(requested, `https://api-staging.theooro.com/go/${token}`);
  assert.deepEqual(result, { status: 302, location: `https://theooro.com/offer/${token}` });
  assert.equal(JSON.stringify(result).includes("api-staging"), false);
});

test("tracking entry rejects invalid tokens and does not redirect on API failures", async () => {
  assert.deepEqual(await resolveTrackingEntry("bad", "https://api-staging.theooro.com"), { status: 404, message: "Tracking link not found." });
  assert.deepEqual(await resolveTrackingEntry(token, null), { status: 503, message: "Tracking service is unavailable." });
  const failed: typeof fetch = async () => new Response(null, { status: 404 });
  assert.deepEqual(await resolveTrackingEntry(token, "https://api-staging.theooro.com", failed), { status: 404, message: "Tracking link not found." });
});
