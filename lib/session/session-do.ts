import { DurableObject } from "cloudflare:workers";
import { sanitizePersistedQuestions, sanitizePersistedState } from "@/lib/session/sanitize";
import { toPublicState } from "@/lib/session/projection";
import {
  applyCastVote,
  applyChoicesRemoved,
  applyHideAnswer,
  applyQuestionRemoved,
  applyResetAll,
  applyResetQuestion,
  applySelectQuestion,
  applySetPhase,
  applySetRevealed,
  applyUnhideAnswer,
  bumpRev,
} from "@/lib/session/mutations";
import { seedQuestions } from "@/lib/questions/seed";
import { checkRateLimit, type RateLimitBuckets } from "@/lib/rate-limit";
import type {
  BrandLogo,
  BrandLogoMeta,
  BrandLogoMime,
  Phase,
  PersonalState,
  PublicState,
  Question,
  Role,
  ServerEvent,
  SessionState,
  ValidatedQuestionData,
  VoteResult,
} from "@/lib/types";

const VOTE_BROADCAST_DEBOUNCE_MS = 100;
const HEARTBEAT_INTERVAL_MS = 15_000;
const VOTE_LIMIT = 20;
const VOTE_WINDOW_MS = 60_000;
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 60_000;
const STATE_STORAGE_KEY = "state";
// ブランド設定は SessionState（"state" キー）とは独立したキーに保存する。
// state は投票のたびに publish() で全接続へ SSE 配信されるため、画像バイト
// 列をそこに混ぜてはいけない。読み書きの頻度も低いのでホットパス外に置く。
const BRAND_LOGO_STORAGE_KEY = "brandLogo";
// 設問も SessionState とは別キー。ただし brand logo と違い toPublicState()
// がホットパス（投票のたびに publish() が同期的に呼ぶ）で必要とするため、
// storage を都度読むのではなく this.questions に常駐させる
// （コンストラクタの blockConcurrencyWhile でロード）。
const QUESTIONS_STORAGE_KEY = "questions";

const VALID_LOGO_MIMES: readonly BrandLogoMime[] = ["image/png", "image/jpeg", "image/webp"];

/** DO ストレージから読んだ生データの型を検証する。sanitize.ts と同じ考え方
 * （想定外の形なら例外にせず null にして「無し」扱いにする）。 */
