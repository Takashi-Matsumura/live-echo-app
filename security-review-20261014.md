# セキュリティレビュー（全体） — 2026-10-14

対象: live-echo-app main ブランチ cf05695 時点。差分は無いためソース全体を確認。
対応状況は PR #38〜#42 のマージ・本番デプロイ後（main d78cc19）の内容に更新済み。所見の本文はレビュー時点の記述のまま残している。
前回: `security-review-20260820.md`。

## 総合評価

認証・認可・結果開示の設計は引き続き堅く、Critical / High に当たるコード上の欠陥は見つからなかった。
残っているのは (a) 無認証エンドポイント経由の可用性・集計の完全性、(b) 依存パッケージの更新、
(c) 多層防御（ヘッダー）の 3 系統。静的なコード読解のみで、実機での再現はしていない。

| # | Severity | 場所 | 種別 |
|---|---|---|---|
| 1 | Medium | `lib/session/session-do.ts:52,276` | SSE 上限が共通枠（講師の締め出し） |
| 2 | Medium | `lib/auth/participant.ts:6,16` / `session-do.ts:332` | 参加者 ID 自己申告による票の水増し・state 肥大 |
| 3 | Medium | `package.json`（`next` 16.3.0） | 既知脆弱性のある依存 |
| 4 | Low | `wrangler.jsonc:10` | workers.dev 経路がゾーンの WAF ルールを通らない |
| 5 | Low | `lib/session/mutations.ts:115-126` | 非公開に戻した後も `/api/results` で集計取得可 |
| 6 | Low | `next.config.ts:4` | セキュリティヘッダー未設定 |
| 7 | Low | `lib/session/session-do.ts:111,351` | パスワード試行制限が in-memory（前回 5 番） |
| 8 | Info | 複数 | 下記参照 |

## 対応状況（2026-10-14 追記・同日更新）

本番の Cloudflare ファイアウォールイベント（10/12〜10/13 の 24 時間、45 件）を確認したところ、
React の RCE（CVE-2025-55182）を狙う POST が 13 IP 中 7 IP から届き、すべてマネージドルールで
ブロックされていた。Server Action の入口が日常的に狙われていることが分かったため、
所見 3・4 を最優先に引き上げて対応した。

| # | 状況 | 内容 |
|---|---|---|
| 1 | 対応済み（PR #39） | admin の SSE 接続を上限判定から除外 |
| 2 | 対応済み（PR #40・#42） / 一部見送り | 下記「所見 2 の対応」参照。票の水増しは対応済み。`voteBuckets` の期限切れ掃除は PR #42。state の単一キー保存は運用で対応し、コード変更は見送った（下記「判断の記録」） |
| 3 | 対応済み（PR #38） | `next` を 16.3.8 に更新。`npm audit --omit=dev` は 0 件。開発依存（`eslint-config-next` 経由）の high 5 件は修正版が無く残っている |
| 4 | 対応済み（PR #38） | `workers_dev: false`。デプロイのトリガーが `pineville.dev` のみになったことは確認したが、workers.dev の URL が 404 になることは直接確認していない |
| 5 | 対応済み（PR #39） | 出題中かつ非公開の設問は一覧・取得の両方で伏せる |
| 6 | 対応済み（PR #39） | `frame-ancestors 'self'` / `X-Frame-Options` / `nosniff` / `Referrer-Policy`。HSTS は `.dev` が TLD ごとプリロード済みのため追加していない |
| 7 | 対応済み（PR #39・#42） | ログイン試行のキーを IPv6 では /64 単位に丸めた（PR #39）。カウンタを `ctx.storage` に永続化した（PR #42）。保持する IP は 1000 件までで、満杯時は記録の無い IP を共有の 1 枠で数える（下記「判断の記録」） |
| 8 | 対応済み（PR #39・#42） / 一部見送り | `/api/state` に `no-store`（PR #39）。管理系 Server Action の引数の実行時検証、資料 URL を `parsed.href` で保存（PR #42）。TOTP 初回登録前の窓と `/api/health` のメッセージは見送り（下記「判断の記録」） |

### 所見 2 の対応（PR #40）

