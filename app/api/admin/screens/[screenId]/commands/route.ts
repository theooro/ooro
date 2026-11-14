import { NextResponse } from "next/server";
import { AdminAuthError, proxyAdminRequest } from "@/lib/auth/backend-session";

export async function GET(_request: Request, { params }: { params: Promise<{ screenId: string }> }) {
  try { const { screenId } = await params; const response = await proxyAdminRequest(`/api/admin/displays/${encodeURIComponent(screenId)}/commands`); const payload = await response.json().catch(() => ({ error: { message: "Backend returned invalid JSON" } })); return NextResponse.json(payload, { status: response.status }); }
  catch (error) { const status = error instanceof AdminAuthError ? error.status : 502; return NextResponse.json({ error: { message: error instanceof AdminAuthError ? "Admin authorization is required" : "Admin backend is unavailable" } }, { status }); }
}

export async function POST(request: Request, { params }: { params: Promise<{ screenId: string }> }) {
  try {
    const { screenId } = await params;
    const response = await proxyAdminRequest(`/api/admin/displays/${encodeURIComponent(screenId)}/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await request.json()) });
    const payload = await response.json().catch(() => ({ error: { message: "Backend returned invalid JSON" } }));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const status = error instanceof AdminAuthError ? error.status : 502;
    return NextResponse.json({ error: { message: error instanceof AdminAuthError ? "Admin authorization is required" : "Admin backend is unavailable" } }, { status });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ screenId: string }> }) {
  try {
    const { screenId } = await params;
    const { commandId } = await request.json() as { commandId?: string };
    if (!commandId || !/^[0-9a-f-]{36}$/i.test(commandId)) return NextResponse.json({ error: { message: "A valid command ID is required" } }, { status: 422 });
    const response = await proxyAdminRequest(`/api/admin/displays/${encodeURIComponent(screenId)}/commands/${encodeURIComponent(commandId)}/cancel`, { method: "POST" });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error) {
    const status = error instanceof AdminAuthError ? error.status : 502;
    return NextResponse.json({ error: { message: error instanceof AdminAuthError ? "Admin authorization is required" : "Command cancellation service is unavailable" } }, { status });
  }
}
