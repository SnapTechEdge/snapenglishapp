// Cloudflare Pages Function: 問い合わせフォーム → Resend → support@snapenglishapp.com
//
// 環境変数:
//   RESEND_API_KEY: Resend の API Key (Cloudflare Pages → Settings → Environment variables で設定)
//
// 使い方 (フロントエンドから):
//   fetch('/api/contact', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ name, email, subject, message })
//   })

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS は同一オリジンのみなので不要

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

    // 必須チェック
    if (!name.trim() || !email.trim() || !message.trim()) {
      return jsonError(400, 'missing_field', '名前・メールアドレス・メッセージは必須です');
    }

    // 簡易バリデーション
    if (name.length > 100) {
      return jsonError(400, 'name_too_long', '名前が長すぎます (100 文字まで)');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonError(400, 'invalid_email', 'メールアドレスの形式が正しくありません');
    }
    if (subject.length > 200) {
      return jsonError(400, 'subject_too_long', '件名が長すぎます (200 文字まで)');
    }
    if (message.length > 5000) {
      return jsonError(400, 'message_too_long', 'メッセージが長すぎます (5000 文字まで)');
    }

    // 環境変数チェック
    if (!env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY is not configured');
      return jsonError(500, 'server_misconfigured', 'サーバー設定エラー (管理者に連絡してください)');
    }

    // 送信元 IP (ログ用、簡易レート制限ヒントとして本文に含める)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ua = request.headers.get('User-Agent') || 'unknown';

    // Resend API でメール送信
    const subjectLine = subject.trim()
      ? `[お問い合わせ] ${subject.trim()} - ${name.trim()}`
      : `[お問い合わせ] ${name.trim()}`;

    const textBody = [
      `名前: ${name.trim()}`,
      `メール: ${email.trim()}`,
      `件名: ${subject.trim() || '(なし)'}`,
      '',
      'メッセージ:',
      message.trim(),
      '',
      '---',
      `IP: ${ip}`,
      `User-Agent: ${ua}`,
      `送信元: snapenglishapp.com の問い合わせフォーム`,
    ].join('\n');

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SnapEnglish Contact <noreply@snapenglishapp.com>',
        to: ['support@snapenglishapp.com'],
        reply_to: email.trim(),
        subject: subjectLine,
        text: textBody,
      }),
    });

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text();
      console.error('Resend API error:', resendResponse.status, errorText);
      return jsonError(502, 'mail_send_failed', 'メール送信に失敗しました。時間をおいて再度お試しください');
    }

    return jsonOk();
  } catch (error) {
    console.error('Unhandled error:', error);
    return jsonError(500, 'internal_error', 'サーバー内部エラー');
  }
}

// 簡素なヘルパー
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