最初は投票リクエストを IP 単位で制限する形で実装したが、識別手段が「書き換え可能な Cookie」と
「会場で共有される IP」だけでは、「1 IP の乱用を止める」と「同じ IP の他の参加者を巻き込まない」が
両立しなかったため取り下げ、次の形で設計し直した。

- `le_pid` を `<uuid>.<期限>.<HMAC>` にし、サーバが発行した期限内（12 時間）の ID だけを受け付ける。
  期限は署名に含めてサーバ側で判定する（Cookie の `maxAge` だけでは控えた ID を後日使い回せる）。
- ID の発行は最初の投票時だけ。閲覧だけの接続（`/api/stream` など）には発行しない。
- 発行時に Turnstile のトークンを要求し、サーバ側で siteverify により検証する。
- Turnstile を通った後に、IP 単位（IPv6 は /64）の発行枠 1000 件 / 時を消費する。
  制限の対象が「ID の発行」なので、正規の参加者が消費するのは 1 人 1 回だけで済む。

受け入れたリスク:
- Cookie を消して Turnstile を通し直せば、同じ人がもう 1 票入れられる（手作業の速度に抑えるのが狙い）。
- JS 無効のブラウザでは最初の 1 票を投じられない。
- 発行枠の Map は 1 万 IP で満杯になると最古のエントリを捨てる。1 万個の IP を使える相手は追い出しで
  自分の枠を戻せるが、そもそも IP 単位の枠では止まらない相手なので実害は増えない（満杯時に拒否すると
  同じ相手が以後の参加者を全員締め出せるため、こちらを選んだ）。
- カウンタは DO のインスタンスフィールドで、購読者ゼロの間の退避でリセットされる。

本番での確認（2026-10-14、Version `cd944f96`）:
- curl: トークンなし・署名なし Cookie の投票は `verification-required`、不正なトークンは
  `verification-failed` で ID 未発行、`/api/stream` `/api/state` は `le_pid` を発行しない。
- 実ブラウザ（ユーザー実施）: 管理画面ログイン、スマホからの 1 票目と再投票、
  管理画面のスマホプレビューからの投票。
- 未確認: IP 単位の発行枠に達したときの挙動（`busy`）、Turnstile の対話型チャレンジが出た場合の表示。

### 判断の記録（2026-10-14）

- **state の単一キー保存はコードを変えず、運用で対応する**（所見 2 の state 肥大の側面）
  - 前提: 参加者は 100 人程度、自由記述は少なめ（ユーザー確認）。
  - 見積もり: 選択式は 1 票数十バイトで、100 人 × 10 問でも 50 KB 程度。自由記述を全員が最大
    文字数（1000 文字、日本語で約 3 KB）で 2 問書いても 600 KB 程度。1 値あたりの上限
    （2 MB 程度と理解しているが未確認）に十分な余裕がある。
  - 意図的な水増しは PR #40 以降、1 ID ごとに Turnstile の通過が必要で、上限を埋めるコストは高い。
  - 運用: 回答はリセットするまで残り続けるため、イベントごとに結果 CSV を書き出してから
    「全体リセット」で回答を空にし、保存サイズを常に 1 イベント分に収める。
  - 見直す条件: 参加者が数百人を超える、長文の自由記述を中心に使う、リセットせずに複数イベントの
    データを残す、のいずれかに当たるとき。そのときは設問ごとにストレージキーを分ける。
    1 設問あたりの回答数の上限も同じタイミングで検討する。
- **ログイン試行の記録が満杯のときは共有枠で数える**（所見 7）
  - IP 単位の記録表が満杯になったときの扱いは 3 通りで、どれも弱点が残る。古い記録を捨てると、
    IP を順に使うだけで記録を追い出し、試行を際限なく続けられる。新しい IP を拒否すると、
    多数の IP から 1 回ずつ試すだけで全員を締め出せる。共有枠にすると、1000 個以上の IP を
    使った攻撃が続いている間は、記録の無い IP（管理者本人を含みうる）が締め出される。
  - 共有枠を選んだ。締め出しは攻撃中だけ（止まれば 1 分で戻る）、記録済みの IP には影響せず、
    パスワードの先に TOTP が控えているため。
  - 根本対応は、ログインの Server Action 内で Cloudflare Access のトークン
    （`Cf-Access-Jwt-Assertion`）を検証すること。現状の Access は `/admin*` のパスだけを守っており、
    Server Action は別のパス宛てにも送れるため、Access を通らずにパスワードを試せる。必要になったら
    別途対応する。
