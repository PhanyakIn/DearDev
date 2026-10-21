const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ORDER_TOKEN_SECRET = 'test-order-token-secret';

const { orderToken, tokenMatches } = require('./orderToken');

test('creates a stable token for an order id', () => {
  const first = orderToken('11111111-1111-4111-8111-111111111111');
  const second = orderToken('11111111-1111-4111-8111-111111111111');
  assert.equal(first, second);
  assert.equal(first.length, 32);
});

test('different orders get different tokens', () => {
  assert.notEqual(orderToken('order-a'), orderToken('order-b'));
});

test('matches only the correct token', () => {
  const id = 'order-a';
  assert.equal(tokenMatches(id, orderToken(id)), true);
  assert.equal(tokenMatches(id, 'wrong-token'), false);
  assert.equal(tokenMatches(id, ''), false);
  assert.equal(tokenMatches(id, undefined), false);
});