function isBrandLogo(value: unknown): value is BrandLogo {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.bytes instanceof Uint8Array &&
    typeof v.mime === "string" &&
    (VALID_LOGO_MIMES as readonly string[]).includes(v.mime) &&
    typeof v.updatedAt === "number"
  );
}

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
  private questions: readonly Question[] = [];
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
      const [persistedState, persistedQuestions] = await Promise.all([
        ctx.storage.get<unknown>(STATE_STORAGE_KEY),
        ctx.storage.get<unknown>(QUESTIONS_STORAGE_KEY),
      ]);

      const sanitizedQuestions = sanitizePersistedQuestions(persistedQuestions ?? null);
      if (sanitizedQuestions) {
        this.questions = sanitizedQuestions;
      } else {
        // まだ一度も管理画面で設問を保存していない（キー自体が無い）。
        // content/questions.ts のシードを初期値にし、以後はこれを正として
        // 扱えるようすぐに永続化する（次回起動からはシードを参照しない）。
        this.questions = seedQuestions();
        void ctx.storage.put(QUESTIONS_STORAGE_KEY, this.questions);
      }

      const sanitized = sanitizePersistedState(persistedState ?? null, this.questions);
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
        const publicState = toPublicState(state, this.questions, sub.role);
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
    return toPublicState(this.state, this.questions, role);
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
    const initialSnapshot = toPublicState(this.state, this.questions, role);
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
    const { next, result } = applyCastVote(
      this.state,
      this.questions,
      participantId,
      questionId,
      rawAnswer,
    );
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
    this.state = applySelectQuestion(this.state, this.questions, questionId);
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
    // ★ブランド設定（ロゴ）は集計とは無関係なので、ここでは触らない。
    // 「全リセット」は投票結果の初期化であって、主催者が登録した
    // ブランディングまで消してしまう操作ではない。
    this.state = applyResetAll(this.state);
    this.broadcastNow(this.state);
  }

  // ── 設問の登録・編集・削除（別ストレージキー） ────────────────────
  // questions は SessionState とは別キーだが、ballots/hidden/
  // activeQuestionId は SessionState 側にあるので、編集・削除のたびに
  // 両方の整合を取る必要がある（詳細は lib/session/mutations.ts の
  // bumpRev/applyChoicesRemoved/applyQuestionRemoved のコメント参照）。

  async getQuestions(): Promise<readonly Question[]> {
    return this.questions;
  }

  private async persistQuestions(): Promise<void> {
    // 設問の作成・編集・削除は頻度が低い管理操作なので、投票の persist()
    // と違い素直に await する（応答前に書き込みを確定させたい）。
    await this.ctx.storage.put(QUESTIONS_STORAGE_KEY, this.questions);
  }

  async createQuestion(data: ValidatedQuestionData): Promise<Question> {
    const question = { ...data, id: crypto.randomUUID() } as Question;
    this.questions = [...this.questions, question];
    await this.persistQuestions();
    // 新規設問はまだどの接続にも影響しない（出題中になり得ない）ので
    // broadcast はしない。
    return question;
  }

  async updateQuestion(
    questionId: string,
    data: ValidatedQuestionData,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const index = this.questions.findIndex((q) => q.id === questionId);
    if (index === -1) return { ok: false, error: "設問が見つかりません。" };
    const existing = this.questions[index];
    const updated = { ...data, id: existing.id } as Question;

    const nextQuestions = [...this.questions];
    nextQuestions[index] = updated;
    this.questions = nextQuestions;
    await this.persistQuestions();

    // 既存の投票（ballots）との整合を取る。ラベル修正など投票に影響
    // しない変更なら bumpRev だけで済む（choices の id は編集画面側で
    // 維持されるので、削除されていない限りここには来ない）。
    const kindChanged = existing.kind !== updated.kind;
    if (kindChanged) {
      // 別の形式に変わった時点で既存回答は意味を持たない。resetQuestion
      // と同じ後始末（出題中なら phase を idle・revealed を false に
      // 戻すが、activeQuestionId 自体は維持する＝設問はまだ存在するため）。
      this.state = applyResetQuestion(this.state, questionId);
    } else if (existing.kind === "choice" && updated.kind === "choice") {
      const removedChoiceIds = existing.choices
        .filter((c) => !updated.choices.some((nc) => nc.id === c.id))
        .map((c) => c.id);
      this.state = applyChoicesRemoved(this.state, questionId, removedChoiceIds);
    } else {
      this.state = bumpRev(this.state);
    }
    this.broadcastNow(this.state);
    return { ok: true };
  }

  async deleteQuestion(questionId: string): Promise<void> {
    this.questions = this.questions.filter((q) => q.id !== questionId);
    await this.persistQuestions();
    this.state = applyQuestionRemoved(this.state, questionId);
    this.broadcastNow(this.state);
  }

  // ── ブランド設定（別ストレージキー。SSE 配信には載せない） ─────────

  async getBrandLogo(): Promise<BrandLogo | null> {
    const raw = await this.ctx.storage.get<unknown>(BRAND_LOGO_STORAGE_KEY);
    return isBrandLogo(raw) ? raw : null;
  }

  /** ヘッダー表示側は画像バイト列そのものは要らないので、軽量版を用意する。 */
  async getBrandLogoMeta(): Promise<BrandLogoMeta | null> {
    const logo = await this.getBrandLogo();
    if (!logo) return null;
    return { mime: logo.mime, updatedAt: logo.updatedAt };
  }

  async setBrandLogo(bytes: Uint8Array, mime: BrandLogoMime): Promise<void> {
    const logo: BrandLogo = { bytes, mime, updatedAt: Date.now() };
    await this.ctx.storage.put(BRAND_LOGO_STORAGE_KEY, logo);
  }

  async clearBrandLogo(): Promise<void> {
    await this.ctx.storage.delete(BRAND_LOGO_STORAGE_KEY);
  }
}
