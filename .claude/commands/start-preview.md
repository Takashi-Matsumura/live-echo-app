---
description: Cloudflare Workers プレビュー（Durable Object込みの実行環境）をバックグラウンドで起動
---

`npm run preview` で Cloudflare Workers のプレビュー環境を起動してください。

このアプリは投票状態・進行状態をすべて Durable Object（`SessionDO`）に持たせている。`next dev`（`/start-dev` や `npm run dev`）は Durable Object をシミュレートできず、ログインの Server Action すら失敗するため、状態が絡む画面（`/`・`/admin`・`/present`）を実際に動かして確認したいときは必ずこちらを使う。

## 手順

1. `package.json` の存在を確認する。無ければその旨を報告して止まる。
2. ロックファイルからパッケージマネージャを判定する（このプロジェクトは `package-lock.json` なので npm 固定）。
3. ポート 8787 を使用中のプロセスがあれば `lsof -i :8787` で確認し、既に `wrangler`/`opennextjs-cloudflare` の preview が起動済みなら再利用してよいか、別プロセスが握っているだけなら停止してよいか確認する。
4. ルート（`/Users/matsbaccano/projects/live-echo-app`）で `npm run preview` をバックグラウンドで起動する。
   - `opennextjs-cloudflare build && opennextjs-cloudflare preview` が走るため、ビルドに時間がかかる（初回は特に）。
   - 出力を監視し、`Ready on http://localhost:8787` の行が出るまで待機する。
5. `curl -sS http://localhost:8787/api/health` で `{"ok":true, ...}` を確認する。
6. 起動成功 / 失敗（ビルドエラー・ポート競合など）を1〜2行で報告する。

## 注意

- `next dev`（ポート 3000）とは別ポート（8787）なので、`/start-dev` が起動中でも併存できる。
- 状態は `.wrangler/` 配下の SQLite に永続化される。preview を再起動しても投票データ等は残る。データをまっさらにしたいときは管理画面の「全体をリセット」を使う（`.wrangler/` を直接消す必要はない）。
- コード変更を反映するにはビルドからやり直す必要がある（`next dev` のようなホットリロードは無い）。変更後は改めてこのコマンドで起動し直す。
- ログイン・投票などの Server Action は Durable Object のレート制限チェックを経由するため、`next dev` では例外になる。動作確認は必ずこちらで行う。
