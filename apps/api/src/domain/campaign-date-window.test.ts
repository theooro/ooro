import assert from 'node:assert/strict'
import test from 'node:test'
import { campaignDateInTimezone, campaignDateWindow, DEFAULT_CAMPAIGN_TIMEZONE, isCampaignDateEligible, startOfCampaignDateUtc } from './campaign-date-window.js'

test('date windows include the full start and end calendar dates in Asia/Kolkata', () => {
  const window = campaignDateWindow('2026-01-01', '2026-01-02')
  assert.equal(window.startsAt.toISOString(), '2025-12-31T18:30:00.000Z')
  assert.equal(window.endsAt.toISOString(), '2026-01-02T18:30:00.000Z')
  assert.equal(campaignDateInTimezone(window.startsAt, DEFAULT_CAMPAIGN_TIMEZONE), '2026-01-01')
  assert.equal(campaignDateInTimezone(new Date(window.endsAt.getTime() - 1), DEFAULT_CAMPAIGN_TIMEZONE), '2026-01-02')
  assert.equal(isCampaignDateEligible(window, new Date(window.startsAt.getTime() - 1)), false)
  assert.equal(isCampaignDateEligible(window, window.startsAt), true)
  assert.equal(isCampaignDateEligible(window, new Date(window.endsAt.getTime() - 1)), true)
  assert.equal(isCampaignDateEligible(window, window.endsAt), false)
})

test('timezone conversion does not depend on the server host timezone', () => {
  assert.equal(startOfCampaignDateUtc('2026-06-30', 'UTC').toISOString(), '2026-06-30T00:00:00.000Z')
  assert.equal(startOfCampaignDateUtc('2026-06-30', 'Asia/Kolkata').toISOString(), '2026-06-29T18:30:00.000Z')
})

test('invalid dates, ranges and IANA timezone names fail closed', () => {
  assert.throws(() => campaignDateWindow('2026-02-30', '2026-03-01'), /CAMPAIGN_DATE_INVALID/)
  assert.throws(() => campaignDateWindow('2026-03-02', '2026-03-01'), /CAMPAIGN_DATE_RANGE_INVALID/)
  assert.throws(() => startOfCampaignDateUtc('2026-01-01', 'Not/A_Timezone'))
})