- **参加者 ID の発行枠が満杯のときは最古の記録を捨てる**（所見 2）
  - ログイン試行と逆の判断。発行枠の記録は Turnstile を通った IP にしか作られないため、追い出しで
    自分の枠を戻せる相手は 1 万個の IP で Turnstile を通せる相手に限られる。そうした相手には IP
    単位の枠がもともと歯止めにならず、実害は増えない。
- **`/api/stream` のレート制限ルールは 50 リクエスト / 10 秒にする**
  - ダッシュボードで確認したところ、ルールは設定済み（URI パスが `/api/stream`、IP 単位、ブロック、
    継続 10 秒、アクティブ）で、しきい値は 5 リクエスト / 10 秒だった。
  - 会場 Wi-Fi では参加者全員が同じ IP になりやすく、一斉の参加や再接続でこのしきい値を超え、
    設問の切り替えや結果の公開が画面に反映されなくなる恐れがある。これまでの利用は最大 35 名
    なので、ユーザーが 50 リクエスト / 10 秒に変更する。参加者が 50 名を超えるイベントでは事前に
    引き上げる（README に記載）。
- **TOTP 初回登録前の窓は見送る**（所見 8）: Cloudflare Access の内側にあり、README の運用手順
  （デプロイ直後に登録を済ませる）で塞いでいる。
- **`/api/health` のメッセージは見送る**（所見 8）: 出るのは環境変数の名前だけで、リポジトリが
  公開されているため名前はもともと見えている。
- **ビルド時の `SessionDO` 警告は対応しない**: `next build` 中に `initOpenNextCloudflareForDev()` が
  起動するローカルの miniflare が出しているもので、本番の Worker（`worker.ts` が export している）
  とは無関係。

### 未対応・残課題

- **ログイン処理の Access 化**: 上記「判断の記録」のとおり、必要になったら対応する。
- **本番の管理画面での動作確認**: PR #42 の変更（パスワード試行カウンタの永続化、管理系の引数検証、
  資料 URL の正規化）は、本番の管理画面で操作して確かめていない。

## 所見 2 の対応（PR #40）

最初は投票リクエストを IP 単位で制限する形で実装したが、識別手段が「書き換え可能な Cookie」と
「会場で共有される IP」だけでは、「1 IP の乱用を止める」と「同じ IP の他の参加者を巻き込まない」が
両立しなかったため取り下げ、次の形で設計し直した。

- `le_pid` を `<uuid>.<期限>.<HMAC>` にし、サーバが発行した期限内（12 時間）の ID だけを受け付ける。
  期限は署名に含めてサーバ側で判定する（Cookie の `maxAge` だけでは控えた ID を後日使い回せる）。
- ID の発行は最初の投票時だけ。閲覧だけの接続（`/api/stream` など）には発行しない。
- 発行時に Turnstile のトークンを要求し、サーバ側で siteverify により検証する。
- Turnstile を通った後に、IP 単位（IPv6 は /64）の発行枠 1000 件 / 時を消費する。
  制限の対象が「ID の発行」なので、正規の参加者が消費するのは 1 人 1 回だけで済む。

受け入れたリスク:
- Cookie を消して Turnstile を通し直せば、同じ人がもう 1 票入れられる（手作業の速度に抑えるのが狙い）。
- JS 無効のブラウザでは最初の 1 票を投じられない。
- 発行枠の Map は 1 万 IP で満杯になると最古のエントリを捨てる。1 万個の IP を使える相手は追い出しで
  自分の枠を戻せるが、そもそも IP 単位の枠では止まらない相手なので実害は増えない（満杯時に拒否すると
  同じ相手が以後の参加者を全員締め出せるため、こちらを選んだ）。
- カウンタは DO のインスタンスフィールドで、購読者ゼロの間の退避でリセットされる。

