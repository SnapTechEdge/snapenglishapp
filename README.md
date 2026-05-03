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

### ローカルプレビュー

```sh
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000` を開く。

### Tailwind CSS のビルド

HTML 内でクラスを変更したら、`tailwind.css` を再ビルドして commit する。

初回のみ:

```sh
npm install
```

ビルド（変更検出 + minify）:

```sh
npm run build
```

開発時に変更を watch:

```sh
npm run watch
```

ビルド結果 `tailwind.css` は git 管理対象（Cloudflare Pages にビルドステップが無いため）。
