import { toPublicState } from "@/lib/session/projection";
import {
  applyCastVote,
  applyGoToAdjacentQuestion,
  applyHideAnswer,
  applyResetAll,
  applyResetQuestion,
  applySelectQuestion,
  applySetPhase,
  applySetRevealed,
  applyUnhideAnswer,
} from "@/lib/session/mutations";
import type {
  Phase,
  PersonalState,
  PublicState,
  Role,
  ServerEvent,
  SessionState,
  VoteResult,
} from "@/lib/types";

const VOTE_BROADCAST_DEBOUNCE_MS = 100;
const HEARTBEAT_INTERVAL_MS = 15_000;
const encoder = new TextEncoder();

type Listener = (next: SessionState) => void;

type Runtime = {
  state: SessionState;
  listeners: Set<Listener>;
  broadcastTimer: ReturnType<typeof setTimeout> | null;
};

/**
 * ★暫定の in-process 実装。globalThis + Symbol.for による状態の単一化。
 *
 * Next.js は Server Actions・Route Handler・Server Component をそれぞれ
 * 別バンドルにコンパイルすることがあり、このモジュールを import する側が
 * 複数あると、ただのモジュールスコープ変数（let state）では実体が分裂して
 * 状態が食い違う（実測で確認済み: /admin の Server Action 経由の更新が
 * /api/state の Route Handler から見えなかった）。Symbol.for キーの
 * globalThis を使えば、モジュールインスタンスが何個あっても実行時プロセスが
 * 同じである限り状態は1つに収束する。
 *
 * Cloudflare Workers は複数 isolate に分散するため、この仕組みは単一
 * プロセスの next dev / next start でのみ有効に機能する。Durable Object
 * 移行後は、この節（state・購読者 Set・デバウンスタイマー）がまるごと DO
 * クラスのインスタンスフィールドに置き換わる想定（DO は ID ごとに単一
 * インスタンスであることが保証されるため、この種のモジュール分裂は起きない）。
 * 状態遷移そのもの（mutations.ts）と結果開示の境界（projection.ts）は純粋
 * 関数のまま DO に持ち込めるよう、ここでは配線だけを担う。
 */
const RUNTIME_KEY = Symbol.for("live-echo.runtime");

function bootstrap(): Runtime {
  return {
    state: {
      rev: 0,
      activeQuestionId: null,
      phase: "idle",
      revealed: false,
      ballots: {},
      hidden: {},
      updatedAt: Date.now(),
    },
    listeners: new Set(),
    broadcastTimer: null,
  };
}

function runtime(): Runtime {
  const g = globalThis as unknown as { [RUNTIME_KEY]?: Runtime };
  return (g[RUNTIME_KEY] ??= bootstrap());
}

function publish(next: SessionState): void {
  // 配信中に unsubscribe されても壊れないよう、コピーを回す
  for (const listener of Array.from(runtime().listeners)) {
    listener(next);
  }
}

// broadcast のタイミングは操作の種類で分ける: 管理操作は即時、投票はまとめて
// （同時多発するのでデバウンスしないと無駄が多い）。
function broadcastNow(next: SessionState): void {
  const rt = runtime();
  if (rt.broadcastTimer) {
    clearTimeout(rt.broadcastTimer);
    rt.broadcastTimer = null;
  }
  publish(next);
}

function broadcastDebounced(): void {
  const rt = runtime();
  if (rt.broadcastTimer) clearTimeout(rt.broadcastTimer);
  rt.broadcastTimer = setTimeout(() => {
    rt.broadcastTimer = null;
    publish(rt.state);
  }, VOTE_BROADCAST_DEBOUNCE_MS);
}

// ── 読み取り ───────────────────────────────────────────────

export async function snapshotFor(role: Role): Promise<PublicState> {
  return toPublicState(runtime().state, role);
}

export async function personalFor(participantId: string): Promise<PersonalState> {
  const { state } = runtime();
  const questionId = state.activeQuestionId;
  if (!questionId) return { questionId: null, myAnswer: null };
  const answer = state.ballots[questionId]?.[participantId];
  return { questionId, myAnswer: answer ?? null };
}

