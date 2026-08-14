import {
  DEFAULT_TEXT_MAX_LENGTH,
  getQuestionById,
  isValidChoiceId,
} from "@/lib/questions";
import type { Phase, Question, SessionState, VoteResult } from "@/lib/types";

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
  questions: readonly Question[],
  participantId: string,
  questionId: string,
  rawAnswer: string,
): { next: SessionState | null; result: VoteResult } {
  const question = getQuestionById(questions, questionId);
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

export function applySelectQuestion(
  current: SessionState,
  questions: readonly Question[],
  questionId: string,
): SessionState {
  const question = getQuestionById(questions, questionId);
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

// ── 設問の登録・編集・削除にともなう後始末 ───────────────────────
// 設問そのもの（questions リスト）は SessionState の外（DO の別ストレージ
// キー）で管理するが、投票（ballots）・モデレーション（hidden）・
// 出題中の設問（activeQuestionId）は SessionState 側にあるので、設問の
// 編集・削除がこれらと矛盾しないよう、ここで整合を取る。

/**
 * 内容以外は変えずに rev だけ進める。SessionState 自体に変更が無くても、
 * 出題中の設問のプロンプト・選択肢ラベルを編集したときは
 * PublicState.question の中身が変わるので、SSE で配信し直す必要がある
 * （このアプリの rev は「配信すべき新しいフレームがあるか」を意味する
 * ので、SessionState の各フィールドが同じでも進める必要がある）。
 */
export function bumpRev(current: SessionState): SessionState {
  return commit(current, {});
}

/**
 * 選択肢を削除したときに、その選択肢への投票だけを取り除く。
 * choices 自体の置き換えは呼び出し側（DO の questions リスト更新）で
 * 行い、ここでは ballots の整合性だけを見る。削除された選択肢が無ければ
 * bumpRev と同じ（ラベル修正のみの編集はここに来る）。
 */
export function applyChoicesRemoved(
  current: SessionState,
  questionId: string,
  removedChoiceIds: readonly string[],
): SessionState {
  const existing = current.ballots[questionId];
  if (!existing || removedChoiceIds.length === 0) return bumpRev(current);
  const removed = new Set(removedChoiceIds);
  const filtered = Object.fromEntries(
    Object.entries(existing).filter(([, answer]) => !removed.has(answer)),
  );
  return commit(current, { ballots: { ...current.ballots, [questionId]: filtered } });
}

/**
 * 設問そのものを削除したときの後始末。applyResetQuestion と似ているが、
 * こちらは設問がもう存在しないので、出題中だった場合は activeQuestionId
 * も null に戻す（applyResetQuestion は設問自体は残る前提で phase だけ
 * idle にし、activeQuestionId はあえて維持している）。
 */
export function applyQuestionRemoved(current: SessionState, questionId: string): SessionState {
  const nextBallots = { ...current.ballots };
  delete nextBallots[questionId];
  const nextHidden = { ...current.hidden };
  delete nextHidden[questionId];
  const wasActive = current.activeQuestionId === questionId;
  return commit(current, {
    ballots: nextBallots,
    hidden: nextHidden,
    activeQuestionId: wasActive ? null : current.activeQuestionId,
    phase: wasActive ? "idle" : current.phase,
    revealed: wasActive ? false : current.revealed,
  });
}
