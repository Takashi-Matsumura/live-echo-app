import { deck, getQuestionById, isValidChoiceId } from "@/lib/questions";
import type { Phase, SessionState } from "@/lib/types";

const VALID_PHASES: readonly Phase[] = ["idle", "open", "closed"];

function isPhase(value: unknown): value is Phase {
  return typeof value === "string" && (VALID_PHASES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Durable Object のストレージから読んだ生データを検証し、現在の
 * content/questions.ts と突き合わせて安全な SessionState に変換する。
 *
 * ★ここが無いと、設問ファイルを編集した後に古い state をロードして
 * 壊れる（存在しない questionId が activeQuestionId に残る、削除した
 * 選択肢の票が残る等）のが一番ありがちな事故になる。形式が想定と違う
 * 場合や検証に失敗した場合は null を返し、呼び出し側は初期状態にする
 * （「読めない状態で起動を止める」よりは安全側）。
 */
export function sanitizePersistedState(raw: unknown): SessionState | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.rev !== "number") return null;
  if (!isPhase(raw.phase)) return null;
  if (typeof raw.revealed !== "boolean") return null;
  if (!isRecord(raw.ballots)) return null;
  if (!isRecord(raw.hidden)) return null;

  const validQuestionIds = new Set(deck.questions.map((q) => q.id));

  const ballots: Record<string, Record<string, string>> = {};
  for (const [questionId, answersRaw] of Object.entries(raw.ballots)) {
    if (!validQuestionIds.has(questionId) || !isRecord(answersRaw)) continue;
    const question = getQuestionById(questionId);
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
    // 設問が見つからなくなった（設問ファイルを編集した）場合は idle に落とす
    phase: activeQuestionId ? raw.phase : "idle",
    revealed: activeQuestionId ? raw.revealed : false,
    ballots,
    hidden,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
}
