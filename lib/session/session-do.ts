import { DurableObject } from "cloudflare:workers";
import { sanitizePersistedState } from "@/lib/session/sanitize";
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
import { checkRateLimit, type RateLimitBuckets } from "@/lib/rate-limit";
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
const VOTE_LIMIT = 20;
const VOTE_WINDOW_MS = 60_000;
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 60_000;
const STATE_STORAGE_KEY = "state";

const encoder = new TextEncoder();

function initialState(): SessionState {
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

type Subscriber = {
  readonly role: Role;
  readonly write: (chunk: string) => void;
};

/**
 * ★セッションの状態・状態変更ロジック・SSE 配信をすべて1つの Durable Object
 * に集約する。DO は ID ごとに世界中で単一のインスタンスであることが
 * Cloudflare によって保証されるため、mutations.ts の「読む→計算する→
 * 差し替える」を await なしで行う限り、同時投票でも読み書きはアトミックに
 * なる（かつて lib/session/service.ts にあった不変条件がここに移設された）。
 *
 * 認証（Cookie の検証・発行）は Worker 側（Next.js）で完結させ、この DO は
 * 解決済みの role / participantId だけを受け取る。DO は Worker 経由でしか
 * 到達できないため、これを信頼してよい。
 */
export class SessionDO extends DurableObject<CloudflareEnv> {
  private state: SessionState = initialState();
  private subscribers = new Set<Subscriber>();
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private voteBuckets: RateLimitBuckets = new Map();
  private loginBuckets: RateLimitBuckets = new Map();

  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    // コンストラクタ完了まで他の呼び出しはキューイングされるため、
    // 各メソッド側で復元完了を個別に待つ必要はない。
    ctx.blockConcurrencyWhile(async () => {
      const persisted = await ctx.storage.get<unknown>(STATE_STORAGE_KEY);
      const sanitized = sanitizePersistedState(persisted ?? null);
      if (sanitized) this.state = sanitized;
    });
  }

  private personalFromState(state: SessionState, participantId: string): PersonalState {
    const questionId = state.activeQuestionId;
    if (!questionId) return { questionId: null, myAnswer: null };
    const answer = state.ballots[questionId]?.[participantId];
    return { questionId, myAnswer: answer ?? null };
  }

  private persist(state: SessionState): void {
    // await しない: mutator 内で await すると同時実行に割り込まれる窓ができる。
    // DO の出力ゲートが書き込み確定まで応答を保留するので永続性は保たれる。
    void this.ctx.storage.put(STATE_STORAGE_KEY, state).catch((err: unknown) => {
      console.error("[live-echo] DO storage への書き込みに失敗しました", err);
    });
  }

  /** broadcast のたびに role ごとに1回だけ projection・JSON化・エンコードする */
  private publish(state: SessionState): void {
    if (this.subscribers.size === 0) return;
    const frameByRole = new Map<Role, string>();
    for (const sub of Array.from(this.subscribers)) {
      let frame = frameByRole.get(sub.role);
      if (!frame) {
        const publicState = toPublicState(state, sub.role);
        frame = `event: state\ndata: ${JSON.stringify({ state: publicState })}\n\n`;
        frameByRole.set(sub.role, frame);
      }
      sub.write(frame);
    }
  }

  // 管理操作は即時、投票はまとめて配信・永続化する。
  private broadcastNow(state: SessionState): void {
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    this.publish(state);
    this.persist(state);
  }

  private broadcastDebounced(): void {
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.publish(this.state);
      this.persist(this.state);
    }, VOTE_BROADCAST_DEBOUNCE_MS);
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const frame = `: hb ${Date.now()}\n\n`;
      for (const sub of Array.from(this.subscribers)) sub.write(frame);
    }, HEARTBEAT_INTERVAL_MS);
  }

  /** 購読者がいなくなったら DO が退避できるようタイマーを止める */
  private maybeStopHeartbeat(): void {
    if (this.subscribers.size > 0) return;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── 読み取り ───────────────────────────────────────────────

  async snapshot(role: Role): Promise<PublicState> {
    return toPublicState(this.state, role);
  }

  async personal(participantId: string): Promise<PersonalState> {
    return this.personalFromState(this.state, participantId);
  }

  /**
   * SSE 配信。DO の state はインスタンスフィールドなので同期的に読める
   * （`start()` 内で同期的に最初のスナップショットを enqueue できる —
   * Next.js の Node サーバー実装で必要だった「ヘッダ flush 前に enqueue
   * しないと onopen が発火しない」という制約が、この構成では自然に守られる）。
   */
  async openEventStream(role: Role, participantId: string): Promise<ReadableStream<Uint8Array>> {
    const initialSnapshot = toPublicState(this.state, role);
    const initialYou = this.personalFromState(this.state, participantId);

    let cleanup = () => {};

    return new ReadableStream<Uint8Array>({
      // アロー関数でレキシカルスコープの this（DO インスタンス）を保つ。
      start: (controller) => {
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

        write("retry: 2000\n\n");
        sendEvent("snapshot", { state: initialSnapshot, you: initialYou });

        const subscriber: Subscriber = { role, write };
        this.subscribers.add(subscriber);
        this.ensureHeartbeat();

        cleanup = () => {
          if (closed) return;
          closed = true;
          this.subscribers.delete(subscriber);
          this.maybeStopHeartbeat();
        };
      },
      cancel: () => {
        cleanup();
      },
    });
  }

  // ── 参加者操作 ─────────────────────────────────────────────

  async castVote(participantId: string, questionId: string, rawAnswer: string): Promise<VoteResult> {
    if (!checkRateLimit(this.voteBuckets, `vote:${participantId}`, VOTE_LIMIT, VOTE_WINDOW_MS)) {
      return { ok: false, reason: "rate-limited" };
    }
    const { next, result } = applyCastVote(this.state, participantId, questionId, rawAnswer);
    if (next) {
      this.state = next;
      this.broadcastDebounced();
    }
    return result;
  }

  /** ログイン試行のレート制限。lib/auth/admin.ts の verifyPassword から呼ぶ */
  async checkLoginRate(key: string): Promise<boolean> {
    return checkRateLimit(this.loginBuckets, `login:${key}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  }

  // ── 管理操作(すべて即時 broadcast) ─────────────────────────

  async selectQuestion(questionId: string): Promise<void> {
    this.state = applySelectQuestion(this.state, questionId);
    this.broadcastNow(this.state);
  }

  async goToAdjacentQuestion(dir: -1 | 1): Promise<void> {
    const next = applyGoToAdjacentQuestion(this.state, dir);
    if (!next) return;
    this.state = next;
    this.broadcastNow(this.state);
  }

  async setPhase(phase: Phase): Promise<void> {
    this.state = applySetPhase(this.state, phase);
    this.broadcastNow(this.state);
  }

  async setRevealed(revealed: boolean): Promise<void> {
    this.state = applySetRevealed(this.state, revealed);
    this.broadcastNow(this.state);
  }

  async hideAnswer(questionId: string, participantId: string): Promise<void> {
    const next = applyHideAnswer(this.state, questionId, participantId);
    if (!next) return;
    this.state = next;
    this.broadcastNow(this.state);
  }

  async unhideAnswer(questionId: string, participantId: string): Promise<void> {
    const next = applyUnhideAnswer(this.state, questionId, participantId);
    if (!next) return;
    this.state = next;
    this.broadcastNow(this.state);
  }

  async resetQuestion(questionId: string): Promise<void> {
    this.state = applyResetQuestion(this.state, questionId);
    this.broadcastNow(this.state);
  }

  async resetAll(): Promise<void> {
    this.state = applyResetAll(this.state);
    this.broadcastNow(this.state);
  }
}
