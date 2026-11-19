import test from 'node:test'
import assert from 'node:assert/strict'
import { hasLegacyCampaignTimingFields } from './state-based-delivery.js'

test('date and delivery-window fields are rejected instead of silently ignored', () => {
  for (const field of ['startsAt', 'endsAt', 'startDate', 'endDate', 'startTime', 'endTime', 'dailyStartTime', 'dailyEndTime', 'dailyWindows', 'weekdays', 'daysOfWeek', 'schedule', 'scheduleId', 'frequency', 'frequencyCap', 'intervalSeconds', 'playsPerLoop']) {
    assert.equal(hasLegacyCampaignTimingFields({ name: 'draft', [field]: 'legacy' }), true, field)
  }
  assert.equal(hasLegacyCampaignTimingFields({ metadata: { adminSchedule: { startTime: '08:00' } } }), true)
})

test('state-based campaign payloads without timing fields remain valid', () => {
  assert.equal(hasLegacyCampaignTimingFields({ name: 'draft', status: 'DRAFT', offlinePlaysPerDisplay: 100 }), false)
  assert.equal(hasLegacyCampaignTimingFields(null), false)
})
