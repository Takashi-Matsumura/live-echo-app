import { runtime } from "@/lib/session/runtime";
import { persistStateSync } from "@/lib/persistence";

/**
 * instrumentation.ts から呼ぶ。process.exit / process.once などの Node 専用
 * API を直接 instrumentation.ts に書くと、Turbopack がそのファイルを Edge
 * ランタイム向けにもビルドしようとして警告を出す（instrumentation.js は
 * Node/Edge 両対応のファイル扱いのため）。このファイルに分離し、呼び出し側
 * では動的 import 経由でしか触れないようにすることで警告を避ける
 * （公式ドキュメントの "Specifying the runtime" と同じ考え方）。
 */
export function registerShutdownHandlers(): void {
  const flushAndExit = () => {
    try {
      persistStateSync(runtime().store.get());
    } catch (err) {
      console.error("[live-echo] 終了時の永続化に失敗しました", err);
    }
    process.exit(0);
  };

  process.once("SIGINT", flushAndExit);
  process.once("SIGTERM", flushAndExit);
}
