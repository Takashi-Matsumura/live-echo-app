import { validateEnv } from "@/lib/env";
import { snapshotFor } from "@/lib/session/service";

/**
 * 開演前チェック用。ADMIN_PASSWORD / SESSION_SECRET が設定されているか、
 * 状態が読めるかを curl 一発で確認できる。
 */
export async function GET() {
  try {
    validateEnv();
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
  const state = await snapshotFor("admin");
  return Response.json({ ok: true, rev: state.rev });
}
