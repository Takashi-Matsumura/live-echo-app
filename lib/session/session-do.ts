import { DurableObject } from "cloudflare:workers";
import { isChoiceLike, MAX_QUESTIONS } from "@/lib/questions";
import { SESSION_FULL_ERROR } from "@/lib/session/errors";
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
// SSE は無認証で開けるため、大量接続によるこの DO 単体への負荷・ストレージ
// 課金の集中を防ぐ安全弁。通常の会場利用（数百人規模）を十分超える値にして
// あり、実運用で当たる想定はしていない — Cloudflare 側の Rate Limiting Rule
// （/api/stream への接続試行の頻度制限）と組み合わせて多層で防御する。
const MAX_SUBSCRIBERS = 1000;
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 60_000;
// TOTP は6桁（100万通り）なのでパスワードよりブルートフォース耐性が低い。
// loginBuckets と違いインスタンスフィールドの in-memory カウンタにはしない
// — DO は購読者ゼロで短時間退避するため、in-memory だと「数回試す→退避を
// 待つ→また数回」というペーシング攻撃でカウンタが初期化されてしまい、
// 6桁コードの防御として実質機能しない。TOTP_STORAGE_KEY（ctx.storage）に
// 永続化する。
const TOTP_FAIL_LIMIT = 10;
const TOTP_FAIL_WINDOW_MS = 15 * 60_000;
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
// TOTP の登録状態・失敗カウンタ。brandLogo と同じく非ホットパスの独立キー。
// シークレットの生値ではなく指紋（lib/auth/totp.ts の totpSecretFingerprint）
// だけを持つ — DO はレート制限などの解決済みロジックだけを担い、認証の
// 秘密情報そのものは Worker 側（環境変数）に留める既存方針を踏襲する。
const TOTP_STORAGE_KEY = "totp";
// 管理者セッションの「世代番号」。lib/auth/admin.ts が発行する le_admin
// Cookie にこの時点の値を焼き込み、以後の isAdmin() 判定はここに保持する
// 現在値との一致を都度確認する。盗難時など「全端末ログアウト」操作は
// この値をインクリメントするだけでよく、それだけで既発行の Cookie が
// （SESSION_SECRET のローテーション＝再デプロイなしに）即座に全部無効になる。
const ADMIN_SESSION_GEN_STORAGE_KEY = "adminSessionGen";

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

/** TOTP の登録・照合状態。1レコードのみ持つ（管理者は1人の前提）。 */
type TotpRecord = {
  /** 直近で登録/照合に成功したシークレットの指紋。現在の env.TOTP_SECRET の
   *  指紋と一致していれば「登録済み」とみなす（不一致ならシークレットが
   *  ローテーションされた、または未登録）。 */
  readonly secretFingerprint: string;
  /** リプレイ防止（RFC 6238 §5.2）。成功のたびに更新し、同じか過去の
   *  ステップの再送を拒否する。 */
  readonly lastUsedStep: number;
  readonly failCount: number;
  readonly failWindowResetAt: number;
};

