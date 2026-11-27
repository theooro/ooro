import { publicApi } from "@/lib/consumer/public-api";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > 1024) return Response.json({ data: null, error: { code: "REQUEST_TOO_LARGE", message: "Request is too large." }, requestId: null }, { status: 413, headers: { "cache-control": "no-store" } });
  let parsed: unknown;
  try { parsed = body ? JSON.parse(body) : {}; } catch { return Response.json({ data: null, error: { code: "INVALID_REQUEST", message: "Invalid request." }, requestId: null }, { status: 400, headers: { "cache-control": "no-store" } }); }
  return publicApi("/api/public/now-playing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed) });
}
