// fetch() with a hard timeout. Serverless functions must fail fast instead of
// hanging until the platform kills them (which can burn SlipOK credits and
// leave a customer staring at a spinner).

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchWithTimeout };
