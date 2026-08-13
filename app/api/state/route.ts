import { isAdmin, resolveRole } from "@/lib/auth/admin";
import { getOrCreateParticipantId } from "@/lib/auth/participant";
import { personalFor, snapshotFor } from "@/lib/session/service";
import type { ServerEvent } from "@/lib/types";

/**
 * SSE のフォールバック / curl デバッグ用。
 * - クライアントは画面ロック復帰時（visibilitychange）にここを叩いて即座に画面を治す
 * - `curl -sS http://localhost:3000/api/state` で状態を目視確認できる
 */
export async function GET(request: Request) {
  const participantId = await getOrCreateParticipantId();
  const role = resolveRole(request, await isAdmin());

  const payload: ServerEvent = {
    kind: "snapshot",
    state: snapshotFor(role),
    you: personalFor(participantId),
  };

  return Response.json(payload);
}
