const legacyTimingFields = new Set([
  'startsAt', 'endsAt', 'startDate', 'endDate', 'startTime', 'endTime',
  'campaignStartDate', 'campaignEndDate', 'deliveryStartAt', 'deliveryEndAt',
  'dailyStartTime', 'dailyEndTime', 'dailyWindows', 'deliveryWindow', 'campaignWindow', 'scheduleWindow', 'activeDates', 'activeHours', 'timeWindow', 'weekdays', 'weekDays',
  'daysOfWeek', 'schedule', 'scheduleId', 'scheduleRules', 'playbackSchedule',
  'timezone', 'timeZone', 'frequency', 'frequencyCap', 'intervalSeconds',
  'playsPerLoop',
])
const normalizeTimingField = (field: string) => field.replace(/[^a-z0-9]/gi, '').toLowerCase()
const normalizedTimingFields = new Set([...legacyTimingFields].map(normalizeTimingField))

/** Old clients must receive a validation error rather than believe a delivery window was saved. */
export function hasLegacyCampaignTimingFields(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasLegacyCampaignTimingFields)
  return Object.entries(value).some(([key, child]) =>
    normalizedTimingFields.has(normalizeTimingField(key)) || hasLegacyCampaignTimingFields(child),
  )
}
