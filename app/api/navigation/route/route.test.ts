import test from "node:test";
import assert from "node:assert/strict";
import { createRoutePost } from "@/lib/maps/route-handler";
import { DirectionsError } from "@/lib/maps/directions";

test("route API validates coordinates and returns configured provider geometry", async () => {
  const post = createRoutePost(async () => ({ distanceMeters: 2500, durationSeconds: 600, geometry: { type: "LineString", coordinates: [[77.5, 12.9], [77.6, 13.0]] }, provider: "Mapbox" }));
  const response = await post(new Request("https://local.test/api/navigation/route", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin: { latitude: 12.9, longitude: 77.5 }, destination: { latitude: 13, longitude: 77.6 } }) }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.distanceMeters, 2500);
  assert.equal(result.data.provider, "Mapbox");
  assert.equal(result.data.geometry.coordinates.length, 2);

  const invalid = await post(new Request("https://local.test/api/navigation/route", { method: "POST", body: JSON.stringify({ origin: { latitude: 99, longitude: 0 }, destination: { latitude: 0, longitude: 0 } }) }));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "INVALID_ROUTE_REQUEST");
});

test("route API exposes setup and upstream errors without leaking provider details", async () => {
  const unconfigured = createRoutePost(async () => { throw new DirectionsError("ROUTE_PREVIEW_NOT_CONFIGURED"); });
  const request = new Request("https://local.test/api/navigation/route", { method: "POST", body: JSON.stringify({ origin: { latitude: 0, longitude: 0 }, destination: { latitude: 1, longitude: 1 } }) });
  const missing = await unconfigured(request);
  assert.equal(missing.status, 503);
  assert.match((await missing.json()).error.message, /MAPBOX_ACCESS_TOKEN/);

  const failed = createRoutePost(async () => { throw new DirectionsError("ROUTE_PROVIDER_FAILED"); });
  const errorResponse = await failed(new Request("https://local.test/api/navigation/route", { method: "POST", body: JSON.stringify({ origin: { latitude: 0, longitude: 0 }, destination: { latitude: 1, longitude: 1 } }) }));
  assert.equal(errorResponse.status, 502);
  assert.doesNotMatch(JSON.stringify(await errorResponse.json()), /token|api\.mapbox\.com/i);
});
