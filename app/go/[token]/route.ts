import { NextResponse } from "next/server";
import { backendApiUrl } from "@/lib/backend-url";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) {
    return NextResponse.json({ error: { message: "Tracking link not found." } }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  const apiBase = backendApiUrl();
  if (!apiBase) {
    return NextResponse.json({ error: { message: "Tracking service is unavailable." } }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  try {
    const tracked = await fetch(`${apiBase}/go/${token}`, { redirect: "manual", cache: "no-store", headers: { accept: "text/html" } });
    const location = tracked.headers.get("location");
    if (tracked.status !== 302 || !location) {
      return NextResponse.json({ error: { message: tracked.status === 404 ? "Tracking link not found." : "Tracking service is unavailable." } }, { status: tracked.status === 404 ? 404 : 502, headers: { "cache-control": "no-store" } });
    }
    const destination = new URL(location);
    if (destination.protocol !== "https:") throw new Error("Unsafe tracking destination");
    return NextResponse.redirect(destination, { status: 302, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: { message: "Tracking service is unavailable." } }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
