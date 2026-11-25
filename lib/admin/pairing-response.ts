import type { PairingCode } from './types';
export function parsePairingResponse(payload: unknown, screenId: string): PairingCode {
  const root = payload as Record<string, unknown> | null;
  const data = (root?.data ?? root) as Record<string, unknown> | null;
  const status = data?.status;
  const binding = data?.screenId ?? data?.displayId;
  const code = data?.code ?? data?.pairingCode;
  if (binding !== screenId || !['ACTIVE', 'REVOKED'].includes(String(status)) ||
      (status === 'ACTIVE' && (typeof code !== 'string' || !code.trim() || data?.revokedAt)) ||
      (data?.expiresAt != null && (typeof data.expiresAt !== 'string' || !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now()))) {
    throw new Error('Invalid recovery response. Refresh and retry; verify staging API compatibility.');
  }
  return { screenId, code: status === 'REVOKED' ? null : code as string, status: status as PairingCode['status'], createdAt: typeof data?.createdAt === 'string' ? data.createdAt : new Date().toISOString(), expiresAt: (data?.expiresAt as string | null) ?? null };
}
