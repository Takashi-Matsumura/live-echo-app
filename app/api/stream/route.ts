import { isAdmin, resolveRole } from "@/lib/auth/admin";
import { getOrCreateParticipantId } from "@/lib/auth/participant";
import { personalFor, snapshotFor, subscribe } from "@/lib/session/service";
import type { PublicState, Role, ServerEvent } from "@/lib/types";

const encoder = new TextEncoder();
const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * ★SSE 配信。Next.js 16.3 の実装を読んで確認した3つの落とし穴がすべてここに
 * 集約される。
 *
 * 1. 同梱の gzip が text/event-stream にも掛かる
 *    (node_modules/next/dist/server/lib/router-server.js の compression() は
 *    全リクエストに適用され、text/^ 系はすべて圧縮対象になる。ストリームは
 *    Content-Length が無いので閾値回避も効かない)
 *    → Cache-Control に no-transform を入れて gzip を張らせない。
 *
 * 2. 最初の enqueue までヘッダが飛ばない
 *    (node_modules/next/dist/server/pipe-readable.js は res.flushHeaders() を
 *    ReadableStream の start ではなく最初の write の中で呼ぶ。start() で何も
 *    enqueue しないと EventSource の onopen が発火しない)
 *    → start() で同期的に必ず初期スナップショットを書く。
 *
 * 3. Proxy（旧 middleware）は globalThis を共有できない
 *    (docs/.../proxy.md: "you should not attempt relying on shared modules or
 *    globals")
 *    → 認証は Proxy に頼らず、この Route Handler 内で isAdmin() を直接呼ぶ。
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

  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // enqueue はストリームが閉じた後に呼ぶと throw する。
          // これをサーバ側の死活検知として使い、購読を解除する。
          closed = true;
          cleanup();
        }
      };

      const sendEvent = (name: ServerEvent["kind"], data: unknown) => {
        write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // 再接続間隔の指定を兼ねて、同期的に最初の1バイトを書く（落とし穴2の対策）。
      write("retry: 2000\n\n");

      // 初期スナップショット。再接続時はこれだけで完全に状態が復元される。
      sendEvent("snapshot", {
        state: snapshotFor(role),
        you: personalFor(participantId),
      });

      const unsubscribe = subscribe(role, (state: PublicState) => {
        sendEvent("state", { state });
      });

      // ハートビート: (a) 書き込み失敗による切断検知、(b) AP/NAT のアイドル
      // タイムアウト回避、(c) iOS Safari が接続を停止扱いにするのを防ぐ。
      // SSE のコメント行（: で始まる行）は EventSource 側で無視される。
      const heartbeat = setInterval(() => {
        write(`: hb ${Date.now()}\n\n`);
      }, HEARTBEAT_INTERVAL_MS);
      heartbeat.unref?.();

      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
      };
    },
    cancel() {
      cleanup();
    },
  });

  request.signal.addEventListener("abort", () => cleanup());

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform が Next 同梱の gzip を無効化する（落とし穴1の対策）
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
