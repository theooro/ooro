import { NextResponse } from "next/server";
import { DirectionsError, getDirections, type MapPoint } from "./directions";

export function createRoutePost(route = getDirections) {
  return async function POST(request: Request) {
    if (Number(request.headers.get("content-length") ?? 0) > 2_048) {
      return NextResponse.json({ error: { code: "INVALID_ROUTE_REQUEST", message: "Route request is invalid." } }, { status: 413, headers: { "cache-control": "no-store" } });
    }
    let body: unknown;
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > 2_048) return NextResponse.json({ error: { code: "INVALID_ROUTE_REQUEST", message: "Route request is invalid." } }, { status: 413, headers: { "cache-control": "no-store" } });
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: { code: "INVALID_ROUTE_REQUEST", message: "Route request is invalid." } }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    const value = body as { origin?: { latitude?: unknown; longitude?: unknown }; destination?: { latitude?: unknown; longitude?: unknown } };
    const isCoordinate = (input?: { latitude?: unknown; longitude?: unknown }) => typeof input?.latitude === "number" && Number.isFinite(input.latitude) && input.latitude >= -90 && input.latitude <= 90 && typeof input.longitude === "number" && Number.isFinite(input.longitude) && input.longitude >= -180 && input.longitude <= 180;
    if (!isCoordinate(value?.origin) || !isCoordinate(value?.destination)) {
      return NextResponse.json({ error: { code: "INVALID_ROUTE_REQUEST", message: "Choose a valid origin and drop-off location first." } }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    try {
      const data = await route(value.origin as MapPoint, value.destination as MapPoint);
      return NextResponse.json({ data }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof DirectionsError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === "ROUTE_PREVIEW_NOT_CONFIGURED" ? 503 : 502, headers: { "cache-control": "no-store" } });
      return NextResponse.json({ error: { code: "ROUTE_PROVIDER_FAILED", message: "Route preview is temporarily unavailable. You can still open the selected route in your maps app." } }, { status: 502, headers: { "cache-control": "no-store" } });
    }
  };
}