function isTotpRecord(value: unknown): value is TotpRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.secretFingerprint === "string" &&
    typeof v.lastUsedStep === "number" &&
    typeof v.failCount === "number" &&
    typeof v.failWindowResetAt === "number"
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
  private adminSessionGen = 0;

  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    // コンストラクタ完了まで他の呼び出しはキューイングされるため、
    // 各メソッド側で復元完了を個別に待つ必要はない。
    ctx.blockConcurrencyWhile(async () => {
      const [persistedState, persistedQuestions, persistedGen] = await Promise.all([
        ctx.storage.get<unknown>(STATE_STORAGE_KEY),
        ctx.storage.get<unknown>(QUESTIONS_STORAGE_KEY),
        ctx.storage.get<unknown>(ADMIN_SESSION_GEN_STORAGE_KEY),
      ]);
      if (typeof persistedGen === "number" && Number.isInteger(persistedGen)) {
        this.adminSessionGen = persistedGen;
      }

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

  /** 集計済みの PublicState ではなく生の ballots/hidden を返す。管理者の
   *  結果エクスポート（app/api/admin/results/export/route.ts）専用 —
   *  revealed ゲート（toPublicState）を経ずに全件を渡してよいのは、
   *  呼び出し元が isAdmin() で既にガードされているため。 */
  async getRawState(): Promise<SessionState> {
    return this.state;
  }

  /**
   * role: "admin" で開いている SSE 接続の数。「全端末ログアウト」ボタンの
   * 目安表示専用（app/api/admin/connections/route.ts）。
   *
   * ★これは「ログイン中の管理者端末数」ではない — le_admin Cookie は
   * 署名ベースのステートレス設計（lib/auth/admin.ts）で、DO は発行済み
   * Cookie の一覧を一切持たない（adminSessionGen は「世代番号」1個だけ
   * で、台数の情報は無い）。ここで数えられるのは「今この瞬間に SSE を
   * 開いている画面」だけであり、以下の点で実際の端末数とはズレる:
   * - /present（投影画面）も requireAdmin() を通って role: "admin" で
   *   接続するため、操作端末だけでなく投影機の画面も含まれる
   * - 同じ端末で複数タブを開けば、その数だけ増える
   * - Cookie が有効なままタブを閉じている端末はカウントに含まれない
   *   （＝実際に全端末ログアウトされる数より少なく出ることがある）
   * つまり目安値であり、正確な台数として扱ってはならない。
   */
  async getAdminConnectionCount(): Promise<number> {
    let count = 0;
    for (const sub of this.subscribers) {
      if (sub.role === "admin") count += 1;
    }
    return count;
  }

  /**
   * SSE 配信。DO の state はインスタンスフィールドなので同期的に読める
   * （`start()` 内で同期的に最初のスナップショットを enqueue できる —
   * Next.js の Node サーバー実装で必要だった「ヘッダ flush 前に enqueue
   * しないと onopen が発火しない」という制約が、この構成では自然に守られる）。
   */
  async openEventStream(role: Role, participantId: string): Promise<ReadableStream<Uint8Array>> {
    if (this.subscribers.size >= MAX_SUBSCRIBERS) {
      throw new Error(SESSION_FULL_ERROR);
    }
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

  async castVote(
    participantId: string,
    questionId: string,
    rawAnswers: readonly string[],
  ): Promise<VoteResult> {
    if (!checkRateLimit(this.voteBuckets, `vote:${participantId}`, VOTE_LIMIT, VOTE_WINDOW_MS)) {
      return { ok: false, reason: "rate-limited" };
    }
    const { next, result } = applyCastVote(
      this.state,
      this.questions,
      participantId,
      questionId,
      rawAnswers,
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

  // ── 管理者セッションの世代番号（全端末ログアウト） ────────────────

  async getAdminSessionGeneration(): Promise<number> {
    return this.adminSessionGen;
  }

  /** 「全端末ログアウト」操作。世代番号を1つ進めて、その値と一致しない
   *  Cookie（＝それより前に発行された Cookie 全部）を以後すべて無効にする。 */
  async revokeAdminSessions(): Promise<void> {
    this.adminSessionGen += 1;
    await this.ctx.storage.put(ADMIN_SESSION_GEN_STORAGE_KEY, this.adminSessionGen);
  }

  // ── TOTP（第2要素認証）─────────────────────────────────────
  // 管理者は1人の前提なので、レコードは currentFingerprint に対するグローバル
  // な1件だけを持つ（IPごとの枠は設けない。第2要素の総当り対策としては
  // グローバル1枠の方が「攻撃元を分散されると意味がなくなる」問題が無く、
  // シンプルで頑健）。

  private async readTotpRecord(): Promise<TotpRecord | null> {
    const raw = await this.ctx.storage.get<unknown>(TOTP_STORAGE_KEY);
    return isTotpRecord(raw) ? raw : null;
  }

  /** ログイン画面に「未登録（QR表示）」か「登録済み（コード入力のみ）」の
   *  どちらを見せるか、および現在ロックアウト中かを判定する。 */
  async getTotpGate(
    currentFingerprint: string,
  ): Promise<{ registered: boolean; lockedOut: boolean }> {
    const record = await this.readTotpRecord();
    if (!record) return { registered: false, lockedOut: false };
    const lockedOut =
      record.failWindowResetAt > Date.now() && record.failCount >= TOTP_FAIL_LIMIT;
    return { registered: record.secretFingerprint === currentFingerprint, lockedOut };
  }

  /**
   * 1回のTOTP照合結果を記録する。成功時はこのメソッドが唯一の書き込み
   * 経路になる（登録の確定＝通常ログインの成功、どちらもここで扱う）。
   * ★ await を挟まないので、同時に飛んできた2リクエストでも判定と書き込みが
   * アトミックになる（castVote 等と同じDOの不変条件）。
   */
  async recordTotpAttempt(
    currentFingerprint: string,
    outcome: { ok: true; step: number } | { ok: false },
  ): Promise<{ accepted: boolean }> {
    const now = Date.now();
    const existing = await this.readTotpRecord();
    const windowActive = !!existing && existing.failWindowResetAt > now;
    const failCount = windowActive ? existing!.failCount : 0;
    const failWindowResetAt = windowActive ? existing!.failWindowResetAt : now + TOTP_FAIL_WINDOW_MS;

    if (failCount >= TOTP_FAIL_LIMIT) {
      // ロックアウト中。getTotpGate 側で弾かれているはずだが、念のため
      // ここでも二重にガードする。
      return { accepted: false };
    }

    const isReplay =
      outcome.ok &&
      existing?.secretFingerprint === currentFingerprint &&
      outcome.step <= existing.lastUsedStep;

    if (!outcome.ok || isReplay) {
      const next: TotpRecord = {
        secretFingerprint: existing?.secretFingerprint ?? "",
        lastUsedStep: existing?.lastUsedStep ?? -1,
        failCount: failCount + 1,
        failWindowResetAt,
      };
      await this.ctx.storage.put(TOTP_STORAGE_KEY, next);
      return { accepted: false };
    }

    // 成功（登録の確定 or 通常ログイン）。失敗カウンタはリセットする。
    const next: TotpRecord = {
      secretFingerprint: currentFingerprint,
      lastUsedStep: outcome.step,
      failCount: 0,
      failWindowResetAt: now + TOTP_FAIL_WINDOW_MS,
    };
    await this.ctx.storage.put(TOTP_STORAGE_KEY, next);
    return { accepted: true };
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
    // ブランディングまで消してしまう操作ではない。TOTP の登録状態
    // （TOTP_STORAGE_KEY）も同じ理由でここでは一切触れない
    // （this.state のみを差し替える。ブランド設定と同じキー分離のおかげで、
    // 変更不要のまま安全なのを確認済み）。
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
    } else if (isChoiceLike(existing) && isChoiceLike(updated)) {
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

  /**
   * エクスポートされた設問セットの一括投入（lib/questions/transfer.ts で
   * 検証済みのデータのみ受け取る）。createQuestion をループで呼ぶと DO
   * への RPC と storage.put が N 回走るので、1回にまとめる。
   */
  async importQuestions(
    items: readonly ValidatedQuestionData[],
    mode: "append" | "replace",
  ): Promise<{ ok: true; imported: number } | { ok: false; error: string }> {
    // 既存件数を知っているのはこの DO だけなので、上限判定はここで行う。
    const total = mode === "replace" ? items.length : this.questions.length + items.length;
    if (total > MAX_QUESTIONS) {
      return { ok: false, error: `設問は合計${MAX_QUESTIONS}問までです。` };
    }

    const imported = items.map((data) => ({ ...data, id: crypto.randomUUID() }) as Question);
    this.questions = mode === "replace" ? imported : [...this.questions, ...imported];
    await this.persistQuestions();

    if (mode === "replace") {
      // 既存の設問が全部消える＝出題中の設問も投票も意味を失う。resetAll
      // と同じ後始末で参加者画面を idle に戻す（applyResetAll は questions
      // を触らないので、直前に this.questions を差し替えるここでの使用は安全）。
      this.state = applyResetAll(this.state);
      this.broadcastNow(this.state);
    } else {
      // append は SessionState 自体を変えないので createQuestion に倣って
      // broadcast しないでもよさそうに見えるが、toPublicState の
      // position（lib/session/projection.ts）は questions.length から
      // total を出す。出題中に一括で数問追加すると、配信し直さない限り
      // 参加者・投影画面の「設問 n / 総数」の総数が古いまま残ってしまう
      // ため、rev だけ進めて明示的に配信し直す。
      this.state = bumpRev(this.state);
      this.broadcastNow(this.state);
    }

    return { ok: true, imported: imported.length };
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