本番での確認（2026-10-14、Version `cd944f96`）:
- curl: トークンなし・署名なし Cookie の投票は `verification-required`、不正なトークンは
  `verification-failed` で ID 未発行、`/api/stream` `/api/state` は `le_pid` を発行しない。
- 実ブラウザ（ユーザー実施）: 管理画面ログイン、スマホからの 1 票目と再投票、
  管理画面のスマホプレビューからの投票。
- 未確認: IP 単位の発行枠に達したときの挙動（`busy`）、Turnstile の対話型チャレンジが出た場合の表示。

### 未対応・残課題

- **state の単一キー保存**（所見 2 の state 肥大の側面）: SessionState を 1 つのストレージ値に丸ごと
  保存しているため、回答が大量に集まると 1 値あたりの上限に届きうる（上限値は未実測）。PR #40 で
  ID の発行に Turnstile が要るようになり、大量の票を入れるコストは上がったが、上限そのものは無い。
  根本対応は設問ごとにストレージキーを分けること。1 設問あたりの回答数の上限、`voteBuckets` の
  期限切れ掃除も未対応。
- **パスワード試行カウンタの永続化**（所見 7）。
- **Info の残り**（所見 8）: TOTP 初回登録前の窓、`/api/health` のメッセージ、Server Action の
  実行時型検証、資料 URL の保存形式。
- **ビルド時の警告**: デプロイ時に「`SessionDO` が export されていない」と出るが、`next build` 中に
  `initOpenNextCloudflareForDev()` が起動するローカルの miniflare が出しているもので、本番の Worker
  （`worker.ts` が export している）とは無関係。対応しないと判断した。

## 所見

### 1. [Medium] SSE 接続上限が管理者と参加者で共通枠（無認証で講師を締め出せる）
- 場所: `lib/session/session-do.ts:52,276` / `app/api/stream/route.ts:19-29`
- `/api/stream` は無認証で、`MAX_SUBSCRIBERS = 1000` は role を区別しない。1000 本の接続を
  張り続けるだけで、参加者だけでなく管理画面・投影画面（role=admin）の SSE も 503 になる。
- README の WAF レート制限ルールは「接続試行の頻度」を抑えるもので、同時接続数は抑えない。
  ゆっくり張れば（例: 5 本/10 秒）30 分強で上限に届く。
- 推奨: admin は上限判定から除外するか予約枠を設ける。IP 単位の同時接続数上限も検討。

### 2. [Medium] 参加者 ID が自己申告で、投票レート制限を迂回できる（票の水増し・state 肥大）
- 場所: `lib/auth/participant.ts:6,16` / `app/actions.ts:24-26` / `lib/session/session-do.ts:332`
- `le_pid` は署名なしで、36 文字の `[0-9a-f-]` なら任意の値を受理する。レート制限は ID 単位
  （20 回/分）なので、リクエストごとに Cookie を変えれば無制限に投票できる。
- 影響:
  - 集計の改ざん（受付中の設問に対して）。
  - `ballots` と `voteBuckets`（期限切れの削除なし）が際限なく増える。state は単一キーに
    丸ごと保存しているため、自由記述（最大 1000 文字）を数千票入れられると DO ストレージの
    1 値あたり上限を超え、`persist()` が失敗し続ける恐れがある（上限値・挙動は未実測）。
  - 投票ごとに `ballots` を丸ごとコピーし全購読者へ再配信するため、CPU 負荷も票数に比例して増える。
- 前回 1 番の推奨（IP 単位の第 2 レート制限）が未対応。
- 推奨: `castVote` に `cf-connecting-ip` 単位の制限を追加。1 設問あたりの回答数に上限。
  `le_pid` を HMAC 署名付きにしてサーバ発行の ID しか受け付けない。期限切れバケットの掃除。

### 3. [Medium] `next` 16.3.0 に既知の脆弱性（npm audit: critical 2 / high 6 / moderate 1）
- `next`（直接依存）: 16.0.0〜16.3.7 が対象、修正版は 16.4.0（メジャー更新ではない）。
  報告されている内容は Image Optimization の RCE / SSRF、`next/og` の RCE、SSG/ISR の
  キャッシュ汚染、`use cache` と Draft Mode の漏えい、dev サーバの情報漏えいなど。
