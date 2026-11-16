import { NextResponse } from "next/server";
import { AdminAuthError, proxyAdminRequest } from "@/lib/auth/backend-session";

export async function GET(_request: Request, { params }: { params: Promise<{ screenId: string }> }) {
  try {
    const { screenId } = await params;
    const response = await proxyAdminRequest(`/api/admin/displays/${encodeURIComponent(screenId)}/fleet-detail`);
    const payload = await response.json();
    if (!response.ok || !payload?.data || !Array.isArray(payload.data.commands)) {
      return NextResponse.json(payload, { status: response.status });
    }
    // The API's device command model uses commandType; the admin UI consumes
    // the shared DeviceCommand shape, which uses type. Normalize at this edge.
    payload.data.commands = payload.data.commands.map((command: Record<string, unknown>) => ({
      ...command,
      screenId,
      type: command.commandType,
    }));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const status = error instanceof AdminAuthError ? error.status : 502;
    return NextResponse.json({ error: { message: error instanceof AdminAuthError ? "Admin authorization is required" : "Fleet detail service is unavailable" } }, { status });
  }
}
