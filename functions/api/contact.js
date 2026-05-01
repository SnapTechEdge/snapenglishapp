// Cloudflare Pages Function: 問い合わせフォーム → Resend → support@snapenglishapp.com
//
// 環境変数:
//   RESEND_API_KEY: Resend の API Key (Cloudflare Pages → Settings → Environment variables で設定)
//
// 動作:
//   1. 運営宛て (support@snapenglishapp.com) にお問い合わせ内容を送信
//   2. ユーザーに自動返信メールを送信 (受付完了通知)

const FIELD_LIMITS = {
  name: 100,
  email: 200,
  subject: 100,
  message: 5000,
};

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // JSON パース
    let data;
    try {
      data = await request.json();
    } catch {
      return jsonError(400, 'invalid_json', 'リクエストボディの形式が不正です');
    }

    const { name = '', email = '', subject = '', message = '', website = '' } = data;

    // ハニーポット (bot 対策): website フィールドが埋まっていたら spam 扱いで「成功」を返す
    if (website.trim() !== '') {
      return jsonOk();
    }

    // 必須チェック (subject も必須化)
    const trimmed = {
      name: name.trim(),
      email: email.trim(),
      subject: subject.trim(),
      message: message.trim(),
    };
    if (!trimmed.name || !trimmed.email || !trimmed.subject || !trimmed.message) {
      return jsonError(400, 'missing_field', '名前・メールアドレス・件名・メッセージは必須です');
    }

    // 文字数制限 (各フィールド)
    if (trimmed.name.length > FIELD_LIMITS.name) {
      return jsonError(400, 'name_too_long', `名前が長すぎます (${FIELD_LIMITS.name} 文字まで)`);
    }
    if (trimmed.email.length > FIELD_LIMITS.email) {
      return jsonError(400, 'email_too_long', `メールアドレスが長すぎます (${FIELD_LIMITS.email} 文字まで)`);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed.email)) {
      return jsonError(400, 'invalid_email', 'メールアドレスの形式が正しくありません');
    }
    if (trimmed.subject.length > FIELD_LIMITS.subject) {
      return jsonError(400, 'subject_too_long', `件名が長すぎます (${FIELD_LIMITS.subject} 文字まで)`);
    }
    if (trimmed.message.length > FIELD_LIMITS.message) {
      return jsonError(400, 'message_too_long', `メッセージが長すぎます (${FIELD_LIMITS.message} 文字まで)`);
    }

    // 環境変数チェック
    if (!env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY is not configured');
      return jsonError(500, 'server_misconfigured', 'サーバー設定エラー (管理者に連絡してください)');
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ua = request.headers.get('User-Agent') || 'unknown';

    // 1) 運営宛てメール (お問い合わせ通知)
    const adminMail = sendMail(env.RESEND_API_KEY, {
      from: 'SnapEnglish Support <noreply@snapenglishapp.com>',
      to: ['support@snapenglishapp.com'],
      reply_to: trimmed.email,
      subject: `[お問い合わせ] ${trimmed.subject} - ${trimmed.name}`,
      text: [
        `名前: ${trimmed.name}`,
        `メール: ${trimmed.email}`,
        `件名: ${trimmed.subject}`,
        '',
        'メッセージ:',
        trimmed.message,
        '',
        '---',
        `IP: ${ip}`,
        `User-Agent: ${ua}`,
        `送信元: snapenglishapp.com の問い合わせフォーム`,
      ].join('\n'),
    });

    // 2) ユーザー宛て自動返信
    const autoReply = sendMail(env.RESEND_API_KEY, {
      from: 'SnapEnglish Support <noreply@snapenglishapp.com>',
      to: [trimmed.email],
      reply_to: 'support@snapenglishapp.com',
      subject: '【SnapEnglish】お問い合わせを受け付けました',
      text: [
        `${trimmed.name} 様`,
        '',
        'このたびは SnapEnglish へお問い合わせいただきありがとうございます。',
        '以下の内容で受け付けました。担当者より追ってご返信いたします。',
        '',
        '────────────────────────',
        `件名: ${trimmed.subject}`,
        '',
        'メッセージ:',
        trimmed.message,
        '────────────────────────',
        '',
        'なお、内容によっては返信までお時間をいただく場合がございます。',
        'お急ぎの場合はその旨をお知らせください。',
        '',
        '── SnapEnglish 運営チーム',
        'https://snapenglishapp.com',
        '',
        '※ このメールは自動送信です。返信される場合は support@snapenglishapp.com 宛にお送りください。',
        '※ お心当たりがない場合はお手数ですがこのメールを破棄してください。',
      ].join('\n'),
    });

    // 運営宛ては必須、ユーザー宛ては失敗してもスキップ
    const [adminResult, autoReplyResult] = await Promise.allSettled([adminMail, autoReply]);

    if (adminResult.status !== 'fulfilled' || !adminResult.value.ok) {
      const errMsg = adminResult.status === 'fulfilled' ? await adminResult.value.text() : adminResult.reason;
      console.error('Admin mail failed:', errMsg);
      return jsonError(502, 'mail_send_failed', 'メール送信に失敗しました。時間をおいて再度お試しください');
    }

    if (autoReplyResult.status !== 'fulfilled' || !autoReplyResult.value.ok) {
      // 自動返信失敗はログのみ (ユーザーには成功と返す)
      const errMsg = autoReplyResult.status === 'fulfilled'
        ? await autoReplyResult.value.text()
        : autoReplyResult.reason;
      console.warn('Auto-reply failed (continuing):', errMsg);
    }

    return jsonOk();
  } catch (error) {
    console.error('Unhandled error:', error);
    return jsonError(500, 'internal_error', 'サーバー内部エラー');
  }
}

// Resend API ラッパー
function sendMail(apiKey, payload) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

// レスポンスヘルパー
function jsonOk() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(status, code, message) {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
