import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const unavailable = () => NextResponse.json({ error: { code: "ROUTE_PREVIEW_NOT_CONFIGURED", message: "Route preview is unavailable: OORO has no approved directions provider configured. You can still open the selected route in your maps app." } }, { status: 503, headers: { "cache-control": "no-store" } });

// Deliberately fail closed until a provider adapter with pinned DNS/egress
// controls is configured. The consumer can still use the explicit map handoff.
export async function POST() { return unavailable(); }
