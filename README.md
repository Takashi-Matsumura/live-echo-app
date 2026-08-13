# live-echo-app

セミナー会場向けのリアルタイムアンケートアプリ。講師が Mac Studio 等のローカルサーバから配信し、参加者はスマホのブラウザから QR コード経由で参加する。選択式・自由記述の設問に投票してもらい、講師が任意のタイミングで結果を公開・グラフ表示する。

Next.js 16.3 / React 19 / TypeScript / Tailwind CSS v4。外部サービス契約は不要（状態はサーバのメモリ + ローカル JSON のみ）。

## 開発

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) が参加者画面。`/admin` が管理画面（`.env.local` の `ADMIN_PASSWORD` でログイン）、`/present` が投影用画面。

設問は `content/questions.ts` に TypeScript で書く。管理画面からの CRUD は無く、当日は「どの設問を出題するか」を切り替えるだけ。

必須の環境変数（`.env.local`、初回セットアップ時に自動生成済み）:

- `ADMIN_PASSWORD` — 管理画面のログインパスワード。**本番運用前に必ず変更する**
- `SESSION_SECRET` — 管理者セッション Cookie の署名鍵
- `PUBLIC_BASE_URL`（任意）— QR / 投影画面の URL を自動検出した LAN IP から上書きしたいときに設定。Tailscale 経由の実機検証では必須（詳細は下記）

検証（完了を宣言する前に必ず実行する）:

```bash
npm run typecheck
npm run lint
```

## Tailscale での実機検証

