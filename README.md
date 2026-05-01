# snapenglish

`snapenglishapp.com` のソース。SnapEnglish アプリの公式サイト。

## 構成

- `index.html` — ランディングページ
- `privacy.html` — プライバシーポリシー
- `tokushoho.html` — 特定商取引法に基づく表記
- `terms.html` — 利用規約
- `CNAME` — カスタムドメイン (`snapenglishapp.com`)

## ホスティング

Cloudflare Pages にて GitHub 連携で自動デプロイ。
DNS / Email Routing も Cloudflare で管理。

## 開発

ビルド不要の純静的サイト。HTML を編集して push するだけ。

ローカルプレビュー:

```sh
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000` を開く。
