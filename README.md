# live-echo-app

セミナー会場向けのリアルタイムアンケートアプリ。Cloudflare Workers 上で動き、参加者はスマホのブラウザから QR コード経由で参加する。選択式・自由記述の設問に投票してもらい、講師が任意のタイミングで結果を公開・グラフ表示する。

Next.js 16.3 / React 19 / TypeScript / Tailwind CSS v4 / Cloudflare Workers + Durable Objects（`@opennextjs/cloudflare`）。状態は Durable Object のストレージ（SQLite バックエンド）のみに持ち、外部のデータベースやキャッシュサービスは使わない。

## 開発

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) が参加者画面。`/admin` が管理画面（`.env.local` の `ADMIN_PASSWORD` でログイン）、`/present` が投影用画面。

設問は `/admin` の「設問一覧」タブから登録・編集・削除できる。実体は Durable Object のストレージで、初回起動時（まだ一度も管理画面で保存していない状態）だけ `content/questions.ts` の内容をシードとして使う。以後の再起動では管理画面での変更がそのまま保持され、`content/questions.ts` は参照されない。

必須の環境変数（`.env.local`、初回セットアップ時に自動生成済み）:

- `ADMIN_PASSWORD` — 管理画面のログインパスワード。**本番運用前に必ず変更する**
- `SESSION_SECRET` — 管理者セッション Cookie の署名鍵
- `TOTP_SECRET` — 管理画面ログインの二要素認証（TOTP）用シークレット。`node scripts/generate-totp-secret.mjs` で生成する。ローカルと本番で**別の値**を使うこと（同じ値だと Authenticator アプリのエントリが競合する）
- `PUBLIC_BASE_URL`（任意）— QR / 投影画面の URL を明示的に上書きしたいときに設定。未設定ならリクエストの Host ヘッダーから自動的に組み立てる。**`.env.local` に設定するとビルド時にその値が Cloudflare Worker バンドルへ静的に焼き込まれる**ため、実際の Cloudflare デプロイでは設定しないこと（Host ヘッダーからの自動検出が効かなくなる）。将来カスタムドメイン等で本番から上書きしたい場合は `.env.local` ではなく `wrangler.jsonc` の `vars` か Cloudflare ダッシュボードの環境変数で設定する

検証（完了を宣言する前に必ず実行する）:

```bash
npm run typecheck
npm run lint
```

**`next dev` の制約**: 状態管理は Durable Object（`lib/session/session-do.ts` の `SessionDO`）に集約されている。DO は現状 `next dev` ではローカルにシミュレートできない（wrangler 側の制約で、同一 Worker 内に定義した DO は別プロセスからは繋がらない）。`next dev` は画面のレイアウト確認程度に留め、状態が絡む動作は次の `npm run preview` で確認する。

## Cloudflare へのデプロイ

初回セットアップ（Cloudflare アカウントが必要）:

```bash
npx wrangler login
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TOTP_SECRET  # node scripts/generate-totp-secret.mjs の出力を貼る
```

`TOTP_SECRET` を設定（または `wrangler secret put` でローテーション）したら、**デプロイ直後に真っ先に自分でログインして二要素認証の登録を完了させる**こと。未登録の間はパスワードさえ合えば誰でも自分の端末を登録できてしまう窓が開いている（下記「認証」参照）。

ローカルで実際の Workers ランタイム（Durable Object 込み）を確認する:

```bash
npm run preview
```

`http://localhost:8787` で確認できる。DO のストレージはローカルの `.wrangler/` 配下に永続化されるので、preview を再起動しても状態は残る。

本番へデプロイ:

```bash
npm run deploy
```

初回デプロイ時、Cloudflare アカウントに `workers.dev` サブドメインが未登録だとデプロイが失敗する。その場合は表示される URL（`https://dash.cloudflare.com/<account-id>/workers/onboarding`）でサブドメインを登録してから再実行する。

本番公開ドメインは `https://pineville.dev`。Cloudflare Registrar で購入済みのゾーンを `wrangler.jsonc` の `routes`（`custom_domain: true`）で紐付けており、`npm run deploy` のたびに DNS/SSL 込みで自動的にプロビジョニングされる。`https://<worker名>.<サブドメイン>.workers.dev` も並行して有効なまま残る（フォールバック URL として利用可）。QR / 投影画面の URL は `PUBLIC_BASE_URL` を設定しなくてもリクエストの Host ヘッダーから自動的に `pineville.dev` を組み立てる。

