import test from "node:test";
import assert from "node:assert/strict";
import { DirectionsError, getDirections } from "./directions";

const origin = { latitude: 12.97, longitude: 77.59 };
const destination = { latitude: 12.99, longitude: 77.61 };
const result = { routes: [{ distance: 2345, duration: 510, geometry: { type: "LineString", coordinates: [[77.59, 12.97], [77.61, 12.99]] } }] };

test("configured directions request returns real provider geometry and summary", async () => {
  const requested: URL[] = [];
  const directions = await getDirections(origin, destination, {
    token: "synthetic-map-token",
    fetcher: async input => { requested.push(new URL(String(input))); return Response.json(result); },
  });
  assert.equal(directions.provider, "Mapbox");
  assert.equal(directions.distanceMeters, 2345);
  assert.deepEqual(directions.geometry.coordinates, result.routes[0].geometry.coordinates);
  assert.equal(requested[0]?.hostname, "api.mapbox.com");
  assert.equal(requested[0]?.searchParams.get("overview"), "full");
});

test("missing provider credentials fail with a setup error without network access", async () => {
  await assert.rejects(getDirections(origin, destination, { token: "", fetcher: async () => { throw new Error("must not fetch"); } }), (error: unknown) => error instanceof DirectionsError && error.code === "ROUTE_PREVIEW_NOT_CONFIGURED");
});

test("provider failures and malformed geometry return a safe error", async () => {
  await assert.rejects(getDirections(origin, destination, { token: "synthetic", fetcher: async () => new Response("", { status: 403 }) }), (error: unknown) => error instanceof DirectionsError && error.code === "ROUTE_PROVIDER_FAILED");
  await assert.rejects(getDirections(origin, destination, { token: "synthetic", fetcher: async () => Response.json({ routes: [{ distance: 1, duration: 1, geometry: { type: "LineString", coordinates: [[999, 999], [1, 1]] } }] }) }), (error: unknown) => error instanceof DirectionsError && error.code === "ROUTE_PROVIDER_FAILED");
});

test("request rejects invalid coordinates before making a provider request", async () => {
  let fetched = false;
  await assert.rejects(getDirections({ latitude: 91, longitude: 0 }, destination, { token: "synthetic", fetcher: async () => { fetched = true; return Response.json(result); } }), (error: unknown) => error instanceof DirectionsError);
  assert.equal(fetched, false);
});
