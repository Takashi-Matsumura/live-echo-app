# セキュリティレビュー（全体） — 2026-10-14

対象: live-echo-app main ブランチ cf05695 時点。差分は無いためソース全体を確認。
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

## 対応状況（2026-10-14 追記）

本番の Cloudflare ファイアウォールイベント（10/12〜10/13 の 24 時間、45 件）を確認したところ、
React の RCE（CVE-2025-55182）を狙う POST が 13 IP 中 7 IP から届き、すべてマネージドルールで
ブロックされていた。Server Action の入口が日常的に狙われていることが分かったため、
所見 3・4 を最優先に引き上げて対応した。

| # | 状況 | 内容 |
|---|---|---|
| 1 | 対応済み | admin の SSE 接続を上限判定から除外 |
| 2 | 一部対応（別 PR） | `le_pid` を HMAC 署名付きにしてサーバ発行の ID だけを受け付ける。ID の発行は最初の投票時だけにし、Turnstile の検証と IP 単位の発行枠（1000 件 / 時）を条件にした。制限の対象を「投票リクエスト」から「ID の発行」に変えたことで、同じ IP の他の参加者を巻き込む問題を避けている。未対応: 1 設問あたりの回答数の上限、`voteBuckets` の期限切れ掃除、state の単一キー保存によるサイズ上限 |
| 3 | 対応済み（PR #38） | `next` を 16.3.8 に更新。`npm audit --omit=dev` は 0 件 |
| 4 | 対応済み（PR #38） | `workers_dev: false` |
| 5 | 対応済み | 出題中かつ非公開の設問は一覧・取得の両方で伏せる |
| 6 | 対応済み | `frame-ancestors 'self'` / `X-Frame-Options` / `nosniff` / `Referrer-Policy`。HSTS は `.dev` が TLD ごとプリロード済みのため追加していない |
| 7 | 一部対応 | ログイン試行のキーを IPv6 では /64 単位に丸めた（アドレスを変えるだけの迂回を防ぐ）。カウンタの永続化は未対応 |
| 8 | 一部対応 | `/api/state` に `no-store` を追加。他は未対応 |

残る設計上の課題: SessionState を 1 つのストレージ値に丸ごと保存しているため、回答が
大量に集まると 1 値あたりの上限に届きうる（上限値は未実測）。根本対応は設問ごとに
ストレージキーを分けること。所見 2 の再設計と合わせて扱う。

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
- **SSRF**: サーバ側の `fetch` は無し。`global_fetch_strictly_public` 有効。
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
