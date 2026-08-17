import { MAX_QUESTIONS, validateQuestionDraft } from "@/lib/questions";
import type { Question, QuestionDraft, ValidatedQuestionData } from "@/lib/types";

/**
 * 設問のエクスポート／インポート（JSON ⇄ 設問）。lib/questions/seed.ts と
 * 違いサーバー専用ではない — content/questions.ts に依存しない純粋関数の
 * 集まりで、管理画面のクライアントコンポーネントからも import できる。
 *
 * ★責務は lib/session/sanitize.ts の parseQuestion とは別物。あちらは
 * 「DO storage から読んだ自分で書いた過去データの形式チェック」（長さ
 * 制限は見ない）で、こちらは「外部から持ち込まれる入力のバリデーション」
 * （管理画面のフォームと同じ長さ制限を全部通す）。
 */

export const QUESTIONS_EXPORT_FORMAT = "live-echo/questions";
export const QUESTIONS_EXPORT_VERSION = 1;

/** インポートで受け付ける JSON テキストの最大バイト数。 */
export const MAX_IMPORT_BYTES = 256 * 1024;

type ExportChoice = { readonly label: string };

type ExportQuestion =
  | { readonly kind: "choice" | "multi"; readonly prompt: string; readonly note?: string; readonly choices: readonly ExportChoice[] }
  | {
      readonly kind: "text";
      readonly prompt: string;
      readonly note?: string;
      readonly placeholder?: string;
      readonly maxLength?: number;
    };

export type QuestionsExport = {
  readonly format: typeof QUESTIONS_EXPORT_FORMAT;
  readonly version: typeof QUESTIONS_EXPORT_VERSION;
  readonly exportedAt: string;
  readonly questions: readonly ExportQuestion[];
};

/**
 * Question[] → エクスポート用の素の JSON 値。
 *
 * ★id（設問・選択肢とも）は意図的に含めない。別環境へインポートした際に
 * 既存データと id が衝突すると、sanitizePersistedQuestions（lib/session/
 * sanitize.ts）が重複 id を黙って捨てる＝設問が消える事故になりうるし、
 * 選択肢 id が別セッションの古い ballots に残る id とたまたま一致すると
 * 票が湧いて見える事故にもなりうる。id を一切持ち込まなければ、この
 * どちらも構造的に起きない（インポート側は常に新しい id を発行する）。
 */
export function toExportPayload(questions: readonly Question[], exportedAt: string): QuestionsExport {
  return {
    format: QUESTIONS_EXPORT_FORMAT,
    version: QUESTIONS_EXPORT_VERSION,
    exportedAt,
    questions: questions.map(toExportQuestion),
  };
}

function toExportQuestion(question: Question): ExportQuestion {
  if (question.kind === "choice" || question.kind === "multi") {
    return {
      kind: question.kind,
      prompt: question.prompt,
      note: question.note,
      choices: question.choices.map((c) => ({ label: c.label })),
    };
  }
  return {
    kind: "text",
    prompt: question.prompt,
    note: question.note,
    placeholder: question.placeholder,
    maxLength: question.maxLength,
  };
}

/**
 * JSON テキスト → ValidatedQuestionData[]。
 *
 * ★1件でも壊れていたら全体を拒否する（通ったものだけ入れる、はしない）。
 * 特に「全て置き換え」モードで一部だけ入ると、管理者は「入ったつもり」で
 * 本番に臨むことになり、当日の事故として重すぎる。何問目のどこが悪いかを
 * 返して直させる方が安全。
 */
export function parseQuestionsImport(
  text: string,
): { ok: true; data: readonly ValidatedQuestionData[] } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSONとして読み取れませんでした。ファイルが壊れている可能性があります。" };
  }

  if (!isRecord(raw)) {
    return { ok: false, error: "設問データの形式ではありません。" };
  }
  if (raw.format !== QUESTIONS_EXPORT_FORMAT) {
    return { ok: false, error: "このアプリの設問エクスポートファイルではありません。" };
  }
  if (raw.version !== QUESTIONS_EXPORT_VERSION) {
    return { ok: false, error: "対応していないバージョンの設問ファイルです。" };
  }
  if (!Array.isArray(raw.questions)) {
    return { ok: false, error: "設問データの形式ではありません。" };
  }
  if (raw.questions.length === 0) {
    // 空配列を許すと「全て置き換え」で全消しが正当な入力として通ってしまう。
    // 全消しは resetAll という別の明示的な操作があるので、ここでは事故として扱う。
    return { ok: false, error: "設問が1件もありません。" };
  }
  if (raw.questions.length > MAX_QUESTIONS) {
    return { ok: false, error: `設問は一度に${MAX_QUESTIONS}問までしかインポートできません。` };
  }

  const data: ValidatedQuestionData[] = [];
  for (const [i, item] of raw.questions.entries()) {
    const draft = toQuestionDraft(item);
    if (!draft) {
      return { ok: false, error: `${i + 1}問目: 設問データの形式ではありません。` };
    }
    const validated = validateQuestionDraft(draft);
    if (!validated.ok) {
      return { ok: false, error: `${i + 1}問目: ${validated.error}` };
    }
    data.push(validated.data);
  }

  return { ok: true, data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * JSON の1件を QuestionDraft に変換する。validateQuestionDraft の入口は
 * 揃えるだけで、長さ・個数の妥当性チェックはすべて validateQuestionDraft
 * 側（lib/questions.ts）に委ねる。
 */
function toQuestionDraft(raw: unknown): QuestionDraft | null {
  if (!isRecord(raw)) return null;
  if (raw.kind !== "choice" && raw.kind !== "multi" && raw.kind !== "text") return null;
  if (typeof raw.prompt !== "string") return null;

  const note = typeof raw.note === "string" ? raw.note : "";

  if (raw.kind === "choice" || raw.kind === "multi") {
    if (!Array.isArray(raw.choices)) return null;
    const choices = raw.choices.map((c): { id: null; label: string } | null => {
      if (!isRecord(c) || typeof c.label !== "string") return null;
      // 持ち込んだ id は捨てて再発行させる（上のコメント参照）。
      return { id: null, label: c.label };
    });
    if (choices.some((c) => c === null)) return null;
    return {
      kind: raw.kind,
      prompt: raw.prompt,
      note,
      choices: choices as { id: null; label: string }[],
      placeholder: "",
      maxLength: 0,
    };
  }

  const placeholder = typeof raw.placeholder === "string" ? raw.placeholder : "";
  const maxLength = typeof raw.maxLength === "number" ? raw.maxLength : 0;
  return { kind: "text", prompt: raw.prompt, note, choices: [], placeholder, maxLength };
}
