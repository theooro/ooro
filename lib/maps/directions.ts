export type MapPoint = { latitude: number; longitude: number };
export type DirectionsResult = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: "LineString"; coordinates: Array<[number, number]> };
  provider: "Mapbox";
};

export class DirectionsError extends Error {
  constructor(readonly code: "ROUTE_PREVIEW_NOT_CONFIGURED" | "ROUTE_PROVIDER_FAILED") {
    super(code === "ROUTE_PREVIEW_NOT_CONFIGURED"
      ? "Route preview is unavailable: configure the server-side MAPBOX_ACCESS_TOKEN. You can still open the selected route in your maps app."
      : "Route preview is temporarily unavailable. You can still open the selected route in your maps app.");
  }
}

function validPoint(value: MapPoint): boolean {
  return Number.isFinite(value.latitude) && Number.isFinite(value.longitude) &&
    value.latitude >= -90 && value.latitude <= 90 && value.longitude >= -180 && value.longitude <= 180;
}

async function readBoundedJson(response: Response, maxBytes = 512 * 1024): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new DirectionsError("ROUTE_PROVIDER_FAILED");
  if (!response.body) throw new DirectionsError("ROUTE_PROVIDER_FAILED");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new DirectionsError("ROUTE_PROVIDER_FAILED");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))))) as unknown;
  } catch {
    throw new DirectionsError("ROUTE_PROVIDER_FAILED");
  }
}

export async function getDirections(
  origin: MapPoint,
  destination: MapPoint,
  options: { token?: string; fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<DirectionsResult> {
  const token = options.token ?? process.env.MAPBOX_ACCESS_TOKEN;
  if (!token?.trim()) throw new DirectionsError("ROUTE_PREVIEW_NOT_CONFIGURED");
  if (!validPoint(origin) || !validPoint(destination)) throw new DirectionsError("ROUTE_PROVIDER_FAILED");

  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("access_token", token.trim());
  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(options.timeoutMs ?? 8_000) });
  } catch {
    throw new DirectionsError("ROUTE_PROVIDER_FAILED");
  }
  if (!response.ok) throw new DirectionsError("ROUTE_PROVIDER_FAILED");
  const payload = await readBoundedJson(response) as {
    routes?: Array<{ distance?: number; duration?: number; geometry?: { type?: string; coordinates?: unknown } }>;
  };
  const route = payload.routes?.[0];
  const coordinates = route?.geometry?.coordinates;
  if (!route || !Number.isFinite(route.distance) || !Number.isFinite(route.duration) ||
      route.distance! < 0 || route.duration! < 0 || route.geometry?.type !== "LineString" ||
      !Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 20_000) {
    throw new DirectionsError("ROUTE_PROVIDER_FAILED");
  }
  const points = coordinates.map(value => {
    if (!Array.isArray(value) || value.length < 2) return null;
    const [longitude, latitude] = value;
    if (typeof longitude !== "number" || typeof latitude !== "number" ||
        !Number.isFinite(longitude) || !Number.isFinite(latitude) ||
        longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
    return [longitude, latitude] as [number, number];
  });
  if (points.some(point => point === null)) throw new DirectionsError("ROUTE_PROVIDER_FAILED");
  return { distanceMeters: route.distance!, durationSeconds: route.duration!, geometry: { type: "LineString", coordinates: points as Array<[number, number]> }, provider: "Mapbox" };
}
