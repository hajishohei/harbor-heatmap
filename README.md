# HarboR Heatmap

SiteLead同等機能（ヒートマップ＋ポップアップ）の社内ツール。

- `app/` 管理画面（Vite + React、静的サイト）と計測タグのビルド
- `tracker/t.src.js` 計測タグ本体（ビルド時に `app/dist/t.js` へ出力）
- `sql/` Supabase（harbor-tool プロジェクト）のスキーマとRPC

## ビルド
```
cd app && npm install && npm run build
```
Vercel では Root Directory を `app`、Framework を Vite、Build Command を `npm run build`、Output を `dist` に設定する。
