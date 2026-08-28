import { isAdmin, refreshAdminSession } from "@/lib/auth/admin";
import { getAdminConnectionCount } from "@/lib/session/service";

/**
 * 「全端末ログアウト」ボタンのラベル表示用。現在 role: "admin" で SSE を
 * 開いている画面数（目安値。正確な端末数ではない — 詳細は
 * lib/session/session-do.ts の getAdminConnectionCount() コメント参照）を返す。
 * read-only なので TOTP は不要（app/api/admin/questions/export/route.ts と
 * 同じ isAdmin() ガードのみ）。
 */
export async function GET() {
  if (!(await isAdmin())) {
    return new Response(null, { status: 401 });
  }
  await refreshAdminSession();

  const count = await getAdminConnectionCount();
  return Response.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
