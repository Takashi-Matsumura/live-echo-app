import { createStateStore, createBroadcaster } from "@/lib/store";
import type { StateStore, Broadcaster } from "@/lib/store";
import type { SessionState } from "@/lib/types";
import { loadPersistedStateRaw } from "@/lib/persistence";
import { sanitizePersistedState } from "@/lib/session/sanitize";

/**
 * ★globalThis + Symbol.for による状態の単一化。
 *
 * next dev の HMR だけでなく、instrumentation.ts は Next.js によって独立した
 * サーババンドルにコンパイルされるため、そこから import した本モジュールが
 * Route Handler が import するものと別のモジュールインスタンスになり得る。
 * Symbol.for キーの globalThis を使えば、モジュールインスタンスが何個あっても
 * 状態は1つに収束する。
 */
const RUNTIME_KEY = Symbol.for("live-echo.runtime");

export type Runtime = {
  readonly store: StateStore;
  readonly broadcaster: Broadcaster;
  /** 投票由来の broadcast をまとめる 100ms トレーリングデバウンス用タイマー */
  broadcastTimer: ReturnType<typeof setTimeout> | null;
};

function initialState(): SessionState {
  const persisted = sanitizePersistedState(loadPersistedStateRaw());
  if (persisted) return persisted;
  return {
    rev: 0,
    activeQuestionId: null,
    phase: "idle",
    revealed: false,
    ballots: {},
    hidden: {},
    updatedAt: Date.now(),
  };
}

function bootstrap(): Runtime {
  return {
    store: createStateStore(initialState()),
    broadcaster: createBroadcaster(),
    broadcastTimer: null,
  };
}

export function runtime(): Runtime {
  const g = globalThis as unknown as { [RUNTIME_KEY]?: Runtime };
  return (g[RUNTIME_KEY] ??= bootstrap());
}
