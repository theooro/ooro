import { ApiError } from '../errors.js'

export const DISPLAY_COMMAND_TTL_MS = 24 * 60 * 60_000
export const DISPLAY_COMMAND_DELIVERY_LEASE_MS = 5 * 60_000

export const displayCommandTypes = ['SYNC_MANIFEST', 'REFRESH_MANIFEST', 'RESTART_PLAYER', 'HEALTH_CHECK', 'UNPAIR'] as const
export type DisplayCommandType = typeof displayCommandTypes[number]
export type DisplayCommandState = 'QUEUED' | 'DELIVERED' | 'ACKNOWLEDGED' | 'FAILED' | 'EXPIRED' | 'CANCELLED'

export function commandExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + DISPLAY_COMMAND_TTL_MS)
}

export function isCommandExpired(expiresAt: Date | null | undefined, now = new Date()): boolean {
  return expiresAt != null && expiresAt.getTime() <= now.getTime()
}

export function commandBelongsToDevice(commandDisplayId: string, authenticatedDisplayId: string): boolean {
  return commandDisplayId === authenticatedDisplayId
}

export function commandStatusFromDeviceAck(status: 'RECEIVED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'UNSUPPORTED'): DisplayCommandState {
  if (status === 'SUCCEEDED') return 'ACKNOWLEDGED'
  if (status === 'FAILED' || status === 'UNSUPPORTED') return 'FAILED'
  return 'DELIVERED'
}

export function assertCommandCanBeAcknowledged(current: string, next: DisplayCommandState): void {
  if (current === next) return
  if (current === 'QUEUED' && next === 'DELIVERED') return
  if (current === 'QUEUED' && next === 'CANCELLED') return
  if (current === 'DELIVERED' && ['ACKNOWLEDGED', 'FAILED'].includes(next)) return
  throw new ApiError('COMMAND_STATE_CONFLICT', `Command cannot move from ${current} to ${next}`, 409)
}

export function sameIdempotentCommand(existing: { commandType: string; payload: unknown }, requested: { commandType: string; payload: unknown }): boolean {
  return existing.commandType === requested.commandType && JSON.stringify(existing.payload ?? null) === JSON.stringify(requested.payload ?? null)
}

export function safeCommandError(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const safe = value.replace(/[\r\n\t]+/g, ' ').replace(/(bearer\s+)[a-z0-9._~-]+/ig, '$1[redacted]').replace(/(token|secret|password|authorization)\s*[:=]\s*\S+/ig, '$1=[redacted]').slice(0, 240).trim()
  return safe || undefined
}
