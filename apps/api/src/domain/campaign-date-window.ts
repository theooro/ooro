export const DEFAULT_CAMPAIGN_TIMEZONE = 'Asia/Kolkata'
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function dateParts(value: string): [number, number, number] {
  if (!DATE_ONLY.test(value)) throw new Error('CAMPAIGN_DATE_INVALID')
  const [year, month, day] = value.split('-').map(Number)
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) throw new Error('CAMPAIGN_DATE_INVALID')
  return [year, month, day]
}

function localPartsAsUtc(value: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, calendar: 'iso8601', numberingSystem: 'latn', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(value)
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'))
}

export function startOfCampaignDateUtc(date: string, timezone: string): Date {
  const [year, month, day] = dateParts(date)
  const target = Date.UTC(year, month - 1, day)
  let candidate = target
  for (let index = 0; index < 4; index += 1) candidate += target - localPartsAsUtc(new Date(candidate), timezone)
  const resolved = new Date(candidate)
  if (localPartsAsUtc(resolved, timezone) !== target) throw new Error('CAMPAIGN_DATE_BOUNDARY_UNRESOLVABLE')
  return resolved
}

export function campaignDateWindow(startDate: string, endDate: string, timezone = DEFAULT_CAMPAIGN_TIMEZONE) {
  if (timezone !== DEFAULT_CAMPAIGN_TIMEZONE) throw new Error('CAMPAIGN_TIMEZONE_UNSUPPORTED')
  const [sy, sm, sd] = dateParts(startDate)
  const [ey, em, ed] = dateParts(endDate)
  const startOrdinal = Date.UTC(sy, sm - 1, sd)
  const endOrdinal = Date.UTC(ey, em - 1, ed)
  if (endOrdinal < startOrdinal) throw new Error('CAMPAIGN_DATE_RANGE_INVALID')
  const nextDay = new Date(endOrdinal + 86_400_000).toISOString().slice(0, 10)
  return { startsAt: startOfCampaignDateUtc(startDate, timezone), endsAt: startOfCampaignDateUtc(nextDay, timezone), startDate, endDate, timezone }
}

export function campaignDateInTimezone(value: Date | null, timezone: string): string | null {
  return value ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value) : null
}

export function isCampaignDateEligible(input: { startsAt: Date | null; endsAt: Date | null }, now: Date): boolean {
  return Boolean(input.startsAt && input.endsAt && input.startsAt <= now && now < input.endsAt)
}
