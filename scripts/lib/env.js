// Shared env loader for the ops scripts.
//
// Loads .env.local then .env from the repo root (first value wins), mirroring
// CRA/Vercel precedence. Values already present in the real environment are
// never overwritten, so `KEY=x node scripts/...` still wins.
//
// server/config.js reads process.env at import time, so ALWAYS call loadEnv()
// before requiring anything from server/.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

function loadEnv() {
  loadEnvFile(path.join(ROOT, '.env.local'));
  loadEnvFile(path.join(ROOT, '.env'));
}

module.exports = { loadEnv, ROOT };
