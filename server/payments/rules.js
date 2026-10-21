// Our own, fail-closed checks on top of SlipOK's verification.
//
// SlipOK tells us the slip is genuine and was paid to the configured receiver.
// We still have to prove that the slip belongs to THIS order:
//   - amount must be exactly the order amount
//   - the bank reference must exist (it is the duplicate-slip key)
//   - the transaction time must be after the order was created
//
// Missing fields are rejected, never skipped. A verification path that fails
// open is worse than no verification at all.

const DEFAULT_SKEW_MS = 5 * 60 * 1000;

function parseSlipTimestamp(slip) {
  if (!slip || typeof slip !== 'object') return null;

  if (slip.transTimestamp) {
    const ts = Date.parse(String(slip.transTimestamp));
    if (Number.isFinite(ts)) return ts;
  }

  // SlipOK's transDate/transTime are Thailand local time (UTC+7).
  const date = String(slip.transDate || '');
  const time = String(slip.transTime || '');
  if (/^\d{8}$/.test(date) && /^\d{6}$/.test(time)) {
    const iso =
      `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` +
      `T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+07:00`;
    const ts = Date.parse(iso);
    if (Number.isFinite(ts)) return ts;
  }

  return null;
}

function evaluateSlip({ order, slip, now = Date.now(), skewMs = DEFAULT_SKEW_MS }) {
  const orderAmount = Number(order && order.amount);
  if (!Number.isFinite(orderAmount)) {
    return { ok: false, code: 1019, message: 'This order is missing its amount. Please contact the shop.' };
  }

  const slipAmountSatang = Math.round(Number(slip && slip.amount) * 100);
  if (!Number.isFinite(slipAmountSatang)) {
    return { ok: false, code: 1017, message: 'We could not read the amount on this slip. Please upload the original bank slip.' };
  }
  if (slipAmountSatang !== orderAmount) {
    return { ok: false, code: 1013, message: 'The amount on the slip does not match this order.' };
  }

  const transRef = String((slip && slip.transRef) || '').trim();
  if (transRef.length < 6) {
    return { ok: false, code: 1018, message: 'The slip reference is missing. Please upload the original bank slip.' };
  }

  const slipTime = parseSlipTimestamp(slip);
  if (slipTime == null) {
    return { ok: false, code: 1019, message: 'We could not read the payment date on this slip. Please upload the original bank slip.' };
  }

  const createdAt = Date.parse(String(order && order.created_at));
  if (!Number.isFinite(createdAt)) {
    return { ok: false, code: 1019, message: 'This order is missing its creation time. Please contact the shop.' };
  }

  if (slipTime < createdAt - skewMs) {
    return {
      ok: false,
      code: 1016,
      message: 'This slip was paid before this order was created. Please upload the slip for this order.',
    };
  }

  if (slipTime > now + skewMs) {
    return { ok: false, code: 1019, message: 'The payment date on this slip is not valid.' };
  }

  return { ok: true, transRef, slipTime };
}

module.exports = { evaluateSlip, parseSlipTimestamp, DEFAULT_SKEW_MS };
