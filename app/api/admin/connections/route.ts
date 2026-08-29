import { requireAdminApi } from "@/lib/auth/admin";
import { getAdminConnectionCount } from "@/lib/session/service";

/**
 * 「全端末ログアウト」ボタンのラベル表示用。現在 role: "admin" で SSE を
 * 開いている画面数（目安値。正確な端末数ではない — 詳細は
 * lib/session/session-do.ts の getAdminConnectionCount() コメント参照）を返す。
 * read-only なので TOTP は不要（requireAdminApi() のガードのみ）。
 */
export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const count = await getAdminConnectionCount();
  return Response.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
