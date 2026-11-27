import { NextResponse } from "next/server";
import { backendApiUrl } from "@/lib/backend-url";

export async function publicApi(path: string, init?: RequestInit) {
  const base = backendApiUrl();
  if (!base) return NextResponse.json({ data: null, error: { code: "PUBLIC_API_UNAVAILABLE", message: "OORO offers are temporarily unavailable." }, requestId: null }, { status: 503, headers: { "cache-control": "no-store" } });
  try {
    const upstream = await fetch(`${base}${path}`, { ...init, cache: "no-store", redirect: "error", headers: { accept: "application/json", ...(init?.headers ?? {}) } });
    const body = await upstream.json().catch(() => null);
    return NextResponse.json(body ?? { data: null, error: { code: "INVALID_API_RESPONSE", message: "OORO returned an invalid response." }, requestId: null }, { status: upstream.status, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ data: null, error: { code: "PUBLIC_API_UNAVAILABLE", message: "OORO offers are temporarily unavailable." }, requestId: null }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
