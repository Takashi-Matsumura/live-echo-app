import type { SessionState } from "@/lib/types";

/**
 * ★将来 Vercel（外部 KV 等）へ載せ替えるための境界。
 * lib/session/service.ts はこの2つのインターフェースにしか依存しない。
 * 差し替えは lib/store/index.ts の実装選択だけで完結させる。
 */

export type StateStore = {
  /** 現在の状態を同期的に返す。mutate の途中で await しないことが呼び出し側の不変条件 */
  get(): SessionState;
  /** 新しい状態に同期的に差し替える */
  set(next: SessionState): void;
};

export type Listener = (state: SessionState) => void;

export type Broadcaster = {
  /** 購読を開始し、解除関数を返す */
  subscribe(listener: Listener): () => void;
  /** 現在の購読者全員に配信する */
  publish(state: SessionState): void;
  /** 現在の購読者数（負荷確認・デバッグ用） */
  size(): number;
};
