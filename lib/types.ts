/**
 * アプリ全体の型定義（単一の真実）。
 * - Question 系: content/questions.ts が書く「設問定義」
 * - SessionState: サーバだけが持つ生の状態（永続化対象）
 * - PublicState / PersonalState: クライアントに配る形（結果開示ゲートは lib/session/projection.ts）
 */

// ── 設問定義 ──────────────────────────────────────────────

export type Choice = {
  readonly id: string;
  readonly label: string;
};

export type ChoiceQuestion = {
  readonly kind: "choice";
  readonly id: string;
  readonly prompt: string;
  readonly note?: string;
  readonly choices: readonly Choice[];
};

export type TextQuestion = {
  readonly kind: "text";
  readonly id: string;
  readonly prompt: string;
  readonly note?: string;
  readonly placeholder?: string;
  /** 既定 140 文字。lib/questions.ts で補完される */
  readonly maxLength?: number;
};

export type Question = ChoiceQuestion | TextQuestion;

export type Deck = {
  readonly title: string;
  readonly questions: readonly Question[];
};

// ── セッション状態（サーバのみ。永続化対象） ──────────────────

export type Phase = "idle" | "open" | "closed";

export type SessionState = {
  /** 単調増加。SSE の古いフレーム破棄に使う */
  readonly rev: number;
  readonly activeQuestionId: string | null;
  readonly phase: Phase;
  readonly revealed: boolean;
  /** questionId -> participantId -> 回答（choice なら choiceId、text なら本文） */
  readonly ballots: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** 自由記述のモデレーション: questionId -> 伏せた participantId の配列 */
  readonly hidden: Readonly<Record<string, readonly string[]>>;
  readonly updatedAt: number;
};

// ── クライアントに配る形 ────────────────────────────────────

export type PublicResults =
  | { readonly kind: "choice"; readonly counts: Readonly<Record<string, number>> }
  | {
      readonly kind: "text";
      /**
       * 参加者向けは伏せられた回答を除外済み（id は連番）。
       * admin 向けはモデレーション UI のため全件を返し、伏せ済みには hidden:
       * true を付ける（id は実際の participantId で、hideAnswer/unhideAnswer
       * の引数に使える）。
       */
      readonly answers: readonly {
        readonly id: string;
        readonly text: string;
        readonly hidden?: boolean;
      }[];
    };

export type PublicState = {
  readonly rev: number;
  readonly phase: Phase;
  readonly revealed: boolean;
  readonly question: Question | null;
  /** 回答人数は revealed に関係なく常に出す（進行の目安） */
  readonly answeredCount: number;
  /** revealed のときだけ非 null。role === 'admin' なら常に非 null */
  readonly results: PublicResults | null;
  readonly position: { readonly index: number; readonly total: number } | null;
};

export type PersonalState = {
  /**
   * myAnswer がどの設問に対する回答かを明示する。設問切替の直後は
   * クライアントが自分の回答状況をまだ取り直せていない瞬間があり、
   * questionId が無いと「前の設問の回答値」を新しい設問の初期値として
   * 誤って使ってしまう（例: 選択肢 id がたまたま一致してチェックが付く）。
   */
  readonly questionId: string | null;
  readonly myAnswer: string | null;
};

export type ServerEvent =
  | { readonly kind: "snapshot"; readonly state: PublicState; readonly you: PersonalState }
  | { readonly kind: "state"; readonly state: PublicState };

export type Role = "participant" | "admin";

export type VoteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "closed" | "stale" | "invalid" | "too-long" | "rate-limited" };
