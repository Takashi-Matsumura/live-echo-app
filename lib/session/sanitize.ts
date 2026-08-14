import { getQuestionById, isValidChoiceId } from "@/lib/questions";
import type { Choice, Phase, Question, SessionState } from "@/lib/types";

const VALID_PHASES: readonly Phase[] = ["idle", "open", "closed"];

function isPhase(value: unknown): value is Phase {
  return typeof value === "string" && (VALID_PHASES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Durable Object のストレージから読んだ生データを検証し、同じく
 * ストレージから読んだ現在の設問リスト（questions）と突き合わせて
 * 安全な SessionState に変換する。
 *
 * ★ここが無いと、設問を管理画面で編集・削除した後に古い state を
 * ロードして壊れる（存在しない questionId が activeQuestionId に残る、
 * 削除した選択肢の票が残る等）のが一番ありがちな事故になる。形式が
 * 想定と違う場合や検証に失敗した場合は null を返し、呼び出し側は
 * 初期状態にする（「読めない状態で起動を止める」よりは安全側）。
 */
export function sanitizePersistedState(
  raw: unknown,
  questions: readonly Question[],
): SessionState | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.rev !== "number") return null;
  if (!isPhase(raw.phase)) return null;
  if (typeof raw.revealed !== "boolean") return null;
  if (!isRecord(raw.ballots)) return null;
  if (!isRecord(raw.hidden)) return null;

  const validQuestionIds = new Set(questions.map((q) => q.id));

  const ballots: Record<string, Record<string, string>> = {};
  for (const [questionId, answersRaw] of Object.entries(raw.ballots)) {
    if (!validQuestionIds.has(questionId) || !isRecord(answersRaw)) continue;
    const question = getQuestionById(questions, questionId);
    if (!question) continue;

    const answers: Record<string, string> = {};
    for (const [participantId, answerRaw] of Object.entries(answersRaw)) {
      if (typeof answerRaw !== "string") continue;
      if (question.kind === "choice" && !isValidChoiceId(question, answerRaw)) continue;
      if (question.kind === "text" && answerRaw.length > (question.maxLength ?? 140)) continue;
      answers[participantId] = answerRaw;
    }
    ballots[questionId] = answers;
  }

  const hidden: Record<string, string[]> = {};
  for (const [questionId, idsRaw] of Object.entries(raw.hidden)) {
    if (!validQuestionIds.has(questionId) || !Array.isArray(idsRaw)) continue;
    hidden[questionId] = idsRaw.filter((id): id is string => typeof id === "string");
  }

  const activeQuestionId =
    typeof raw.activeQuestionId === "string" && validQuestionIds.has(raw.activeQuestionId)
      ? raw.activeQuestionId
      : null;

  return {
    rev: raw.rev,
    activeQuestionId,
    // 設問が見つからなくなった（管理画面で編集・削除した）場合は idle に落とす
    phase: activeQuestionId ? raw.phase : "idle",
    revealed: activeQuestionId ? raw.revealed : false,
    ballots,
    hidden,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
}

/**
 * Durable Object のストレージから読んだ設問リストの生データを検証する。
 * SessionState と違い、キー自体が無い（raw が配列ですらない）ときだけ
 * null を返す ＝ 呼び出し側はこれを「まだ一度も管理画面で設問を保存して
 * いない」と解釈し、content/questions.ts のシードにフォールバックする
 * （lib/questions/seed.ts, lib/session/session-do.ts）。
 *
 * 配列の中身が壊れている項目は、全体を捨てるのではなく1件ずつ無視する
 * （sanitizePersistedState の ballots/hidden と同じ方針）。1つの設問が
 * 壊れていたせいで管理者が登録した他の設問まで消えるのは避けたい。
 * 空配列（admin が全設問を削除した）は正当な状態としてそのまま返す。
 */
export function sanitizePersistedQuestions(raw: unknown): readonly Question[] | null {
  if (!Array.isArray(raw)) return null;

  const seenIds = new Set<string>();
  const questions: Question[] = [];
  for (const item of raw) {
    const question = parseQuestion(item);
    if (!question || seenIds.has(question.id)) continue;
    seenIds.add(question.id);
    questions.push(question);
  }
  return questions;
}

function parseQuestion(raw: unknown): Question | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.prompt !== "string") return null;
  const note = typeof raw.note === "string" ? raw.note : undefined;

  if (raw.kind === "choice") {
    if (!Array.isArray(raw.choices) || raw.choices.length === 0) return null;
    const choices: Choice[] = [];
    const seenChoiceIds = new Set<string>();
    for (const c of raw.choices) {
      if (!isRecord(c) || typeof c.id !== "string" || typeof c.label !== "string") return null;
      if (seenChoiceIds.has(c.id)) return null;
      seenChoiceIds.add(c.id);
      choices.push({ id: c.id, label: c.label });
    }
    return { kind: "choice", id: raw.id, prompt: raw.prompt, note, choices };
  }

  if (raw.kind === "text") {
    const placeholder = typeof raw.placeholder === "string" ? raw.placeholder : undefined;
    const maxLength = typeof raw.maxLength === "number" ? raw.maxLength : undefined;
    return { kind: "text", id: raw.id, prompt: raw.prompt, note, placeholder, maxLength };
  }

  return null;
}
