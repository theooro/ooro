import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignLayoutSelection, readCampaignLayoutSelection } from './campaign-layout-selection.js';

test('saved campaign layout, preview layout, and screen-assigned fallback use one selection', () => {
  for (const layout of ['SCREEN_ASSIGNED', 'FOUR_ZONE_V3', 'THREE_ZONE_AD_SPONSOR_QR_V1', 'FULLSCREEN_AD'] as const) {
    assert.deepEqual(campaignLayoutSelection(layout), { campaignLayout: layout, previewLayout: layout });
    assert.equal(readCampaignLayoutSelection(layout), layout);
  }
  assert.equal(readCampaignLayoutSelection('unknown'), 'SCREEN_ASSIGNED');
});
