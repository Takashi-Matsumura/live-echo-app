# セキュリティレビュー（全体評価） — 2026-08-20

対象: live-echo-app（Cloudflare Workers + OpenNext + Durable Object）main ブランチ f34ff08 時点。
diff レビューではなくコードベース全体の確認・分析・評価。

## 総合評価

**この規模・用途のアプリとしてはセキュリティ設計の水準は非常に高い。** 認証・認可・入力検証・情報開示制御のいずれも「どこが唯一の関門か」が明確に設計され、コメントで意図が残されている。致命的（Critical/High）な欠陥は発見できなかった。以下は残存リスクと推奨事項。

## 確認できた強み

- **管理者認証**: HMAC-SHA256 署名 Cookie（`le_admin`、httpOnly / secure / SameSite=Lax / 12h TTL）。比較は SHA-256 固定長化 + `timingSafeEqual`（`lib/auth/constant-time.ts`）。
- **二要素認証（TOTP）**: RFC 6238 準拠の自前実装は正しく、リプレイ防止（`lastUsedStep`）、失敗カウンタの **DO storage 永続化**（退避を利用したペーシング攻撃対策、`session-do.ts:41-48`）、10回/15分のグローバルロックアウトあり。セッション発行は `attemptAdminLogin` 内部のみで TOTP 迂回経路が型レベルで存在しない。
- **認可ゲート**: 全 admin Server Action の先頭で `assertAdmin()`、admin ページは `requireAdmin()`、export API は `isAdmin()` で 401。漏れなし。
- **結果開示制御**: `lib/session/projection.ts` の 1 箇所に集約。参加者へは非公開時に counts/answers を一切送らず、自由記述の participantId は連番（`a0`…）に置換、伏せた回答は完全除外。
- **入力検証**: 投票は選択肢 ID の allowlist 照合・要素数上限・文字数上限。設問インポートは全件検証（1件でも不正なら全拒否）、id 再発行、256KB 上限。ロゴはマジックバイト判定・**SVG 意図的非対応**・96KB 上限・nosniff。
- **SSRF**: `global_fetch_strictly_public` フラグ有効。ユーザ制御の fetch 経路なし。
- **秘密情報**: `.env*` は gitignore 済み、コミット履歴に秘密なし。ランタイム解決（ブラケット記法でビルド焼き込み防止）。DO には TOTP シークレットの指紋のみ保存。
- **CSRF**: Server Actions の Origin 検査（Next.js 組み込み）+ SameSite=Lax。
- **XSS**: `dangerouslySetInnerHTML` は自前生成 SVG（属性エスケープ済み）のみ。回答テキストは React の通常レンダリング。
- **レート制限のキー**: `cf-connecting-ip` 最優先（クライアント偽装不可）。
- 依存が最小（uqr / next / react のみ）でサプライチェーン面も小さい。

## 残存リスクと推奨事項（優先度順）

### 1. [Medium] 票の水増し（ballot stuffing）
`le_pid` は自己発行の匿名 Cookie。Cookie を消して再接続すれば新しい participantId が無制限に得られ、投票レート制限（20回/分）は participantId 単位なので実質迂回可能。スクリプトで集計を歪められる。
**推奨**: 匿名投票アプリの構造的限界なので許容判断もあり得るが、安価な緩和として (a) `castVote` に cf-connecting-ip 単位の第2レート制限を追加、(b) Cloudflare WAF の Rate Limiting Rule を `/`・Server Action POST に設定、(c) 深刻なら Turnstile。

### 2. [Medium] SSE / 単一 DO への DoS
`/api/stream` は無認証で、全接続が単一の SessionDO に集まる。購読者数に上限がなく、大量接続で DO のメモリ・CPU・課金を圧迫できる。`voteBuckets` Map も participantId を増やされると退避まで単調増加。
**推奨**: (a) 購読者数のハードキャップ（例: 数千で 503）、(b) Cloudflare Rate Limiting Rule / Bot Fight Mode、(c) 期限切れバケットの定期削除。イベント運用時間外は影響が小さい点も考慮のこと。

### 3. [Medium-Low] TOTP 初回登録前の窓（TOFU）
初回登録前（および TOTP_SECRET ローテーション直後）は、**パスワードだけ知っていれば QR と manualSecret が取得でき、攻撃者側の Authenticator を登録できる**。その瞬間は実質1要素。
**推奨**: デプロイ/ローテーション直後に必ず自分で初回登録を完了させる運用を徹底（README 等に明記）。ADMIN_PASSWORD は十分に長いランダム値にする（この窓の間は唯一の防壁）。

### 4. [Low] 管理者セッションの失効手段がない
Cookie はステートレス HMAC で、盗まれた場合に個別失効できない（最大12時間有効）。
**推奨**: 現状の緊急対応は SESSION_SECRET のローテーション（全セッション無効化）であることを運用手順として明記。必要なら DO に「セッション世代番号」を持たせて即時失効を実装。

### 5. [Low] パスワード試行のレート制限は in-memory
`loginBuckets` は DO インスタンスフィールドで退避時にリセットされる（TOTP 側は永続化済みなのと対照的）。窓が60秒なので実害は小さいが、恒常的に 10回/分/IP の試行は可能（分散させれば増える）。
**推奨**: パスワードのエントロピーで担保する（20文字以上のランダム値なら十分）。より堅くするなら TOTP 同様の永続カウンタ化。

### 6. [Low] セキュリティヘッダーの不足
CSP / X-Frame-Options (frame-ancestors) / HSTS が未設定。SameSite=Lax と React の自動エスケープで主要リスクは既に低いが、多層防御として不足。
**推奨**: Cloudflare ダッシュボード（または Transform Rules）で HSTS を有効化。`next.config.ts` の `headers()` で `X-Frame-Options: DENY`（少なくとも /admin）、可能なら CSP を追加。

### 7. [Info] その他
- `/api/health` が未設定の環境変数名を含むエラーメッセージを返す（開演前チェック用途とのトレードオフ。気になるなら admin 限定に）。
- `workers_dev: true` により本番と workers.dev の2つの入口が常時開いている。フォールバック用途とのことだが、攻撃面が2倍になる点は認識しておく。
- QR の URL 生成は Host ヘッダー依存だが、Cloudflare のルーティングで Host が保証されるため実害なし。

## 未確認事項

- クライアントコンポーネント群（components/*.tsx）は XSS 経路（dangerouslySetInnerHTML）の grep 確認のみで、全行は読んでいない。
- 実環境（Cloudflare ダッシュボード側）の設定（WAF・HSTS・Secrets の実値・アクセス制御）はコードから確認できない。
- ブラウザでの動作確認はしていない。
