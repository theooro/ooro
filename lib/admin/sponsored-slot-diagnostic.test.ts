import test from 'node:test';
import assert from 'node:assert/strict';
import { sponsoredSlotDiagnosticText } from './sponsored-slot-diagnostic.js';

test('Admin sponsor diagnostics preserve the exact actionable API gate', () => {
  assert.equal(sponsoredSlotDiagnosticText({ code: 'SPONSOR_FUNDING_REQUIRED', message: 'Sponsored image is excluded because funding is unpaid.' }), 'SPONSOR FUNDING REQUIRED: Sponsored image is excluded because funding is unpaid.');
  assert.equal(sponsoredSlotDiagnosticText(null), 'Sponsored slot status has not been evaluated.');
});
