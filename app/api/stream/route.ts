import { isAdmin, refreshAdminSession, resolveRole } from "@/lib/auth/admin";
import { getOrCreateParticipantId } from "@/lib/auth/participant";
import { SESSION_FULL_ERROR } from "@/lib/session/errors";
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
  const actuallyAdmin = await isAdmin();
  // SSE 接続は数十分〜数時間おきに張り直される（ネットワーク切替・DO の
  // 退避など）ので、ここもアイドルタイムアウトの延長ポイントになる。
  if (actuallyAdmin) await refreshAdminSession();
  const role: Role = resolveRole(request, actuallyAdmin);

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = await openEventStream(role, participantId);
  } catch (err) {
    // DO 側の接続数上限（session-do.ts の MAX_SUBSCRIBERS）に達した場合。
    // 大量接続によるこの DO 単体への負荷を頭打ちにするための安全弁で、
    // 通常運用で踏むことは想定していない。
    if (err instanceof Error && err.message === SESSION_FULL_ERROR) {
      return new Response(null, { status: 503, headers: { "Retry-After": "30" } });
    }
    throw err;
  }

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
