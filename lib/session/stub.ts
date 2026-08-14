import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { SessionDO } from "@/lib/session/session-do";

/**
 * このアプリは1イベント=1セッションなので、DO の ID は固定名から導出する
 * （複数セッションを同時に扱う設計ではないため、参加者ごと・設問ごとに
 * 分ける必要はない）。
 */
const SESSION_ID = "live-echo";

/**
 * ★DO スタブ取得の唯一の入り口。呼び出しは必ず関数内（モジュールトップ
 * レベルではなく）で行う — getCloudflareContext をモジュールスコープで
 * 呼ぶと壊れる既知の問題（opennextjs-cloudflare#575）を踏まえた対策。
 *
 * wrangler の型生成は SESSION_DO を具体的なクラス型なしの
 * DurableObjectNamespace として出力するため、ここでキャストして
 * SessionDO のメソッドが型付きで呼べるようにする。
 */
export async function getSessionStub() {
  const { env } = await getCloudflareContext({ async: true });
  const namespace = env.SESSION_DO as unknown as DurableObjectNamespace<SessionDO>;
  return namespace.getByName(SESSION_ID);
}