`wrangler.jsonc` を変更した場合は `npm run cf-typegen` で `cloudflare-env.d.ts`（バインディングの型定義）を再生成する。

### プラン

Workers には Free と Paid（$5/月〜）があるが、**このアプリでは Paid が実質必須**。理由は下記の実測データを参照。バンドルサイズは Free の 3 MiB 制限に収まっているので、壁になるのは CPU 時間のみ。

### ダッシュボード側のセキュリティ設定（WAF / Cloudflare Access）

コードでは対応できない、Cloudflare ダッシュボード側での設定。`npm run deploy` とは独立しているためいつでも設定できるが、特に Access は TOTP 初回登録の窓を塞ぐ役割も兼ねるため、**本番公開前に設定しておく**のが望ましい。ゾーンは `pineville.dev` を例にする。

#### WAF レート制限ルール（`/api/stream` への接続フラッド対策）

`/api/stream`（SSE）は無認証で開けるため、大量接続の試行がこの1本の Durable Object に集中する DoS を Cloudflare 側で頭打ちにする。アプリ側の対策（`lib/session/session-do.ts` の `MAX_SUBSCRIBERS`、同時接続数の上限）と二重の防御になる。

1. ダッシュボード → 対象ゾーン → **Security → WAF → Rate limiting rules → Create rule**
2. Field=`URI Path`, Operator=`次と等しい`, Value=`/api/stream`
3. 「レートが次の値を超えた場合」: リクエスト数と期間を設定（例: 30リクエスト）
4. アクション: `ブロック`
5. 期間（ブロック継続時間）を設定

**Free プランでの制約（実際に踏んだ）**: レート判定の期間・ブロック継続時間の両方とも、選択肢が `10 秒` など短い値に限定されることがある（`1分`が選べない場合がある）。その場合は選べる期間に合わせてリクエスト数を比例調整すればよい（例: 30リクエスト/分の代わりに5リクエスト/10秒）。ブロック継続時間も短い値（10秒など）しか選べないことがあるが、それでも「超過するたびに短時間ブロックされ続ける」ことで持続的な接続フラッドは十分に抑えられる — 単に「一度捕まったら長時間締め出す」という懲罰的効果が弱いだけ。より長いブロックが必要な場合は上位プランへのアップグレードが必要。

また、Free プランのシンプルなルールには「何を基準にカウントするか」（Characteristics）の選択項目が出てこない場合がある。これは選び忘れではなく、**自動的にクライアントIPアドレス単位でカウントされる仕様**（ヘッダーやCookie値など別基準を選べるのは上位プラン向けの機能）。

#### Cloudflare Access（`/admin` `/present` の手前にもう1層認証を置く）

TOTP 未登録の間（初回デプロイ直後・`TOTP_SECRET` ローテーション直後）は、`ADMIN_PASSWORD` さえ知っていれば誰でも自分の端末をTOTPに登録できてしまう窓が開く（上記「初回セットアップ」参照）。Cloudflare Access でログインページ自体への到達をあらかじめ制限しておけば、この窓は構造的に閉じる。合わせて `le_admin` Cookie が万一漏れた場合の追加の防御層にもなる（`lib/auth/admin.ts` のセッション世代番号・ステップアップ認証と多層で防御する）。

