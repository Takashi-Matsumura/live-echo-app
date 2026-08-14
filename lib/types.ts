/**
 * アプリ全体の型定義（単一の真実）。
 * - Question 系: 管理画面から登録・編集する「設問定義」。実体は Durable
 *   Object のストレージ（lib/session/session-do.ts）。初回起動時だけ
 *   content/questions.ts の内容をシードとして使う（lib/questions/seed.ts）。
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

// ── 設問の作成・編集フォーム入力 ────────────────────────────
// 管理画面から送信される「まだ検証していない」下書きの形。
// lib/questions.ts の validateQuestionDraft() がこれを検証し、
// 確定した Question に変換する（実際の永続化は lib/session/ 側）。

export type ChoiceDraft = {
  /** 既存の選択肢を編集した行なら元の id、新規に追加した行なら null
   *  （サーバー側で crypto.randomUUID() を新規発行する）。 */
  readonly id: string | null;
  readonly label: string;
};

export type QuestionDraft = {
  readonly kind: "choice" | "text";
  readonly prompt: string;
  /** 空文字列は「note なし」を表す */
  readonly note: string;
  /** kind === "choice" のときだけ使う */
  readonly choices: readonly ChoiceDraft[];
  /** kind === "text" のときだけ使う。空文字列は「placeholder なし」 */
  readonly placeholder: string;
  /** kind === "text" のときだけ使う */
  readonly maxLength: number;
};

/** validateQuestionDraft() の成功時の戻り値。Question.id はまだ付いて
 *  いない（新規作成なら新しい id、更新なら既存の id を呼び出し側が
 *  付与する）。choices の id はこの時点で確定済み（新規選択肢にも
 *  発行済み）なので、更新時に「どの選択肢が削除されたか」を
 *  id の集合差分で判定できる。 */
export type ValidatedQuestionData =
  | {
      readonly kind: "choice";
      readonly prompt: string;
      readonly note?: string;
      readonly choices: readonly Choice[];
    }
  | {
      readonly kind: "text";
      readonly prompt: string;
      readonly note?: string;
      readonly placeholder?: string;
      readonly maxLength: number;
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

// ── ブランド設定（SessionState とは別のストレージキーに保存する） ──────
// 意図的に SessionState の外に置いている。SessionState は投票のたびに
// SSE で全接続へブロードキャストされるため（lib/session/session-do.ts の
// publish()）、画像バイト列をそこに含めてはならない。

export type BrandLogoMime = "image/png" | "image/jpeg" | "image/webp";

export type BrandLogo = {
  readonly bytes: Uint8Array;
  readonly mime: BrandLogoMime;
  /** キャッシュバスティングと ETag に使う */
  readonly updatedAt: number;
};

/** バイト列を伴わない軽量版。存在確認・ヘッダー描画・ETag 生成に使う */
export type BrandLogoMeta = Omit<BrandLogo, "bytes">;

export type VoteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "closed" | "stale" | "invalid" | "too-long" | "rate-limited" };
