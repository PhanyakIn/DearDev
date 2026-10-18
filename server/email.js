// Transactional email via Resend HTTP API.

const { config } = require('./config');

async function sendEmail({ to, subject, html }) {
  if (!config.resendApiKey) throw new Error('Missing RESEND_API_KEY');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: config.emailFrom, to, subject, html }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`resend ${res.status}: ${text}`);
  }
  return res.json();
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendDownloadEmail({ to, productName, licenseKey, downloadUrl, limit }) {
  const name = escapeHtml(productName);
  const key = escapeHtml(licenseKey);
  const url = escapeHtml(downloadUrl);
  const html = `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 8px">ขอบคุณสำหรับการสั่งซื้อ 🎉</h2>
    <p style="margin:0 0 16px;color:#444">คุณซื้อ <strong>${name}</strong> เรียบร้อยแล้ว</p>
    <p style="margin:0 0 8px">License key ของคุณ:</p>
    <p style="font-size:20px;font-weight:700;letter-spacing:2px;background:#f3f4f6;border-radius:8px;padding:12px 16px;text-align:center">${key}</p>
    <p style="margin:24px 0 8px">
      <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">ดาวน์โหลดสินค้า</a>
    </p>
    <p style="margin:8px 0 0;color:#666;font-size:13px">ลิงก์ดาวน์โหลดใช้ได้สูงสุด ${limit} ครั้ง — เปิดดูซ้ำได้ที่หน้าเว็บหลังชำระเงิน</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
    <p style="color:#888;font-size:12px;margin:0">DearDev — ขอบคุณที่สนับสนุนผลงาน 😊</p>
  </div>`;
  return sendEmail({
    to,
    subject: `สินค้าของคุณพร้อมแล้ว — ${productName}`,
    html,
  });
}

module.exports = { sendEmail, sendDownloadEmail, escapeHtml };