1. **[one.dash.cloudflare.com](https://one.dash.cloudflare.com)**（通常のダッシュボードとは別の Zero Trust 専用画面）を開く。初回はチーム名の設定が必要
2. **Access → Applications → Add an application → Self-hosted**
3. 「宛先」に、保護したいパスをホスト名ごとに追加する（1アプリにつき最大5つ）:
   - `pineville.dev` / パス `admin*`
   - `pineville.dev` / パス `present*`
   - `<worker名>.<アカウントのサブドメイン>.workers.dev` / パス `admin*`
   - 同上 / パス `present*`

   `workers.dev` 側のURLは **Workers & Pages → 対象Worker → 「ドメイン」タブ**の「プロダクション」欄で確認できる（`wrangler.jsonc` で `workers_dev: true` にしているため、カスタムドメインと並行してこちらからも `/admin` に到達できてしまう。保護対象から漏らさないこと）。ホスト全体ではなく `admin*` / `present*` のパスだけを指定する — 参加者用の `/` はホスト単位では保護しない（保護すると参加者もアクセスできなくなる）。
4. **Policies → Add a policy**: Action=`許可`、Include=`Emails` に許可するメールアドレスを追加。保存。

**ハマりどころ（実際に踏んだ）**: ログイン方法として最初は「Cloudflare」（Cloudflareアカウント自体でのOAuthログイン）しか表示されない。これはこのアカウントの管理者向けにCloudflareが自動的に用意する選択肢で、**Policyに登録したメールアドレスが、実際にログインしているCloudflareアカウントの登録メールアドレスと完全一致していないと "That account does not have access." で弾かれる**。GitHub連携用に別のタグ付きメールアドレス（`foo+github@example.com` 等）でCloudflareアカウントを作っている場合は特に注意 — Policyの「含める」ルールに、実際にログインで使うメールアドレスを（複数あれば全部）追加すること。

独立したメール認証チャネルとして「One-time PIN」を使いたい場合は、Zero Trust ダッシュボード → **設定 → 認証** で明示的に有効化する必要がある（デフォルトでは出ないことがある）。「Cloudflare」アカウントでのOAuthログインでも実用上十分な強度はあるため、必須ではない。

設定後は `/admin` `/present` へのアクセスがまず Cloudflare Access のログイン画面（302リダイレクト）を経由し、通過後にアプリ本来のパスワード＋TOTPログイン画面に到達する2段構えになる。`curl -I https://pineville.dev/admin` で `302` が返り、`Location` が `cloudflareaccess.com` を指していれば設定成功。

## 運用

1. `/admin` にログインし、「設問一覧」タブから当日の設問を登録する（既に登録済みなら内容を確認・修正するだけでよい）。設問の追加・編集・削除は開演中でも行え、デプロイは不要。
2. 出題する設問を選ぶ。
3. 参加者の回答を見ながら「受付を締め切る」。
4. 「結果を公開する」で全参加者・投影画面にグラフ / 回答一覧が出る。自由記述は公開前に目を通し、不適切な回答があれば「伏せる」で参加者・投影から除外できる。
5. 次の設問へ。「この設問をリセット」「全体をリセット」で回答を消せる。**「全体をリセット」と設問インポートの「全て置き換え」は、確認のため認証コード（TOTP）の再入力を求める**（破壊的操作へのステップアップ認証。下記「認証」参照）。

`/present` を投影機のブラウザで開くと、待機中は常時 QR コードが表示される。参加者はスマホのカメラで QR を読み取るだけで `/` にアクセスできる（アプリのインストール等は不要）。

**投影画面から過去の結果を振り返る**: `/present` の見出し（「設問 X / Y」）の左右にある矢印アイコンで、これまでに結果を公開した設問（登録順）を行き来できる。管理画面を別タブで開いて操作する必要はなく、投影しているブラウザをマウスで直接クリックするだけでよい。最新（出題中）の設問まで進めると自動的にライブ表示へ戻る。参加者のスマホ画面（`/`）にも同様の「過去の結果を見る」導線があり、各自のタイミングで公開済みの設問を振り返れる。

**管理画面の「準備中／進行中」モード**: 管理画面ヘッダーのモード切替で、設問の編集・削除・データ入出力・全体リセット・全端末ログアウト・ブランド設定を「準備中」限定にできる。「進行中」では設問を出す・受付・結果公開・回答の伏せる/表示・QRコード表示・結果CSVエクスポートだけに絞られ、本番進行中に破壊的な操作へ誤って触れる導線を減らせる。この状態はブラウザの localStorage にのみ保存され（サーバには送らない）、認可・TOTP のチェックは弱めない——あくまで表示上のガードレール。

**管理者セッションの盗難に気づいたとき**: 管理画面の「準備中」モードに切り替え、「危険な操作」の「全端末ログアウト」を押すと、この端末を含め発行済みの管理者セッションを即座にすべて無効化できる（`wrangler secret put SESSION_SECRET` による再デプロイ不要）。次回は改めてパスワード＋認証コードでログインする。

**開演前チェック**: `curl https://<デプロイ先の URL>/api/health` で `{"ok":true, ...}` が返ることを確認する。

**リビルドに関する注意**: Server Action の ID はビルド成果物に紐づく。開演中に `npm run deploy` をやり直すと、開きっぱなしのページから投票が飛ばなくなることがある（新しいデプロイのたびにページを再読み込みしてもらう必要がある）。**設問の登録・編集・削除はこれに当たらない** — 管理画面から完結し、デプロイを挟まないため、開演中に設問を差し替えても参加者の画面は壊れない（出題中の設問を編集した場合、内容は SSE で参加者・投影画面にその場で反映される）。

**トラブル時**: 画面ロック復帰後にグラフが止まって見える場合は、数秒で自動的に再接続・最新状態に復帰する（`visibilitychange` で即時フェッチ + SSE 再接続）。サーバプロセスという概念が無い（Durable Object が状態を持ち続ける）ため、「サーバを落としてしまった」という事故は起きない。

**二要素認証（TOTP）でログインできないとき**:
- 認証コードが毎回ずれる → スマホの時刻自動設定を確認する（Authenticator アプリ側に「コードの時刻補正」機能がある場合はそれも試す）。サーバ側の時刻は関係ない
- 端末を紛失した → `npx wrangler secret put TOTP_SECRET` で新しいシークレットに差し替えて再デプロイすると、次回ログイン時に自動でQRコードが再表示される（登録し直しになる）
- シークレットをローテーションした → Authenticator アプリ側の**古いエントリを削除してから**新しいQRを読み取る（削除しないと同名エントリが2つ並び、どちらのコードを打っているか分からなくなる）
- 連続で間違えてロックされた → 15分待つ（`TOTP_STORAGE_KEY` に永続化されているため、`npm run preview` の再起動やデプロイのやり直しではロックは解除されない）

## アーキテクチャ概要

- **状態**: `lib/session/session-do.ts` の Durable Object（`SessionDO`）が `SessionState` をインスタンスフィールドとして保持し、DO 自身のストレージ（SQLite バックエンド）にデバウンス永続化する。
- **設問データ**: `SessionState` とは別のストレージキーに保存する。`SessionState` は投票のたびに SSE で全接続へ配信されるため、設問の追加・編集・削除で毎回配信し直す必要はない（出題中の設問が変わったときだけ配信する）。`lib/questions.ts` は設問リストを受け取る側の純粋関数だけを持ち、どこにも状態を持たない。
- **状態変更ロジック**: `lib/session/mutations.ts` に純粋関数として実装（`state -> 次の state` を返すだけで I/O を持たない）。`SessionDO` がこれを呼んで自分のフィールドを更新する。
- **配信**: 同じ Durable Object の中で SSE 購読者を管理し、状態が変わるたびに `event: state` を push する。
- **投票・管理操作**: Server Actions（`app/actions.ts`, `app/admin/actions.ts`）から `lib/session/service.ts`（DO への薄い RPC クライアント）経由で `SessionDO` のメソッドを呼ぶ。
- **結果開示の境界**: `lib/session/projection.ts` の `toPublicState()` の1箇所だけ。UI 側で `revealed` を見て出し分けるのではなく、シリアライズ層で非公開データを落とす。
- **`SessionDO` 内の責務分割**: 投票・出題進行など投票のたびに触るホットパスは `SessionDO` 本体（`lib/session/session-do.ts`）に残す一方、非ホットパスで独立したストレージキーを持つ機能はそれぞれ専用モジュールに切り出し、`SessionDO` からは薄い委譲メソッドで呼ぶ（Cloudflare の DO RPC は `SessionDO` 自身のメソッドしか外部から呼べないため、実体を切り出しても公開用の窓口は本体に残す必要がある）。ブランド設定（ロゴ）は `lib/session/brand-storage.ts` の `BrandLogoStore`、TOTP の登録状態・レート制限は `lib/session/totp-gate.ts` の `TotpGate` が持つ。
- **レート制限**: 投票（`castVote`）・パスワードログイン試行（`checkLoginRate`）は `SessionDO` のインスタンスフィールド（`lib/rate-limit.ts` の `checkRateLimit()` を使う固定窓カウンタ）で一元管理する。Workers は複数 isolate に分散するため、Next.js 側のモジュールスコープにカウンタを置くと isolate ごとに別集計になってしまう。すべてのリクエストが最終的に同じ DO を経由することを利用し、DO 側に寄せてある。**TOTP コードの失敗カウンタだけは例外的に `ctx.storage`（SQLite）に永続化**している（`lib/session/totp-gate.ts` の `TotpGate`）。6桁コード（100万通り）は in-memory カウンタでは守り切れない — DO は購読者ゼロで短時間退避するため、攻撃者が「数回試す→退避を待つ→また数回」を繰り返すとインスタンスフィールドのカウンタはリセットされてしまう。
- **認証**: 管理者セッションは HMAC 署名付き Cookie（`lib/auth/admin.ts`）。Cloudflare は HTTPS のみのため Cookie は `secure: true`。ログイン試行のレート制限キーには、クライアントが偽装できない `cf-connecting-ip`（Cloudflare が付与）を最優先で使う。パスワード検証に加えて TOTP（`lib/auth/totp.ts`、RFC 6238）による二要素認証を必須にしている（`lib/auth/admin.ts` の `attemptAdminLogin()`）:
  - シークレット自体は `TOTP_SECRET` 環境変数のみに存在し、DO には **sha256 で切り詰めた指紋**（`totpSecretFingerprint()`）だけを保存する。パスワード正解かつ未登録（または指紋不一致）ならログイン画面にQRコードを自動表示し、Authenticator アプリへの登録を促す。登録済みならQRは出さずコード入力のみを求める
  - **端末紛失時の復旧経路**は `ADMIN_PASSWORD`/`SESSION_SECRET` と同じ操作性: `wrangler secret put TOTP_SECRET` で値を差し替えて再デプロイするだけでよい。次回ログイン時に指紋が一致しなくなり、自動的にQRが再表示される
  - **意図的な割り切り**: 未登録の間（初回デプロイ直後・シークレットローテーション直後）は、パスワードを知っている者なら誰でも自分の端末を登録できてしまう。デプロイ後すぐに登録を完了させ、この窓を閉じる運用を前提にしている
- **管理者セッションの多層防御**（`lib/auth/admin.ts`）: `le_admin` Cookie は改ざん防止の署名だけでなく、盗難対策として3つの仕組みを持つ。
  - **アイドルタイムアウト + 絶対TTL**: Cookie は `iat.exp.gen.mac`（発行時刻・失効時刻・セッション世代番号・署名）の4パート構成。管理操作（Server Action）や状態同期（`/api/state`・`/api/stream`）のたびに失効時刻が2時間先まで延長される（`refreshAdminSession()`）が、発行から12時間を超えると操作を続けていても必ず失効する
  - **全端末ログアウト（キルスイッチ）**: DO 側に持つ「管理者セッション世代番号」（`SessionDO.revokeAdminSessions()`）を1つ進めるだけで、既発行の Cookie が署名付きでも即座に全部無効になる。`wrangler secret put SESSION_SECRET` による全体ローテーション（再デプロイが要る）より即効性がある
  - **破壊的操作へのステップアップ認証**: 「全体をリセット」・設問インポートの「全て置き換え」は、Cookie の有効性に加えてその場での TOTP コード再入力を要求する（`assertAdminWithTotp()`）。Cookie だけが盗まれても、被害を閲覧や小さな操作程度に抑える
- **`/api/stream` の同時接続数上限**（`lib/session/session-do.ts`）: SSE エンドポイントは無認証で開けるため、大量接続がこの DO 単体に集中する DoS を防ぐ安全弁として、同時購読者数の上限（`MAX_SUBSCRIBERS = 1000`）を設けている。上限に達すると `503`（`Retry-After: 30`）を返す。あわせて Cloudflare ダッシュボード側で `/api/stream` への接続試行そのものを頻度制限する Rate Limiting Rule の設定を推奨する（`security-review-20260820.md` 参照）

### SSR + SSE の仕組み

このアプリの画面更新は「初回表示」と「その後の同期」で経路を分けている。

1. **初回表示（SSR）**: `/`・`/present`・`/admin` はいずれも Server Component で、リクエスト時点の状態をサーバ側でレンダリングして返す。参加者・投影・管理のどの画面を開いても、JS 実行を待たずに「今の設問・今の集計」がそのまま HTML に載って届く。
2. **以降の同期（SSE）**: 初回表示後、クライアントは `EventSource` で `app/api/stream/route.ts` の `GET /api/stream` に接続する。この Route Handler は Cookie から role / participantId を解決するだけで、実際のストリーム生成は `SessionDO.openEventStream()` に委譲する。DO はコネクションを閉じずに保持し続け、状態が変わるたびに購読者へ `event: state` を push する。接続直後には `event: snapshot` で現在の全状態を1回送るため、ポーリングなしで新規参加者も既存参加者も同じ状態に揃う。
3. **書き込みは別経路**: 投票や管理操作（受付締切・結果公開・伏せる、等）は SSE のコネクションを使わず、通常の Server Actions（`app/actions.ts`, `app/admin/actions.ts`）＝ POST リクエストとして送る。SSE は「サーバ → クライアント」の一方向 push 専用で、書き込みには使っていない。

まとめると、初回は SSR で state を埋め込み、以後は SSE で差分を push、書き込みは Server Actions という3経路の組み合わせ。

### Durable Object を使う理由

Cloudflare Workers は複数の isolate に分散して実行されるため、素朴なモジュールスコープの変数や `globalThis` シングルトンでは、リクエストによって別々の実体を見てしまう（移行作業中に実測で確認した不具合: Server Action 経由の状態更新が別の Route Handler からは古いまま見える、というモジュール分裂が発生した）。

Durable Object は「ID ごとに世界中で単一のインスタンスであることが Cloudflare によって保証される」というプリミティブで、この問題を解決する。このアプリは1回のセミナー = 1セッションなので、固定名から導出した ID の DO を1つだけ使う（`lib/session/stub.ts`）。DO は単一スレッドで実行されるため、`mutations.ts` の「読む → 計算する → 差し替える」の間に `await` を挟まなければ、同時に飛んでくる複数の投票リクエストでも読み書きはアトミックになる（Node.js の単一スレッド性に頼っていた旧来の実装と、成立する理由は同じ）。

状態の永続化も DO 自身のストレージ（SQLite バックエンド、Free プランでも利用可）に任せている。DO がメモリから退避されても、次のリクエストでコンストラクタが `blockConcurrencyWhile()` を使って復元処理を行うため、明示的なファイル I/O や外部データベースは不要。

### WebSocket との違い

似た用途で候補に挙がる WebSocket と比べると、このアプリの要件には SSE の制約がそのまま利点になる。Cloudflare Workers は WebSocket の Hibernation API（接続を保持したまま DO をメモリから退避できる仕組み）も提供しているが、このアプリが必要とするのは「参加者の投票を集計してサーバから全員に配る」というサーバ発の一方向 push だけなので、SSE で要件を満たせている。

| | SSE（採用） | WebSocket |
|---|---|---|
| 通信方向 | サーバ → クライアントの一方向のみ | 双方向（全二重） |
| プロトコル | 通常の HTTP（`text/event-stream`）。`curl` でも中身を覗ける | `ws://` への Upgrade が必要な別プロトコル |
| 再接続 | ブラウザの `EventSource` が自動で再試行（`retry:` で間隔も指定可能） | 自前で再接続ロジックを実装する必要がある |
| クライアント→サーバ送信 | 別チャネル（このアプリでは Server Actions の POST）が必要 | 同じコネクション上で送れる |

クライアントからの書き込みは投票・管理操作という別種のリクエストとして扱えば十分だったため、双方向の常時コネクションを持つ WebSocket ではなく、素の HTTP で完結し自動再接続も標準搭載の SSE を選んでいる。

## Free プラン vs Paid プランの CPU 時間実測

`@opennextjs/cloudflare` でビルドし、`*.workers.dev` にデプロイして `wrangler tail --format json` で実測した `/`（参加者画面の SSR）への CPU 時間。

**Workers Free**（上限 10ms/呼び出し）

| # | CPU時間 |
|---|---|
| 1 | 65ms |
| 2 | 111ms |
| 3 | 23ms |
| 4 | 10ms |
| 5 | 122ms |
| 6 | 9ms |

**Workers Paid**（上限 30秒/呼び出し、$5/月〜）

| # | CPU時間 | 結果 |
|---|---|---|
| 1 | 150ms | ok |
| 2 | 191ms | ok |
| 3 | 11ms | ok |
| 4 | 10ms | ok |
| 5 | 17ms | ok |
| 6 | 194ms | ok |
| 7 | 130ms | ok |
| 8 | 9ms | ok |
| 9 | 179ms | ok |
| 10 | 14ms | ok |

コールドスタート時の CPU コストは Free/Paid で変わらず 100〜200ms 程度かかる（isolate が新規に立ち上がるたびに発生し、ウォームな場合は 9〜17ms まで下がる）。Free の 10ms/呼び出しという上限はこのコールドスタートコストに対して非現実的で、超過すると `Error 1102` が返る。Paid はデフォルトで上限が 30 秒に緩和されるため、CPU コストの実測値自体は変わらないが、超過によるエラーは発生しなくなる。**このアプリを Cloudflare Workers 上で動かすには Workers Paid が実質必須**という結論に至った。

バンドルサイズは gzip 後 約1.06 MiB で、Free の 3 MiB 制限には十分な余裕があった（Paid の壁は CPU 時間のみ）。

## ライセンス

[MIT](./LICENSE)
