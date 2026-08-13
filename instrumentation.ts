/**
 * Next.js の規約ファイル。next dev / next start の起動時に一度だけ呼ばれる。
 * - 環境変数の fail-fast 検証（ADMIN_PASSWORD / SESSION_SECRET 未設定なら
 *   開演直前ではなく起動直後に落とす）
 * - globalThis シングルトンの初回起動（data/session.json のロードもここで走る）
 * - SIGINT/SIGTERM で終了する前に、直近の状態を同期的にディスクへフラッシュ
 *
 * instrumentation.js は Node/Edge 両ランタイム向けにビルドされるファイル
 * 扱いなので、process.exit 等の Node 専用 API を直接ここに書くと Edge 向け
 * ビルドで警告になる。Node 専用ロジックは動的 import の先（lib/shutdown.ts
 * など）にすべて分離する。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { validateEnv } = await import("@/lib/env");
  const { runtime } = await import("@/lib/session/runtime");
  const { registerShutdownHandlers } = await import("@/lib/shutdown");

  validateEnv();
  runtime(); // 初回アクセスで bootstrap() が走り、永続化済み状態をロードする
  registerShutdownHandlers();
}
