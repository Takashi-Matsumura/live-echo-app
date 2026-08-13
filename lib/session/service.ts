import { runtime } from "@/lib/session/runtime";
import { toPublicState } from "@/lib/session/projection";
import { persistState } from "@/lib/persistence";
import {
  DEFAULT_TEXT_MAX_LENGTH,
  getAdjacentQuestionId,
  getQuestionById,
  isValidChoiceId,
} from "@/lib/questions";
import type {
  Phase,
  PersonalState,
  PublicState,
  Role,
  SessionState,
  VoteResult,
} from "@/lib/types";

const VOTE_BROADCAST_DEBOUNCE_MS = 100;

function persistInBackground(state: SessionState): void {
  void persistState(state).catch((err: unknown) => {
    console.error("[live-echo] data/session.json の書き込みに失敗しました", err);
  });
}

/**
 * SessionState の差分適用ヘルパー。rev のインクリメントと updatedAt の更新を
 * ここに集約する。
 *
 * ★不変条件: mutate 系の関数（このファイル内）は途中で await しない。
 * Node は単一スレッドなので、この条件さえ守れば「読む→計算する→差し替える」は
 * アトミックになり、追加のロックは不要。
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

// broadcast と永続化はタイミングの粒度が同じ（即時 / デバウンス）なので
// ここでまとめて行う。管理操作は即時、投票はまとめて — というのが両方に
// 共通する方針: 管理操作の反映を遅らせたくない一方、投票は同時多発するので
// 都度ディスクに書くと I/O が無駄に増える。
function broadcastNow(state: SessionState): void {
  const rt = runtime();
  if (rt.broadcastTimer) {
    clearTimeout(rt.broadcastTimer);
    rt.broadcastTimer = null;
  }
  rt.broadcaster.publish(state);
  persistInBackground(state);
}

/** 投票由来の更新をまとめて配信・永続化する。管理操作は broadcastNow を使うこと */
function broadcastDebounced(): void {
  const rt = runtime();
  if (rt.broadcastTimer) clearTimeout(rt.broadcastTimer);
  rt.broadcastTimer = setTimeout(() => {
    rt.broadcastTimer = null;
    const latest = rt.store.get();
    rt.broadcaster.publish(latest);
    persistInBackground(latest);
  }, VOTE_BROADCAST_DEBOUNCE_MS);
}

// ── 購読 / 読み取り ─────────────────────────────────────────

/** role ごとに projection した PublicState を配信する購読を開始する */
export function subscribe(
  role: Role,
  onState: (state: PublicState) => void,
): () => void {
  const rt = runtime();
  return rt.broadcaster.subscribe((raw) => onState(toPublicState(raw, role)));
}

export function snapshotFor(role: Role): PublicState {
  return toPublicState(runtime().store.get(), role);
}

export function personalFor(participantId: string): PersonalState {
  const state = runtime().store.get();
  const questionId = state.activeQuestionId;
  if (!questionId) return { questionId: null, myAnswer: null };
  const answer = state.ballots[questionId]?.[participantId];
  return { questionId, myAnswer: answer ?? null };
}

// ── 参加者操作 ─────────────────────────────────────────────

export function castVote(
  participantId: string,
  questionId: string,
  rawAnswer: string,
): VoteResult {
  const question = getQuestionById(questionId);
  if (!question) return { ok: false, reason: "invalid" };

  const rt = runtime();
  const current = rt.store.get();

  if (current.activeQuestionId !== questionId) {
    // 回答している間に講師が別の設問に切り替えた
    return { ok: false, reason: "stale" };
  }
  if (current.phase !== "open") {
    return { ok: false, reason: "closed" };
  }

  let answer: string;
  if (question.kind === "choice") {
    if (!isValidChoiceId(question, rawAnswer)) {
      return { ok: false, reason: "invalid" };
    }
    answer = rawAnswer;
  } else {
    const trimmed = rawAnswer.trim();
    if (trimmed.length === 0) return { ok: false, reason: "invalid" };
    const maxLength = question.maxLength ?? DEFAULT_TEXT_MAX_LENGTH;
    if (trimmed.length > maxLength) return { ok: false, reason: "too-long" };
    answer = trimmed;
  }

  const questionBallots = current.ballots[questionId] ?? {};
  const next = commit(current, {
    ballots: {
      ...current.ballots,
      [questionId]: { ...questionBallots, [participantId]: answer },
    },
  });
  rt.store.set(next);
  broadcastDebounced();
  return { ok: true };
}

// ── 管理操作（すべて即時 broadcast） ─────────────────────────

export function selectQuestion(questionId: string): void {
  const question = getQuestionById(questionId);
  if (!question) throw new Error(`unknown question id: ${questionId}`);
  const rt = runtime();
  const next = commit(rt.store.get(), {
    activeQuestionId: questionId,
    phase: "open",
    revealed: false,
  });
  rt.store.set(next);
  broadcastNow(next);
}

export function goToAdjacentQuestion(dir: -1 | 1): void {
  const current = runtime().store.get();
  const targetId = getAdjacentQuestionId(current.activeQuestionId, dir);
  if (targetId === null) return;
  selectQuestion(targetId);
}

export function setPhase(phase: Phase): void {
  const rt = runtime();
  const next = commit(rt.store.get(), { phase });
  rt.store.set(next);
  broadcastNow(next);
}

export function setRevealed(revealed: boolean): void {
  const rt = runtime();
  const next = commit(rt.store.get(), { revealed });
  rt.store.set(next);
  broadcastNow(next);
}

export function hideAnswer(questionId: string, participantId: string): void {
  const rt = runtime();
  const current = rt.store.get();
  const existing = current.hidden[questionId] ?? [];
  if (existing.includes(participantId)) return;
  const next = commit(current, {
    hidden: { ...current.hidden, [questionId]: [...existing, participantId] },
  });
  rt.store.set(next);
  broadcastNow(next);
}

export function unhideAnswer(questionId: string, participantId: string): void {
  const rt = runtime();
  const current = rt.store.get();
  const existing = current.hidden[questionId] ?? [];
  if (!existing.includes(participantId)) return;
  const next = commit(current, {
    hidden: {
      ...current.hidden,
      [questionId]: existing.filter((id) => id !== participantId),
    },
  });
  rt.store.set(next);
  broadcastNow(next);
}

export function resetQuestion(questionId: string): void {
  const rt = runtime();
  const current = rt.store.get();
  const nextBallots = { ...current.ballots };
  delete nextBallots[questionId];
  const nextHidden = { ...current.hidden };
  delete nextHidden[questionId];
  const isActive = current.activeQuestionId === questionId;
  const next = commit(current, {
    ballots: nextBallots,
    hidden: nextHidden,
    revealed: isActive ? false : current.revealed,
    phase: isActive ? "idle" : current.phase,
  });
  rt.store.set(next);
  broadcastNow(next);
}

export function resetAll(): void {
  const rt = runtime();
  const next = commit(rt.store.get(), {
    activeQuestionId: null,
    phase: "idle",
    revealed: false,
    ballots: {},
    hidden: {},
  });
  rt.store.set(next);
  broadcastNow(next);
}
