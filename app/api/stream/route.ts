import { isAdmin, resolveRole } from "@/lib/auth/admin";
import { getOrCreateParticipantId } from "@/lib/auth/participant";
import { openEventStream } from "@/lib/session/service";
import type { Role } from "@/lib/types";

/**
 * SSE エンドポイント。フレーム生成・購読・ハートビートは
 * lib/session/service.ts の openEventStream() に閉じ込めてある
 * （Durable Object 移行後もこの Route Handler の形は変わらない想定）。
 * ここでの責務は Cookie から role / participantId を解決することだけ。
 *
 * role は isAdmin() だけでなく resolveRole() 経由で決める。le_admin Cookie
 * は path: "/" なので、講師が管理画面にログインした端末で参加者用の "/" を
 * 開くと isAdmin() が true になり、それだけを根拠にすると非公開の集計や
 * 伏せた自由記述まで見えてしまう（実測で確認済みのバグ）。詳細は
 * lib/auth/admin.ts の resolveRole() を参照。
 */
export async function GET(request: Request) {
  const participantId = await getOrCreateParticipantId();
  const role: Role = resolveRole(request, await isAdmin());

  const stream = await openEventStream(role, participantId);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform が Next 同梱の gzip を無効化する
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
