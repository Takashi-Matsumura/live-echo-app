import type {
  AnyChoiceQuestion,
  Ballot,
  Choice,
  ChoiceDraft,
  Question,
  QuestionDraft,
  ValidatedQuestionData,
} from "@/lib/types";

export const DEFAULT_TEXT_MAX_LENGTH = 140;

// 検証の上限値。ここに書いてある数字だけが「なぜこの値か」の根拠を持つ。
const PROMPT_MAX_LENGTH = 200;
const NOTE_MAX_LENGTH = 200;
const CHOICE_LABEL_MAX_LENGTH = 60;
const PLACEHOLDER_MAX_LENGTH = 60;
/** components/result-bars.tsx の設計コメント「凡例なし・6本以下で
 *  全値に直接ラベル」を崩さない上限。単一選択・複数選択の両方に適用する。 */
export const MIN_CHOICES = 2;
export const MAX_CHOICES = 6;
const MIN_TEXT_MAX_LENGTH = 10;
const MAX_TEXT_MAX_LENGTH = 1000;

/** 設問タイプの日本語ラベル。Record にしているので、kind を追加したのに
 *  ここへの追加を忘れると型エラーになる（三項演算子の直書きだと防げない）。 */
export const QUESTION_KIND_LABELS: Record<Question["kind"], string> = {
  choice: "選択式",
  multi: "複数選択式",
  text: "自由記述",
};

/** choices を持つ設問（単一選択・複数選択）かどうか。この判定を1箇所に
 *  集約することで、`kind === "choice"` の書き漏れ（複数選択が自由記述
 *  扱いに落ちる事故）を防ぐ。 */
export function isChoiceLike(
  question: Question | null | undefined,
): question is AnyChoiceQuestion {
  return question?.kind === "choice" || question?.kind === "multi";
}

/**
 * ★このファイルは副作用を一切持たない純粋関数の集まり。
 * かつては content/questions.ts を読んで起動時に検証する「静的な
 * デッキ」を持っていたが、設問は今は管理画面から登録・編集できる
 * ランタイムデータになり、実体は Durable Object のストレージに移った
 * （lib/session/session-do.ts）。ここの関数はすべて `questions` を
 * 引数で受け取るだけで、どこにも設問リストを保持しない。
 *
 * 起動時のシード読み込み（content/questions.ts → 初回起動時の初期設問）
 * は lib/questions/seed.ts が担う。あちらはサーバー専用（DO からのみ
 * import される）で、ここは components/text-vote-form.tsx のような
 * クライアントコンポーネントからも安全に import できる。
 */

export function getQuestionById(
  questions: readonly Question[],
  id: string,
): Question | undefined {
  return questions.find((q) => q.id === id);
}

export function getQuestionIndex(questions: readonly Question[], id: string): number {
  return questions.findIndex((q) => q.id === id);
}

/** choice/multi 設問で choiceId が実在するか */
export function isValidChoiceId(question: Question, choiceId: string): boolean {
  return isChoiceLike(question) && question.choices.some((c) => c.id === choiceId);
}

/** Ballot から選択された choiceId の配列を取り出す。choice/multi 専用。
 *  choice の Ballot は単一の choiceId（string）なので配列化するだけ。
 *  text の設問には呼ばないこと（本文を choiceId 扱いしてしまう）。 */
export function selectedChoiceIds(answer: Ballot | null | undefined): readonly string[] {
  if (answer == null) return [];
  return typeof answer === "string" ? [answer] : answer;
}

/** Ballot から自由記述の本文を取り出す。text 専用。choice/multi の
 *  Ballot（配列）が渡った場合は防御的に null を返す。 */
export function answerText(answer: Ballot | null | undefined): string | null {
  if (answer == null || typeof answer !== "string") return null;
  return answer;
}

/**
 * 管理画面のフォーム入力（QuestionDraft）を検証し、確定した
 * ValidatedQuestionData に変換する。起動時のシード検証
 * （lib/questions/seed.ts）と、admin フォームのバリデーションの両方が
 * これを使う共通ロジック。例外は投げず Result を返す — 管理者の入力
 * ミスでアプリ全体を落とすわけにはいかない。
 */
export function validateQuestionDraft(
  draft: QuestionDraft,
): { ok: true; data: ValidatedQuestionData } | { ok: false; error: string } {
  const prompt = draft.prompt.trim();
  if (prompt.length === 0) {
    return { ok: false, error: "設問文を入力してください。" };
  }
  if (prompt.length > PROMPT_MAX_LENGTH) {
    return { ok: false, error: `設問文が長すぎます（最大${PROMPT_MAX_LENGTH}文字）。` };
  }

  const noteTrimmed = draft.note.trim();
  if (noteTrimmed.length > NOTE_MAX_LENGTH) {
    return { ok: false, error: `補足が長すぎます（最大${NOTE_MAX_LENGTH}文字）。` };
  }
  const note = noteTrimmed.length > 0 ? noteTrimmed : undefined;

  if (draft.kind === "choice" || draft.kind === "multi") {
    const choicesResult = validateChoiceDrafts(draft.choices);
    if (!choicesResult.ok) return choicesResult;
    return { ok: true, data: { kind: draft.kind, prompt, note, choices: choicesResult.choices } };
  }

  const placeholderTrimmed = draft.placeholder.trim();
  if (placeholderTrimmed.length > PLACEHOLDER_MAX_LENGTH) {
    return {
      ok: false,
      error: `プレースホルダーが長すぎます（最大${PLACEHOLDER_MAX_LENGTH}文字）。`,
    };
  }
  const placeholder = placeholderTrimmed.length > 0 ? placeholderTrimmed : undefined;

  const maxLength = Number.isInteger(draft.maxLength) ? draft.maxLength : DEFAULT_TEXT_MAX_LENGTH;
  if (maxLength < MIN_TEXT_MAX_LENGTH || maxLength > MAX_TEXT_MAX_LENGTH) {
    return {
      ok: false,
      error: `回答の最大文字数は${MIN_TEXT_MAX_LENGTH}〜${MAX_TEXT_MAX_LENGTH}の範囲で指定してください。`,
    };
  }

  return { ok: true, data: { kind: "text", prompt, note, placeholder, maxLength } };
}

function validateChoiceDrafts(
  drafts: readonly ChoiceDraft[],
): { ok: true; choices: readonly Choice[] } | { ok: false; error: string } {
  if (drafts.length < MIN_CHOICES) {
    return { ok: false, error: `選択肢は${MIN_CHOICES}つ以上にしてください。` };
  }
  if (drafts.length > MAX_CHOICES) {
    return { ok: false, error: `選択肢は${MAX_CHOICES}つまでにしてください。` };
  }

  const choices: Choice[] = [];
  for (const draft of drafts) {
    const label = draft.label.trim();
    if (label.length === 0) {
      return { ok: false, error: "空欄の選択肢があります。" };
    }
    if (label.length > CHOICE_LABEL_MAX_LENGTH) {
      return {
        ok: false,
        error: `選択肢のラベルが長すぎます（最大${CHOICE_LABEL_MAX_LENGTH}文字）。`,
      };
    }
    // 既存の選択肢を編集した行は id を維持し、新規に追加した行
    // （id === null）にだけ新しい id を発行する。id を維持することで、
    // ラベルの修正だけなら既存の投票（ballots）に一切影響しない。
    choices.push({ id: draft.id ?? crypto.randomUUID(), label });
  }
  return { ok: true, choices };
}
