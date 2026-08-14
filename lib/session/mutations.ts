import {
  DEFAULT_TEXT_MAX_LENGTH,
  getQuestionById,
  isValidChoiceId,
} from "@/lib/questions";
import type { Phase, SessionState, VoteResult } from "@/lib/types";

/**
 * SessionState の差分適用ヘルパー。rev のインクリメントと updatedAt の更新を
 * ここに集約する。
 */
function commit(
  current: SessionState,
  patch: Partial<Omit<SessionState, "rev" | "updatedAt">>,
): SessionState {
  return {
    ...current,
    ...patch,
    rev: current.rev + 1,
    updatedAt: Date.now(),
  };
}

/**
 * ★このファイルの関数はすべて純粋（I/O を持たない）。
 * 状態を受け取り、次の状態（または変更なしを示す null）を返すだけ。
 * 呼び出し側（DO）がこれを唯一の書き込み経路として扱う限り、読む→計算する→
 * 差し替えるはアトミックになる。
 */

export function applyCastVote(
  current: SessionState,
  participantId: string,
  questionId: string,
  rawAnswer: string,
): { next: SessionState | null; result: VoteResult } {
  const question = getQuestionById(questionId);
  if (!question) return { next: null, result: { ok: false, reason: "invalid" } };

  if (current.activeQuestionId !== questionId) {
    // 回答している間に講師が別の設問に切り替えた
    return { next: null, result: { ok: false, reason: "stale" } };
  }
  if (current.phase !== "open") {
    return { next: null, result: { ok: false, reason: "closed" } };
  }

  let answer: string;
  if (question.kind === "choice") {
    if (!isValidChoiceId(question, rawAnswer)) {
      return { next: null, result: { ok: false, reason: "invalid" } };
    }
    answer = rawAnswer;
  } else {
    const trimmed = rawAnswer.trim();
    if (trimmed.length === 0) return { next: null, result: { ok: false, reason: "invalid" } };
    const maxLength = question.maxLength ?? DEFAULT_TEXT_MAX_LENGTH;
    if (trimmed.length > maxLength) return { next: null, result: { ok: false, reason: "too-long" } };
    answer = trimmed;
  }

  const questionBallots = current.ballots[questionId] ?? {};
  const next = commit(current, {
    ballots: {
      ...current.ballots,
      [questionId]: { ...questionBallots, [participantId]: answer },
    },
  });
  return { next, result: { ok: true } };
}

export function applySelectQuestion(current: SessionState, questionId: string): SessionState {
  const question = getQuestionById(questionId);
  if (!question) throw new Error(`unknown question id: ${questionId}`);
  return commit(current, {
    activeQuestionId: questionId,
    phase: "open",
    revealed: false,
  });
}

export function applySetPhase(current: SessionState, phase: Phase): SessionState {
  return commit(current, { phase });
}

export function applySetRevealed(current: SessionState, revealed: boolean): SessionState {
  return commit(current, { revealed });
}

export function applyHideAnswer(
  current: SessionState,
  questionId: string,
  participantId: string,
): SessionState | null {
  const existing = current.hidden[questionId] ?? [];
  if (existing.includes(participantId)) return null;
  return commit(current, {
    hidden: { ...current.hidden, [questionId]: [...existing, participantId] },
  });
}

export function applyUnhideAnswer(
  current: SessionState,
  questionId: string,
  participantId: string,
): SessionState | null {
  const existing = current.hidden[questionId] ?? [];
  if (!existing.includes(participantId)) return null;
  return commit(current, {
    hidden: {
      ...current.hidden,
      [questionId]: existing.filter((id) => id !== participantId),
    },
  });
}

export function applyResetQuestion(current: SessionState, questionId: string): SessionState {
  const nextBallots = { ...current.ballots };
  delete nextBallots[questionId];
  const nextHidden = { ...current.hidden };
  delete nextHidden[questionId];
  const isActive = current.activeQuestionId === questionId;
  return commit(current, {
    ballots: nextBallots,
    hidden: nextHidden,
    revealed: isActive ? false : current.revealed,
    phase: isActive ? "idle" : current.phase,
  });
}

export function applyResetAll(current: SessionState): SessionState {
  return commit(current, {
    activeQuestionId: null,
    phase: "idle",
    revealed: false,
    ballots: {},
    hidden: {},
  });
}
