const ALLOWED_ORIGIN = 'https://wait.3y.f5.si';

const CONTACT_TYPE_LABELS = {
  bug: 'バグ報告',
  feature: '機能提案',
  other: 'その他',
};

const CONTACT_TYPE_COLORS = {
  bug: 0xef4444,     // 赤
  feature: 0x3b82f6, // 青
  other: 0x64748b,   // グレー
};

export default {
  async fetch(request, env, ctx) {
    // --- CORSプリフライト（OPTIONS）対応 ---
    if (request.method === 'OPTIONS') {
      return handlePreflight(request);
    }

    // --- POST以外は拒否 ---
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method Not Allowed' }, 405);
    }

    // --- 許可ドメイン以外からのリクエストは拒否 ---
    if (!isRequestFromAllowedOrigin(request)) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    // --- リクエストボディの読み取り・検証 ---
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    const type = body && body.type;
    const rawMessage = body && body.message;

    if (!type || !CONTACT_TYPE_LABELS[type]) {
      return jsonResponse({ error: 'Invalid contact type' }, 400);
    }

    if (typeof rawMessage !== 'string' || rawMessage.trim().length === 0) {
      return jsonResponse({ error: 'Message is required' }, 400);
    }

    const message = rawMessage.trim();

    if (message.length > 500) {
      return jsonResponse({ error: 'Message must be 500 characters or fewer' }, 400);
    }

    // --- Discord Webhookへ送信 ---
    const webhookUrl = env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      // シークレット未設定（デプロイ設定ミス）
      return jsonResponse({ error: 'Server misconfigured' }, 500);
    }

    const discordPayload = {
      username: 'ウェイ太！ お問い合わせ',
      embeds: [
        {
          title: `新しいお問い合わせ（${CONTACT_TYPE_LABELS[type]}）`,
          description: sanitizeForDiscord(message),
          color: CONTACT_TYPE_COLORS[type] ?? 0x64748b,
          fields: [
            { name: '種別', value: CONTACT_TYPE_LABELS[type], inline: true },
            { name: '受信日時 (UTC)', value: new Date().toISOString(), inline: true },
          ],
        },
      ],
    };

    try {
      const discordRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discordPayload),
      });

      if (!discordRes.ok) {
        const text = await discordRes.text().catch(() => '');
        console.error('Discord webhook error:', discordRes.status, text);
        return jsonResponse({ error: 'Failed to deliver message' }, 502);
      }
    } catch (e) {
      console.error('Discord webhook fetch failed:', e);
      return jsonResponse({ error: 'Failed to deliver message' }, 502);
    }

    return jsonResponse({ ok: true }, 200);
  },
};

/**
 * OriginヘッダーとRefererヘッダーの両方をチェックし、
 * 指定ドメイン（https://wait.3y.f5.si）以外からのアクセスを弾く。
 */
function isRequestFromAllowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin === ALLOWED_ORIGIN) return true;

  const referer = request.headers.get('Referer');
  if (referer && referer.startsWith(ALLOWED_ORIGIN)) return true;

  return false;
}

function handlePreflight(request) {
  const origin = request.headers.get('Origin');

  if (origin !== ALLOWED_ORIGIN) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    },
  });
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    },
  });
}

/**
 * @everyone / @here によるメンション誤爆防止と、
 * Discord embed descriptionの文字数上限（4096字）を超えないよう安全マージンを確保。
 */
function sanitizeForDiscord(text) {
  return text
    .replace(/@everyone/g, '@\u200beveryone')
    .replace(/@here/g, '@\u200bhere')
    .slice(0, 1900);
}
