---
description: 開発サーバ（next dev）をバックグラウンドで起動
---

開発サーバ環境を起動してください。

## 手順

1. `package.json` の存在を確認する。無ければその旨を報告して止まる。
2. ロックファイルからパッケージマネージャを判定する（このプロジェクトは `package-lock.json` なので npm 固定）。
3. ポート 3000 を使用中のプロセスがあれば `lsof -i :3000` で確認し、停止するか 3001 を使うか判断して、どちらにしたかを報告する。
4. ルート（`/Users/matsbaccano/projects/live-echo-app`）で `npm run dev` をバックグラウンドで起動する。
   - 出力を監視し、`Ready in` の行が出るまで待機する。
5. `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/` で 200 を確認する。
6. 結果（起動成功 / 失敗 / ポート競合）を1〜2行で報告する。

## 注意

- **このアプリの状態は Durable Object（`SessionDO`）に持たせているため、`next dev` はそれをシミュレートできない。** ログインなど Server Action が Durable Object に触れる操作は例外になる。レイアウトや見た目の粗い確認にとどめ、実際に投票・進行させて動作確認したい場合は `/start-preview` を使う。
- 既に dev サーバが走っている場合（`Ready in` を含む task が活きている）は起動済みと判定し、新規起動しない。
