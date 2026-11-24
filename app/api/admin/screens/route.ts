import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AdminAuthError, adminDiagnostics, proxyAdminRequest } from "@/lib/auth/backend-session";

export async function GET() {
  const requestId = randomUUID();
  try {
    const response = await proxyAdminRequest("/api/admin/displays");
    const payload = await response.json();
    if (!response.ok) return NextResponse.json({ ...payload, requestId: payload.requestId ?? requestId }, { status: response.status });
    if (!Array.isArray(payload.data)) throw new Error("Invalid backend fleet contract");
    const displays = payload.data;
    return NextResponse.json({ data: displays.map((display: { id: string; deviceId: string; name: string; ownershipType?: string; inventoryConfig?: {city?: string}; vehicleId?: string | null; createdAt: string; updatedAt: string; state: string; pairingStatus?: string; pairedAt?: string | null; connectivity?: string; appVersion?: string | null; manifestVersion?: number | null; lastLatitude?: number | null; lastLongitude?: number | null; lastLocationAt?: string | null; lastHeartbeatAt?: string | null; currentCampaignId?: string | null; currentCreativeId?: string | null; currentPlaybackState?: string | null; currentPlaybackStartedAt?: string | null; currentPlaybackPositionMs?: number | null; currentExpectedDurationMs?: number | null; currentCreative?: { id?: string; name?: string | null; campaign?: { id?: string; name?: string | null } | null; asset?: { url?: string | null; mimeType?: string | null; fileName?: string | null } | null } | null; currentCreativeTrust?: string; currentLayout?: string; currentLayoutVersion?: number | null; lastSuccessfulSync?: string | null; latestProof?: { creativeId?: string | null; campaignId?: string | null; playbackStartedAt?: string; slot?: string; status?: string } | null; latestCommand?: { id: string; commandType: string; status: string; createdAt: string; deliveredAt?: string | null; acknowledgedAt?: string | null; failedAt?: string | null; cancelledAt?: string | null; expiresAt?: string | null; error?: string | null } | null; playerUpdateStatus?: "UP_TO_DATE" | "UPDATE_AVAILABLE" | "UNKNOWN"; diagnostics?: { networkType?: string | null; networkConnected?: boolean | null; storageFreeBytes?: number | null; storageTotalBytes?: number | null; playerState?: string | null; manifestVersion?: number | null } | null; installedPlayer?: { versionName?: string | null } | null; vehicle?: { area?: string | null; city?: string | null; registrationNumber?: string | null } | null; heartbeats?: Array<{ occurredAt?: string; receivedAt?: string; networkType?: string | null }> }) => ({
      screenId: display.id, deviceId: display.deviceId, screenName: display.name,
      screenType: display.ownershipType ?? "AUTO_SCREEN", city: display.vehicle?.city ?? display.inventoryConfig?.city ?? "—", area: display.vehicle?.area ?? "—", vehicleIdentifier: display.vehicle?.registrationNumber ?? null,
      vehicleId: display.vehicleId ?? undefined, createdAt: display.createdAt,
      pairedAt: display.pairingStatus === "PAIRED" ? display.pairedAt ?? undefined : undefined,
      pairingStatus: display.pairingStatus ?? (display.state === "UNPAIRED" ? "UNPAIRED" : display.state === "DISABLED" ? "REMOVAL_PENDING" : "PAIRING_PENDING"), connectivity: display.connectivity === "DEGRADED" ? "STALE" : display.connectivity ?? "NEVER_CONNECTED", latitude: display.lastLatitude ?? null, longitude: display.lastLongitude ?? null, lastLocationAt: display.lastLocationAt ?? null, lastHeartbeatAt: display.lastHeartbeatAt ?? display.heartbeats?.[0]?.receivedAt ?? display.heartbeats?.[0]?.occurredAt ?? null, currentCampaignId: display.currentCreativeTrust === "VERIFIED_RECENT_PROOF" ? display.currentCreative?.campaign?.id ?? null : null, currentCreativeId: display.currentCreativeTrust === "VERIFIED_RECENT_PROOF" ? display.currentCreative?.id ?? null : null, playbackState: display.currentPlaybackState ?? null, manifestVersion: display.manifestVersion ?? null, networkType: display.heartbeats?.[0]?.networkType ?? null, appVersion: display.appVersion ?? display.installedPlayer?.versionName ?? null,
      currentCampaignName: display.currentCreativeTrust === "VERIFIED_RECENT_PROOF" ? display.currentCreative?.campaign?.name ?? null : null, currentCreativeName: display.currentCreativeTrust === "VERIFIED_RECENT_PROOF" ? display.currentCreative?.name ?? null : null,
      currentCreativeUrl: display.currentCreativeTrust === "VERIFIED_RECENT_PROOF" ? display.currentCreative?.asset?.url ?? null : null, currentCreativeMimeType: display.currentCreativeTrust === "VERIFIED_RECENT_PROOF" ? display.currentCreative?.asset?.mimeType ?? null : null, currentCreativeFileName: display.currentCreativeTrust === "VERIFIED_RECENT_PROOF" ? display.currentCreative?.asset?.fileName ?? null : null,
      playbackStartedAt: display.currentPlaybackStartedAt ?? null, playbackPositionMs: display.currentPlaybackPositionMs ?? null, expectedDurationMs: display.currentExpectedDurationMs ?? null,
      currentCreativeTrust: display.currentCreativeTrust === "VERIFIED_RECENT_PROOF" ? "VERIFIED_RECENT_PROOF" : "UNKNOWN", currentLayout: display.currentLayout ?? null, currentLayoutVersion: display.currentLayoutVersion ?? null,
      lastSuccessfulSync: display.lastSuccessfulSync ?? null, latestProof: display.latestProof ?? null, latestCommand: display.latestCommand ? { id: display.latestCommand.id, screenId: display.id, type: display.latestCommand.commandType as never, status: display.latestCommand.status as never, createdAt: display.latestCommand.createdAt, deliveredAt: display.latestCommand.deliveredAt, acknowledgedAt: display.latestCommand.acknowledgedAt, failedAt: display.latestCommand.failedAt, cancelledAt: display.latestCommand.cancelledAt, expiresAt: display.latestCommand.expiresAt, error: display.latestCommand.error } : null,
      playerUpdateStatus: display.playerUpdateStatus ?? "UNKNOWN", diagnostics: display.diagnostics ?? null,
    })) });
  } catch (error) {
    console.error("[admin/screens] fleet request failed", { requestId, code: error instanceof AdminAuthError ? error.code : "BACKEND_FAILURE", errorType: error instanceof Error ? error.name : "unknown" });
    const status = error instanceof AdminAuthError ? error.status : 502;
    return NextResponse.json({ error: { code: error instanceof AdminAuthError ? error.code : "ADMIN_BACKEND_UNAVAILABLE", message: status === 401 ? "Admin session expired. Sign in again." : status === 403 ? "Admin access denied." : "Screen fleet service unavailable. Retry or contact operations." }, requestId }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const response = await proxyAdminRequest("/api/admin/displays", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await request.json()) });
    const payload = await response.json().catch(() => ({ error: { code: "BACKEND_INVALID_RESPONSE", message: "Backend returned invalid JSON" } }));
    adminDiagnostics({ adminApiConfigured: true, tokenPresent: true, tokenHeaderPresent: true, backendReached: true, authResult: response.status === 401 || response.status === 403 ? "denied" : "allowed" });
    if (response.status === 401) return NextResponse.json({ error: { code: "SESSION_EXPIRED", message: "Your admin session has expired" } }, { status: 401 });
    if (response.status === 403) return NextResponse.json({ error: { code: "ADMIN_ACCESS_DENIED", message: "Admin access denied" } }, { status: 403 });
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: { code: error.code, message: error.code === "ADMIN_AUTH_REQUIRED" ? "Admin authentication is required" : error.code === "ADMIN_ACCESS_DENIED" ? "Admin access denied" : "Your admin session has expired" } }, { status: error.status });
    return NextResponse.json({ error: { code: "ADMIN_BACKEND_UNAVAILABLE", message: "Admin backend is unavailable" } }, { status: 502 });
  }
}
