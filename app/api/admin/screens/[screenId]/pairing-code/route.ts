import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthError, proxyAdminRequest, requireAdminPermission } from "@/lib/auth/backend-session";
import { parsePairingResponse } from "@/lib/admin/pairing-response";

async function handle(request: Request, { params }: { params: Promise<{ screenId: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const { screenId } = await params;
    if (!z.string().uuid().safeParse(screenId).success) return NextResponse.json({ error: { message: "Invalid screen ID" } }, { status: 400, headers });
    await requireAdminPermission("device:write");
    const method = request.method;
    const path = method === "POST" ? "/api/displays/pairing-code" : `/api/displays/${screenId}/recovery-code${method === "PATCH" ? "/rotate" : method === "DELETE" ? "/revoke" : ""}`;
    const response = await proxyAdminRequest(path, method === "POST" ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayId: screenId }) } : { method: method === "GET" ? "GET" : "POST" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return NextResponse.json(payload ?? { error: { message: "Backend returned invalid JSON" } }, { status: response.status, headers });
    if (payload?.data === null) return NextResponse.json({ data: null }, { headers });
    if (method === "DELETE") return NextResponse.json({ data: payload?.data ?? payload }, { headers });
    return NextResponse.json({ data: parsePairingResponse(payload, screenId) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof AdminAuthError ? "Admin authorization is required" : "Recovery response unavailable or invalid. Retry or contact an operator." } }, { status: error instanceof AdminAuthError ? error.status : 502, headers });
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
