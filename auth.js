// Верификация initData из Telegram WebApp.
// Для упрощения: пробуем два алгоритма (WebApp и Login Widget).
const crypto = require('crypto');

function buildDataCheckString(params) {
  const entries = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    entries.push(`${key}=${value}`);
  }
  entries.sort();
  return entries.join('\n');
}

function parseInitData(initData) {
  // initData — строка querystring от Telegram WebApp
  const url = new URLSearchParams(initData);
  const userStr = url.get('user');
  let tgUser = null;
  try { tgUser = userStr ? JSON.parse(userStr) : null; } catch {}
  const hash = url.get('hash');
  return { params: url, tgUser, hash, dataCheckString: buildDataCheckString(url) };
}

function verifyHashWebApp(dataCheckString, botToken, expectedHash) {
  // По документации WebApp: secret = HMAC_SHA256("WebAppData", botToken)
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return calcHash === expectedHash;
}

function verifyHashLoginWidget(dataCheckString, botToken, expectedHash) {
  // По документации Login Widget: secret = SHA256(botToken)
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return calcHash === expectedHash;
}

function verifyInitData(initData, botToken) {
  try {
    const { tgUser, hash, dataCheckString } = parseInitData(initData);
    if (!hash || !tgUser || !tgUser.id) return { ok: false };
    const ok =
      verifyHashWebApp(dataCheckString, botToken, hash) ||
      verifyHashLoginWidget(dataCheckString, botToken, hash);
    return { ok, tgUser };
  } catch (e) {
    return { ok: false };
  }
}

module.exports = { verifyInitData };