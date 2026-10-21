const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateSlip, parseSlipTimestamp } = require('./rules');

const NOW = Date.parse('2026-10-20T04:10:00.000Z');
const ORDER = { amount: 19900, created_at: '2026-10-20T04:00:00.000Z' };

function slip(overrides = {}) {
  return {
    amount: 199,
    transRef: 'A123456789',
    transTimestamp: '2026-10-20T04:01:00.000Z',
    ...overrides,
  };
}

test('accepts a recent slip for the exact amount', () => {
  const result = evaluateSlip({ order: ORDER, slip: slip(), now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.transRef, 'A123456789');
  assert.equal(result.slipTime, Date.parse('2026-10-20T04:01:00.000Z'));
});

test('accepts a numeric string amount', () => {
  const result = evaluateSlip({ order: ORDER, slip: slip({ amount: '199.00' }), now: NOW });
  assert.equal(result.ok, true);
});

test('accepts a slip within the clock-skew window', () => {
  const result = evaluateSlip({
    order: ORDER,
    slip: slip({ transTimestamp: '2026-10-20T03:56:00.000Z' }),
    now: NOW,
  });
  assert.equal(result.ok, true);
});

test('rejects a slip paid before the order was created', () => {
  const result = evaluateSlip({
    order: ORDER,
    slip: slip({ transTimestamp: '2026-10-19T20:00:00.000Z' }),
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 1016);
});

test('rejects a slip paid just outside the clock-skew window', () => {
  const result = evaluateSlip({
    order: ORDER,
    slip: slip({ transTimestamp: '2026-10-20T03:54:00.000Z' }),
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 1016);
});

test('rejects a future timestamp', () => {
  const result = evaluateSlip({
    order: ORDER,
    slip: slip({ transTimestamp: '2026-10-20T04:30:00.000Z' }),
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 1019);
});

test('rejects a missing amount instead of skipping the check', () => {
  const result = evaluateSlip({ order: ORDER, slip: slip({ amount: undefined }), now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.code, 1017);
});

test('rejects a wrong amount', () => {
  const result = evaluateSlip({ order: ORDER, slip: slip({ amount: 1 }), now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.code, 1013);
});

test('rejects a missing bank reference', () => {
  const result = evaluateSlip({ order: ORDER, slip: slip({ transRef: '' }), now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.code, 1018);
});

test('rejects a missing transaction time', () => {
  const result = evaluateSlip({
    order: ORDER,
    slip: slip({ transTimestamp: undefined }),
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 1019);
});

test('falls back to transDate + transTime (Thailand time, UTC+7)', () => {
  const parsed = parseSlipTimestamp({ transDate: '20261020', transTime: '110100' });
  assert.equal(parsed, Date.parse('2026-10-20T04:01:00.000Z'));
});

test('rejects an invalid order amount', () => {
  const result = evaluateSlip({
    order: { amount: undefined, created_at: ORDER.created_at },
    slip: slip(),
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 1019);
});
