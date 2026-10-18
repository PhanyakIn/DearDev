// Random license key generator. Format: DEAR-XXXX-XXXX-XXXX
// Alphabet omits ambiguous characters (I, O, 0, 1).

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BLOCK = 4;
const GROUPS = 3;

function block() {
  let out = '';
  for (let i = 0; i < BLOCK; i += 1) {
    out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return out;
}

function generateLicenseKey() {
  const parts = ['DEAR'];
  for (let i = 0; i < GROUPS; i += 1) parts.push(block());
  return parts.join('-');
}

module.exports = { generateLicenseKey };