- このアプリは `next/image`・`next/og`・`use cache`・Draft Mode・ISR を使っておらず
  （grep で確認）、Windows ホストでもないため、多くは該当しない見込み。ただし
  `/_next/image` エンドポイント自体の有無や OpenNext 経由での挙動は未検証なので、
  「該当なし」とは断定しない。
- `wrangler` / `miniflare` / `undici` / `sharp` / `source-map-js`: ビルド・開発ツール側。
  `proxy-addr` / `qs` / `brace-expansion`: `@opennextjs/aws` 経由の推移的依存。
  いずれも `npm audit fix` で修正可能と表示されている。
- 推奨: `next` と `eslint-config-next` を 16.4.0 以上へ、`npm audit fix` を実行。

### 4. [Low] workers.dev 経路がゾーンの WAF ルールを通らない
- 場所: `wrangler.jsonc:10`（`workers_dev: true`）
- README の WAF レート制限ルールは `pineville.dev` ゾーンに設定するもので、
  `*.workers.dev` 側の同じ Worker には適用されない（Cloudflare の仕様としての理解。
  ダッシュボードでの実確認はしていない）。workers.dev の URL が知られると、
  所見 1・2 の攻撃がレート制限なしで通る。
- Cloudflare Access は README の手順で workers.dev 側にも設定する前提になっている。
- 推奨: フォールバックが不要な期間は `workers_dev: false` にする。

### 5. [Low] 「結果を非公開に戻す」後も `/api/results` で集計が取れる
- 場所: `lib/session/mutations.ts:115-126` / `lib/session/projection.ts:99-111` / `app/api/results/route.ts:25`
- `applySetRevealed(false)` は `revealedQuestionIds` から ID を外さない。公開→非公開に戻して
  受付を続けた場合、SSE 側は結果を伏せるが、`/api/results?questionId=...` はライブの集計
  （自由記述を含む）を返し続ける。「一度公開したら振り返れる」は意図された仕様だが、
  出題中の設問を非公開に戻したケースでは講師の操作と食い違う。
- 推奨: 出題中（`activeQuestionId` と一致）かつ `revealed === false` の設問は
  `resultsForQuestion` で null を返す。

### 6. [Low] セキュリティヘッダー未設定（前回 6 番が未対応）
- 場所: `next.config.ts:4`（`proxy.ts` / `middleware.ts` も無し）
- CSP / `frame-ancestors` / HSTS がコード上どこにも無い。管理画面は外部サイトの iframe に
  入れられる状態。
- 推奨: 管理画面が `/` を iframe で埋め込んでいる（`components/phone-preview.tsx`）ので、
  `DENY` ではなく `frame-ancestors 'self'`（または `X-Frame-Options: SAMEORIGIN`）。
  HSTS は Cloudflare 側でも可。

### 7. [Low] パスワード試行のレート制限が in-memory（前回 5 番が未対応）
- 場所: `lib/session/session-do.ts:111,351`
- DO 退避でリセットされ、IP を分散すれば試行数は増える。TOTP が第 2 要素として
  永続ロックアウト付きで控えているので実害は小さいが、TOTP 未登録の窓（下記 Info）の間は
  パスワードが唯一の防壁になる。

### 8. [Info]
- **TOTP 初回登録前の窓（前回 3 番）**: コード上は変わらず（`lib/auth/admin.ts:333-340`）。
  README に運用手順と Cloudflare Access での緩和が明記された。
- **`/api/health`**（`app/api/health/route.ts`）: 無認証で、未設定の環境変数名を含むメッセージを返す。
- **`/api/state`**（`app/api/state/route.ts:25`）: 管理者向けの未公開集計を返しうるが
  `Cache-Control: no-store` が無い（`/api/results` `/api/materials` には有る）。
- **Server Action の引数の実行時型**: `setPhase(phase)` などは TypeScript の型だけで、
  実行時の値検証が無い（`app/admin/actions.ts:69`）。管理者限定なので自傷の範囲。
  不正な phase を保存すると次回起動時に `sanitizePersistedState` が state 全体を初期化する。
- **資料 URL**: 検証は `new URL()` の結果で行い、保存・表示は元の文字列（`lib/materials/validate.ts:62`）。
  https 限定の判定は破れないが、`parsed.href` を保存する方が解釈差の余地が無い。

