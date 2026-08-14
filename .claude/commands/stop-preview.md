---
description: Cloudflare Workers プレビューを停止
---

`/start-preview` で起動した Cloudflare Workers プレビューを停止してください。

## 手順

1. バックグラウンド task のうち `npm run preview` / `opennextjs-cloudflare` / `wrangler dev`（preview はこれをラップしている）を含むものを TaskStop で停止する。
2. それでもポート 8787 を握っているプロセスがあれば `lsof -i :8787` で PID を特定し終了する。
3. 停止完了を1行で報告する。

## 注意

- `.wrangler/` 配下の状態（投票データ等）は停止しても消えない。次回 `/start-preview` で同じ状態から再開する。まっさらにしたい場合は管理画面の「全体をリセット」を使う。
