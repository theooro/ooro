import { NextResponse } from "next/server";
import { AdminAuthError, proxyAdminRequest } from "@/lib/auth/backend-session";

export async function POST(_request: Request, { params }: { params: Promise<{ screenId: string }> }) {
  try {
    const { screenId } = await params;
    const response = await proxyAdminRequest("/api/displays/pairing-code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayId: screenId }) });
    const payload = await response.json().catch(() => ({ error: { message: "Backend returned invalid JSON" } }));
    if (!response.ok) return NextResponse.json(payload, { status: response.status });
    const data = payload.data ?? payload;
    return NextResponse.json({ data: { screenId: data.displayId, code: data.pairingCode, status: data.status ?? "ACTIVE", createdAt: data.createdAt ?? new Date().toISOString(), expiresAt: data.expiresAt ?? null } }, { status: response.status });
  } catch (error) {
    const status = error instanceof AdminAuthError ? error.status : 502;
    return NextResponse.json({ error: { message: error instanceof AdminAuthError ? "Admin authorization is required" : "Admin backend is unavailable" } }, { status });
  }
}

export async function PATCH(_request: Request, { params }: { params: Promise<{ screenId: string }> }) {
  try {
    const { screenId } = await params;
    const response = await proxyAdminRequest(`/api/displays/${screenId}/recovery-code/rotate`, { method: "POST" });
    const payload = await response.json().catch(() => ({ error: { message: "Backend returned invalid JSON" } }));
    if (!response.ok) return NextResponse.json(payload, { status: response.status });
    const data = payload.data ?? payload;
    return NextResponse.json({ data: { screenId: data.displayId, code: data.pairingCode, status: data.status, createdAt: data.createdAt, expiresAt: null } }, { status: response.status });
  } catch (error) {
    const status = error instanceof AdminAuthError ? error.status : 502;
    return NextResponse.json({ error: { message: error instanceof AdminAuthError ? "Admin authorization is required" : "Admin backend is unavailable" } }, { status });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ screenId: string }> }) {
  try {
    const { screenId } = await params;
    const response = await proxyAdminRequest(`/api/displays/${screenId}/recovery-code/revoke`, { method: "POST" });
    const payload = await response.json().catch(() => ({ error: { message: "Backend returned invalid JSON" } }));
    return NextResponse.json(payload.data ?? payload, { status: response.status });
  } catch (error) {
    const status = error instanceof AdminAuthError ? error.status : 502;
    return NextResponse.json({ error: { message: error instanceof AdminAuthError ? "Admin authorization is required" : "Admin backend is unavailable" } }, { status });
  }
}