## 前回から改善された点
- 管理者セッション: 世代番号による全端末ログアウト、アイドル 2h / 絶対 12h、
  破壊的操作のステップアップ TOTP（`lib/auth/admin.ts`）。
- SSE 接続数にハードキャップ追加（ただし所見 1 の副作用あり）。
- CSV エクスポートの数式インジェクション対策（`lib/questions/results-export.ts:48-56`）。
- README に WAF / Cloudflare Access / TOTP 初回登録の運用手順を追加。

## 問題なしと確認した点
- **認可ゲート**: `app/admin/actions.ts` の全 Server Action に `assertAdmin()`（`login` / `logout` は
  意図的に無し）、admin API 3 本に `requireAdminApi()`、`/admin` `/presenter` に `requireAdmin()`。
- **管理者 Cookie**: HMAC 署名検証、定時間比較、httpOnly / secure / SameSite=Lax。
  `view` クエリは降格方向にしか効かない。
- **TOTP**: RFC 6238 実装、リプレイ防止、失敗カウンタの永続化、セッション発行は TOTP 通過後のみ。
- **結果開示**: `projection.ts` に集約。参加者には participantId を出さず、伏せた回答は除外。
- **XSS**: `dangerouslySetInnerHTML` 4 箇所はすべてサーバ生成の QR SVG（URL は QR 行列にしか
  使われず、ロゴは allowlist の MIME + base64）。回答テキストは React の通常レンダリング。
- **SSRF**: サーバ側の `fetch` は Turnstile の検証（`lib/auth/turnstile.ts`、PR #40 で追加）のみで、
  宛先は固定 URL、タイムアウト 5 秒。`global_fetch_strictly_public` 有効。
- **入力検証**: 投票は選択肢 ID の allowlist・要素数・文字数。インポートは全件検証・ID 再発行・256KB 上限。
  ロゴはマジックバイト判定・96KB 上限・nosniff・SVG 非対応。資料 URL は https 限定。
- **秘密情報**: `.env*` / `.dev.vars` は gitignore 済み。履歴・ソースにハードコードなし。
  CI ワークフロー（`.github`）は存在しない。

## 確認範囲

全行を読んだもの:
- `lib/auth/*`、`lib/session/*`（`stub` `errors` 含む）、`lib/env.ts`、`lib/rate-limit.ts`、
  `lib/questions.ts`、`lib/questions/transfer.ts`、`lib/questions/results-export.ts`、
  `lib/brand/validate.ts`、`lib/materials/validate.ts`、`lib/qr.ts`、`lib/qr-logo.ts`、`lib/form-action.ts`
- `app/actions.ts`、`app/admin/actions.ts`、`app/api/**` 全 9 ルート、`app/**/page.tsx`、`app/layout.tsx`
- `worker.ts`、`wrangler.jsonc`、`next.config.ts`、`open-next.config.ts`、`.gitignore`
- `components/` のうち `qr-panel` `materials-panel` `use-materials` `phone-preview`
  `text-answer-list` `export-link` `live-state-provider`、`app/admin/login/login-form.tsx`

未確認（「問題なし」ではない）:
- 上記以外の `components/*.tsx`（`admin-console` `admin-results` `question-row` 各種フォームなど）は
  危険な DOM 操作・`fetch`・`href` の grep のみで、全行は読んでいない。
- `lib/types.ts`、`lib/format.ts`、`lib/questions/seed.ts`、`content/questions.ts`、
  `scripts/load-test.mjs` の後半、`eslint.config.mjs`。
- `.env.local` / `.dev.vars` の中身（秘密情報のため開いていない）。
- Cloudflare ダッシュボード側の設定（WAF・Access・HSTS・Secrets の実値）。
- 実機での再現・ブラウザ確認は一切していない。特に、クライアント切断時に DO 側の購読が
  確実に解放されるか（解放されなければ所見 1 の上限に通常運用でも近づく）、
  state が大きくなったときの `storage.put` の挙動は未検証。
- `next` の各アドバイザリがこの構成（OpenNext + Workers）に実際に該当するかの個別検証。
