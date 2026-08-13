import type { SessionState } from "@/lib/types";
import type { Broadcaster, Listener } from "@/lib/store/ports";

/**
 * next start は単一プロセスなので、in-process の購読者 Set で SSE を broadcast できる。
 * Vercel など複数インスタンス環境に載せ替える際はここを Pub/Sub 実装に差し替える。
 */
export function createBroadcaster(): Broadcaster {
  const listeners = new Set<Listener>();

  return {
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(state: SessionState) {
      // 配信中に unsubscribe されても壊れないよう、コピーを回す
      for (const listener of Array.from(listeners)) {
        listener(state);
      }
    },
    size: () => listeners.size,
  };
}
