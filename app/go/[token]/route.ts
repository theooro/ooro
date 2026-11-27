import { NextResponse } from "next/server";
import { backendApiUrl } from "@/lib/backend-url";
import { resolveTrackingEntry } from "@/lib/consumer/tracking-entry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await resolveTrackingEntry(token, backendApiUrl());
  if ("location" in result) return NextResponse.redirect(result.location, { status: 302, headers: { "cache-control": "no-store" } });
  return NextResponse.json({ error: { message: result.message } }, { status: result.status, headers: { "cache-control": "no-store" } });
}
