import type { SessionState } from "@/lib/types";
import type { StateStore } from "@/lib/store/ports";

/**
 * 純粋な in-memory 実装。Phase 0 では永続化を持たない。
 * JSON ファイルへのデバウンス永続化は Phase 5 で lib/session/runtime.ts 側から
 * このストアをラップする形で追加する（このファイル自体は変更しない想定）。
 */
export function createMemoryStore(initial: SessionState): StateStore {
  let state = initial;
  return {
    get: () => state,
    set: (next) => {
      state = next;
    },
  };
}