/**
 * SSE 配信。将来 Durable Object に移設する前提で、フレーム生成・購読・
 * ハートビート・切断検知をすべてここに閉じ込める。呼び出し側
 * （app/api/stream/route.ts）は Cookie から role / participantId を解決して
 * 渡し、返ってきた ReadableStream をそのまま Response にするだけにする。
 *
 * ★Next.js 16.3 の実装を読んで確認した3つの落とし穴がすべてここに集約される。
 * 1. 同梱の gzip が text/event-stream にも掛かる → 呼び出し側で
 *    Cache-Control: no-transform を付けさせる（Workers 移行後は無害な no-op）。
 * 2. 最初の enqueue までヘッダが飛ばない → start() で同期的に必ず初期
 *    スナップショットを書く。DO に移設した後もこの制約は自然に保たれる
 *    （state はインスタンスフィールドなので同期読み取りのまま）。
 * 3. Proxy（旧 middleware）は globalThis を共有できない → 認証は呼び出し側
 *    （Route Handler）で完結させ、この関数には解決済みの role/participantId
 *    だけを渡す。
 */
export async function openEventStream(
  role: Role,
  participantId: string,
): Promise<ReadableStream<Uint8Array>> {
  const initialSnapshot = await snapshotFor(role);
  const initialYou = await personalFor(participantId);

  let cleanup = () => {};

  return new ReadableStream<Uint8Array>({
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
      sendEvent("snapshot", { state: initialSnapshot, you: initialYou });

      const listener: Listener = (raw) => {
        sendEvent("state", { state: toPublicState(raw, role) });
      };
      const rt = runtime();
      rt.listeners.add(listener);

      // ハートビート: (a) 書き込み失敗による切断検知、(b) AP/NAT のアイドル
      // タイムアウト回避、(c) iOS Safari が接続を停止扱いにするのを防ぐ。
      const heartbeat = setInterval(() => {
        write(`: hb ${Date.now()}\n\n`);
      }, HEARTBEAT_INTERVAL_MS);
      heartbeat.unref?.();

      cleanup = () => {
        if (closed) return;
        closed = true;
        rt.listeners.delete(listener);
        clearInterval(heartbeat);
      };
    },
    cancel() {
      cleanup();
    },
  });
}

// ── 参加者操作 ─────────────────────────────────────────────

export async function castVote(
  participantId: string,
  questionId: string,
  rawAnswer: string,
): Promise<VoteResult> {
  const rt = runtime();
  const { next, result } = applyCastVote(rt.state, participantId, questionId, rawAnswer);
  if (next) {
    rt.state = next;
    broadcastDebounced();
  }
  return result;
}

// ── 管理操作（すべて即時 broadcast） ─────────────────────────

export async function selectQuestion(questionId: string): Promise<void> {
  const rt = runtime();
  rt.state = applySelectQuestion(rt.state, questionId);
  broadcastNow(rt.state);
}

export async function goToAdjacentQuestion(dir: -1 | 1): Promise<void> {
  const rt = runtime();
  const next = applyGoToAdjacentQuestion(rt.state, dir);
  if (!next) return;
  rt.state = next;
  broadcastNow(rt.state);
}

export async function setPhase(phase: Phase): Promise<void> {
  const rt = runtime();
  rt.state = applySetPhase(rt.state, phase);
  broadcastNow(rt.state);
}

export async function setRevealed(revealed: boolean): Promise<void> {
  const rt = runtime();
  rt.state = applySetRevealed(rt.state, revealed);
  broadcastNow(rt.state);
}

export async function hideAnswer(questionId: string, participantId: string): Promise<void> {
  const rt = runtime();
  const next = applyHideAnswer(rt.state, questionId, participantId);
  if (!next) return;
  rt.state = next;
  broadcastNow(rt.state);
}

export async function unhideAnswer(questionId: string, participantId: string): Promise<void> {
  const rt = runtime();
  const next = applyUnhideAnswer(rt.state, questionId, participantId);
  if (!next) return;
  rt.state = next;
  broadcastNow(rt.state);
}

export async function resetQuestion(questionId: string): Promise<void> {
  const rt = runtime();
  rt.state = applyResetQuestion(rt.state, questionId);
  broadcastNow(rt.state);
}

export async function resetAll(): Promise<void> {
  const rt = runtime();
  rt.state = applyResetAll(rt.state);
  broadcastNow(rt.state);
}
