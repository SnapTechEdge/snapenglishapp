// Cloudflare Pages Function: 問い合わせフォーム → Resend → support@snapenglishapp.com
//
// 環境変数:
//   RESEND_API_KEY: Resend の API Key (Cloudflare Pages → Settings → Environment variables で設定)
//
// 動作:
//   1. 運営宛て (support@snapenglishapp.com) にお問い合わせ内容を送信
//   2. ユーザーに自動返信メールを送信 (受付完了通知)

const FIELD_LIMITS = {
  email: 200,
  subject: 100,
  message: 5000,
};

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // 本ドメイン以外 (snapenglishapp.pages.dev やプレビュー URL) からは受け付けない。
    // 同じ内容が別ホストでも動くと、フォームの窓口が二重にできてしまう。
    // 手元の開発 (wrangler) は localhost なので通す。
    const host = (request.headers.get('host') || '').toLowerCase().split(':')[0];
    const allowedHost = host === 'snapenglishapp.com'
      || host === 'www.snapenglishapp.com'
      || host === 'localhost'
      || host === '127.0.0.1';
    if (!allowedHost) {
      return jsonError(403, 'bad_host', 'このホストからは受け付けていません');
    }

    // JSON パース
    let data;
    try {
      data = await request.json();
    } catch {
      return jsonError(400, 'invalid_json', 'リクエストボディの形式が不正です');
    }

    // JSON として読めても、オブジェクト以外 (null・配列・数値・文字列) はフォームの形ではない。
    // null はこの先のプロパティ参照で例外になるので弾く必要がある。それ以外は従来 missing_field
    // だったが、未入力ではなく形が違うので invalid_json に分ける。
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return jsonError(400, 'invalid_json', 'リクエストボディの形式が不正です');
    }

    // ハニーポット (bot 対策): website フィールドが埋まっていたら spam 扱いで「成功」を返す。
    // フォームからは空文字列しか来ないので、null と未指定を除いて文字列以外が入っていたら
    // 埋まっている扱いにする。文字列に変換して判定すると {"toString":null} のような値で
    // 例外になるため、変換せず型で分ける。
    const website = data.website;
    const websiteFilled = typeof website === 'string'
      ? website.trim() !== ''
      : website !== undefined && website !== null;
    if (websiteFilled) {
      return jsonOk();
    }

    // フォームから来る値はすべて文字列。null や数値が入っているのはフォーム経由ではないので、
    // .trim() で例外にして 500 を返すのではなく、未入力と同じ扱いにして必須チェックで弾く。
    const asText = (v) => (typeof v === 'string' ? v : '');
    const cfTurnstileResponse = asText(data.cfTurnstileResponse);

    // 必須チェック (subject も必須化)
    const trimmed = {
      email: asText(data.email).trim(),
      subject: asText(data.subject).trim(),
      message: asText(data.message).trim(),
    };
    if (!trimmed.email || !trimmed.subject || !trimmed.message) {
      return jsonError(400, 'missing_field', '名前・メールアドレス・件名・メッセージは必須です');
    }

    // 文字数制限 (各フィールド)
    if (trimmed.email.length > FIELD_LIMITS.email) {
      return jsonError(400, 'email_too_long', `メールアドレスが長すぎます (${FIELD_LIMITS.email} 文字まで)`);
    }
    // 半角の、メールアドレスに使える文字だけ。ブラウザを経ずに叩けるので
    // クライアントと同じ集合をこちらでも見る。ここでは落とさずに弾く
    // （削除すると別の宛先に化けるため）。
    if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~@-]+$/.test(trimmed.email)) {
      return jsonError(400, 'invalid_email', 'メールアドレスは半角で入力してください');
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

    // 名前と件名はメールの件名ヘッダー (`[お問い合わせ] 件名 - 名前`) に入るので、改行などの
    // 制御文字を通さない。ヘッダーを足される余地を残さないため。見るのは trim 後の値で、
    // 端の改行や空白は trim で落ちたあと、中に残っているものを弾く (黙って削って送らない)。
    // 1 行の入力欄は改行を落とすが、貼り付けでは U+2028 などが残り得るので画面からも来る。
    // 本文 (message) は改行が正しい入力なので対象にしない。
    // C0 と DEL に、行区切りとして扱われる U+0085・U+2028・U+2029 を足した集合。
    const CONTROL_CHARS = /[\u0000-\u001F\u007F\u0085\u2028\u2029]/;
    if (CONTROL_CHARS.test(trimmed.subject)) {
      return jsonError(400, 'invalid_characters', '件名に改行などの使えない文字が含まれています');
    }

    // 環境変数チェック
    if (!env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY is not configured');
      return jsonError(500, 'server_misconfigured', 'サーバー設定エラー (管理者に連絡してください)');
    }
    if (!env.TURNSTILE_SECRET_KEY) {
      console.error('TURNSTILE_SECRET_KEY is not configured');
      return jsonError(500, 'server_misconfigured', 'サーバー設定エラー (管理者に連絡してください)');
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    // Cloudflare Turnstile 検証
    if (!cfTurnstileResponse) {
      return jsonError(403, 'turnstile_missing', 'ボット対策の検証が完了していません。ページを再読み込みして再度お試しください。');
    }
    try {
      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET_KEY,
          response: cfTurnstileResponse,
          remoteip: ip,
        }),
      });
      const verifyJson = await verifyRes.json().catch(() => ({}));
      if (!verifyJson.success) {
        console.warn('Turnstile verify failed', verifyJson['error-codes']);
        return jsonError(403, 'turnstile_failed', 'ボット対策の検証に失敗しました。ページを再読み込みして再度お試しください。');
      }
    } catch (e) {
      console.error('Turnstile verify error', e);
      return jsonError(502, 'turnstile_error', 'ボット対策の検証中にエラーが発生しました。時間をおいて再度お試しください。');
    }
    const ua = request.headers.get('User-Agent') || 'unknown';

    // 1) 運営宛てメール (お問い合わせ通知)
    //    運営はこの通知から「Reply」してユーザーに返信するため from は support@ にする。
    //    reply_to はユーザーのメールアドレスを設定済みなので、Reply ボタンで直接ユーザーに届く。
    const adminMail = sendMail(env.RESEND_API_KEY, {
      from: 'SnapEnglish <support@snapenglishapp.com>',
      to: ['support@snapenglishapp.com'],
      reply_to: trimmed.email,
      subject: `[お問い合わせ] ${trimmed.subject}`,
      text: [
        `メールアドレス: ${trimmed.email}`,
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
    //    純粋な no-reply: reply_to を設定せず、Reply された場合は noreply@ に届いて bounce する。
    //    本文に「support@ 宛に新規メールで」と明記済み。
    //    日本語版 (index.html) と英語版 (en/index.html) が同じこのエンドポイントに送っており、
    //    送信者がどちらの言語を読むかは分からないので、件名と本文は日英併記にする。
    //    問い合わせ内容そのもの (件名・メッセージ) は 1 回だけ載せ、ラベルだけ併記する。
    const autoReply = sendMail(env.RESEND_API_KEY, {
      from: 'SnapEnglish <noreply@snapenglishapp.com>',
      to: [trimmed.email],
      subject: '【SnapEnglish】お問い合わせを受け付けました / We received your inquiry',
      text: [
        'このたびは SnapEnglish へお問い合わせいただきありがとうございます。',
        '以下の内容で受け付けました。担当者より追ってご返信いたします。',
        'なお、内容によっては返信までお時間をいただく場合がございます。',
        'お急ぎの場合はその旨をお知らせください。',
        '',
        'Thank you for contacting SnapEnglish.',
        'We have received your inquiry, shown below. A member of our team will get back to you.',
        'Depending on the nature of your inquiry, our reply may take some time.',
        'If your request is urgent, please let us know.',
        '',
        '────────────────────────',
        `件名 / Subject: ${trimmed.subject}`,
        '',
        'メッセージ / Message:',
        trimmed.message,
        '────────────────────────',
        '',
        'SnapEnglish サポートチーム / The SnapEnglish Support Team',
        'https://snapenglishapp.com',
        '',
        '※ このメールは自動送信です。返信される場合は support@snapenglishapp.com 宛にお送りください。',
        '※ お心当たりがない場合はお手数ですがこのメールを破棄してください。',
        '* This is an automated message. To reply, please send a new email to support@snapenglishapp.com.',
        '* If you did not send this inquiry, please discard this email.',
      ].join('\n'),
      html: autoReplyHtml(trimmed),
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

// 自動返信の HTML パート (text と両方渡すと Resend が multipart/alternative で送る)
// 文面は text 版と同じ。画像・外部 CSS・計測用の画像は入れない。
function autoReplyHtml(trimmed) {
  // 入力は要素の中身としてだけ入れる (属性値や URL には入れない)。
  const esc = (v) => v.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  // 改行はエスケープしてから <br> にする。white-space の効き方はメールソフトで
  // まちまちなので、そちらには頼らない。
  const escLines = (v) => esc(v).replace(/\r\n|\r|\n/g, '<br>');

  const text = 'margin:0 0 16px;';
  const label = 'margin:0 0 4px;font-size:13px;color:#5B646E;';
  // 長い連続文字で横に伸びないようにする (ユーザーが貼った URL など)。名前・件名・本文の
  // 3 か所すべてに効かせる。旧 Outlook はここを解釈できないので、下の mso 用の指定で補う。
  const brk = 'word-break:break-word;overflow-wrap:anywhere;';
  const wrap = `margin:0 0 16px;${brk}`;
  const rule = '<hr style="border:0;border-top:1px solid #DED7CB;margin:20px 0;">';

  return [
    '<!doctype html>',
    '<html lang="ja"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    // 明るい配色だけを用意しているので、ダークモードでの自動反転には任せない。
    '<meta name="color-scheme" content="light">',
    // 旧 Outlook は語の途中で折れないので、ユーザーの入力を入れる 3 か所だけ
    // break-all にする。Outlook 以外はこの中を読まない。
    '<!--[if mso]><style>.brk{word-break:break-all;}</style><![endif]-->',
    '</head>',
    '<body style="margin:0;padding:24px;background:#F1EDE6;color:#14191F;' +
      "font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',Arial,sans-serif;line-height:1.7;\">",
    // 外枠はテーブル。古い Outlook でも幅と余白が崩れないため。
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">',
    '<tr><td align="center">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;border-collapse:collapse;background:#FFFFFF;border:1px solid #DED7CB;border-radius:12px;">',
    '<tr><td style="padding:24px;">',
    `<p style="${text}">このたびは SnapEnglish へお問い合わせいただきありがとうございます。<br>`,
    '以下の内容で受け付けました。担当者より追ってご返信いたします。<br>',
    'なお、内容によっては返信までお時間をいただく場合がございます。<br>',
    'お急ぎの場合はその旨をお知らせください。</p>',
    `<p style="${text}">Thank you for contacting SnapEnglish.<br>`,
    'We have received your inquiry, shown below. A member of our team will get back to you.<br>',
    'Depending on the nature of your inquiry, our reply may take some time.<br>',
    'If your request is urgent, please let us know.</p>',
    rule,
    `<p style="${label}">件名 / Subject</p>`,
    `<p class="brk" style="${wrap}">${esc(trimmed.subject)}</p>`,
    `<p style="${label}">メッセージ / Message</p>`,
    `<p class="brk" style="margin:0;${brk}">${escLines(trimmed.message)}</p>`,
    rule,
    `<p style="${text}">SnapEnglish サポートチーム / The SnapEnglish Support Team<br>`,
    '<a href="https://snapenglishapp.com" style="color:#117954;">snapenglishapp.com</a></p>',
    '<p style="margin:0;font-size:12px;color:#5B646E;">',
    '※ このメールは自動送信です。返信される場合は support@snapenglishapp.com 宛にお送りください。<br>',
    '※ お心当たりがない場合はお手数ですがこのメールを破棄してください。<br>',
    '* This is an automated message. To reply, please send a new email to support@snapenglishapp.com.<br>',
    '* If you did not send this inquiry, please discard this email.</p>',
    '</td></tr></table>',
    '</td></tr></table>',
    '</body></html>',
  ].join('\n');
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