会場に行かなくても、開発機（Mac）と手元のスマホを [Tailscale](https://tailscale.com/) の同じ Tailnet に繋げば、VPN 経由でスマホの実ブラウザから動作確認できる。当日の本番運用（トラベルルータ + 有線 LAN）とはネットワーク経路が別なので、あくまで開発中の実機検証用。

1. Mac とスマホの両方で Tailscale アプリを起動し、同じアカウント（同じ Tailnet）にログインして接続する。
2. Tailscale の Mac アプリ（メニューバーアイコン → Devices、または `tailscale ip -4`）で、**サーバを動かす Mac 自身**の Tailscale IP（`100.x.x.x` 形式）を確認する。
3. `.env.local` に控える。**自動検出（`lib/network.ts`）は Tailscale の `utun` インターフェースを意図的に除外している**ため、`PUBLIC_BASE_URL` で明示しないと QR / 投影画面が LAN 側の別 IP や `localhost` を指してしまう。

   ```bash
   # .env.local
   PUBLIC_BASE_URL=http://100.x.x.x:3000
   ```

4. `next dev` で検証する場合、`next.config.ts` の `allowedDevOrigins` に Tailscale の CGNAT レンジ用ワイルドカード `"100.*.*.*"` が含まれていることを確認する（同梱済み）。これが無いと dev アセット（HMR 等）がブロックされる。`next start`（本番ビルド）ならこの制約自体が無い。
5. `.env.local` / `next.config.ts` を変更したらサーバを再起動する（`Ctrl-C` → `npm run dev`）。
6. `/admin` にログインし、設問をどれも出題していない **idle 状態**にする（初回は何も選んでいなければ idle）。`/present` を開くと QR コードと URL テキストが Tailscale IP を指して表示される。
7. スマホのカメラで QR を読み取る。Tailscale 接続中なら、会場外・別ネットワークにいてもそのままアクセスできる。

**注意点**

- Tailscale 経由でも通信は `http://` のまま（Cookie は `secure: false` — アプリの通信自体は WireGuard で暗号化されているので実害はない）。
- Tailscale IP は基本的に固定だが、デバイスを Tailnet から一度外して入れ直すと変わることがある。QR が読めない場合は Tailscale アプリの Devices 一覧で IP を再確認する。
- **当日の本番運用はこの経路を使わない。** 参加者にアプリのインストールを求めるのは 50 人規模の運営には不向きなので、本番は次の「当日の運用手順」どおりトラベルルータ + 有線 LAN を使う。

## 当日の運用手順

### 事前準備

1. **トラベルルータを持ち込む。** 会場のゲスト WiFi は「クライアントアイソレーション（端末間通信の禁止）」が有効なことが多く、その場合スマホから Mac Studio に一切到達できない。自前のルータを持ち込み、Mac Studio をその LAN ポートに**有線接続**、参加者は同ルータの SSID へ接続してもらう。
2. ルータで **DHCP 予約**を入れるか、Mac 側で手動 IP（DHCP プール外）を設定して IP を固定する。
3. macOS のファイアウォールで `node` の受信を許可しておく（プロジェクタ接続中に許可ダイアログを見逃すと詰む）。

   ```bash
   sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$(which node)"
   sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$(which node)"
   ```

   「すべての受信接続をブロック」は必ずオフにする。この許可は node バイナリのパス・署名に紐づくので、nvm/Homebrew で Node を切り替えたら再度実行する。

4. `content/questions.ts` に当日の設問を書く。

### 起動

```bash
npm run build
caffeinate -dims npm start
```

- **本番は必ず `next build && next start`。`next dev` は使わない**（オンデマンドコンパイルで初回アクセスが遅く、本番と挙動も異なる）。
- `caffeinate -dims` で Mac のスリープ・ディスプレイ休止・ディスクスリープを、サーバプロセスが生きている間だけ抑止する。恒久的に切りたい場合は `sudo pmset -a sleep 0 displaysleep 0 disksleep 0`。
- ポートは既定で 3000 固定（`next start` は衝突時にハードエラーで落ちるため、QR の URL とズレる事故は起きない）。

### セッション中の禁止事項

- **リビルド禁止。** Server Action の ID はビルド成果物に紐づくため、セッション中に `next build` をやり直すと、開きっぱなしのページから投票が飛ばなくなる（`next start` の再起動だけなら問題ない）。

### 開演前チェック

1. 別デバイス（Mac 上の `curl localhost` は何も証明しない）から疎通確認:
   ```bash
   curl -sS -m3 http://<Mac の LAN IP>:3000/api/state
   ```
2. 当日と同じ SSID にスマホを繋ぎ、実際に QR から `/` を開いて投票できることを確認する。
3. `/present` を投影機に表示し、待機中は QR コードが出ることを確認する。

### 進行

1. `/admin` にログインし、出題する設問を選ぶ。
2. 参加者の回答を見ながら「受付を締め切る」。
3. 「結果を公開する」で全参加者・投影画面にグラフ / 回答一覧が出る。自由記述は公開前に目を通し、不適切な回答があれば「伏せる」で参加者・投影から除外できる。
4. 次の設問へ。「この設問をリセット」「全体をリセット」で回答を消せる。

### トラブル時

- 参加者のスマホが繋がらない → まずアイソレーションを疑う。会場 WiFi ではなく持ち込みルータの SSID に繋いでいるか確認。
- 画面ロック復帰後にグラフが止まって見える → 数秒で自動的に再接続・最新状態に復帰する（`visibilitychange` で即時フェッチ + SSE 再接続）。
- サーバを落としてしまった → `npm start` で再起動すれば `data/session.json` から状態が復元される。

## アーキテクチャ概要

- **配信**: `app/api/stream/route.ts` の Server-Sent Events（単一プロセス内の購読者 `Set` に broadcast）。
- **投票・管理操作**: Server Actions（`app/actions.ts`, `app/admin/actions.ts`）。
- **状態**: `lib/session/runtime.ts` が `globalThis` にシングルトンとして保持し、`data/session.json` にデバウンス永続化。将来 Vercel 等へ載せ替える場合は `lib/store/` の実装（`ports.ts` のインターフェース）を差し替えるだけでよい設計。
- **結果開示の境界**: `lib/session/projection.ts` の `toPublicState()` の1箇所だけ。UI 側で `revealed` を見て出し分けるのではなく、シリアライズ層で非公開データを落とす。
