import { publicApi } from "@/lib/consumer/public-api";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return Response.json({ data: { state: "UNAVAILABLE", offer: null }, error: null, requestId: null }, { headers: { "cache-control": "no-store" } });
  return publicApi(`/api/public/qr-offers/${encodeURIComponent(token)}`);
}
