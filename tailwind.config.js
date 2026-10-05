/** @type {import('tailwindcss').Config} */
module.exports = {
  // 公開するページだけを対象にする。index-v2.html などの試作は含めない
  // （含めると、いまはどこからも使っていないクラスが生成物に残る）。
  content: [
    "./index.html", "./about.html", "./terms.html", "./privacy.html",
    "./tokushoho.html", "./404.html",
    "./en/index.html", "./en/about.html", "./en/terms.html",
    "./en/privacy.html", "./en/404.html",
  ],
  theme: {
    extend: {
      // トップページ（index.html の .sd トークン）と同じ色。
      // 下層ページは Tailwind で組んであるので、同じ値を名前付きで持たせて揃える。
      colors: {
        ivory:  '#F1EDE6',   // 地
        ivory2: '#E8E3D9',   // 表の見出しなど、地より少しだけ沈めたい面
        ink:    '#14191F',   // 見出し・強調
        ink2:   '#5B646E',   // 本文
        ink3:   '#2B333C',   // 濃いボタンのホバー
        rule:   '#DED7CB',   // 罫線
        accent: '#138A60',   // アクセント
        accent2:'#0F6E4C',   // アクセントの本文・ボタン（ivory 上で 4.5:1 を満たす）
        accent3:'#0B5A3D',   // そのボタンのホバー
        brand:  '#2E8752',   // ロゴの緑
      },
    },
  },
  plugins: [],
}
