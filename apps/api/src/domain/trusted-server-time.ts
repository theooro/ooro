import { createHash } from 'node:crypto'

/**
 * Device schedule time must not come from an individual API process clock: a
 * load balancer can send adjacent requests to processes with slightly
 * different clocks. Use the shared PostgreSQL clock for every manifest time.
 */
export function normalizeTrustedDatabaseTime(value: Date | null | undefined): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error('trusted database time is unavailable')
  }
  return new Date(value.getTime())
}

export async function readTrustedDatabaseTime(readDatabaseClock: () => Promise<Date | null | undefined>): Promise<Date> {
  return normalizeTrustedDatabaseTime(await readDatabaseClock())
}

/** Stable opaque identifier for log correlation without exposing host names. */
export function trustedServerInstanceId(env: NodeJS.ProcessEnv = process.env): string {
  const identity = env.OORO_SERVER_INSTANCE_ID || env.FLY_MACHINE_ID || env.HOSTNAME || 'local'
  return createHash('sha256').update(identity).digest('hex').slice(0, 16)
}
