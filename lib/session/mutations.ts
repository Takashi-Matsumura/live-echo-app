import {
  DEFAULT_TEXT_MAX_LENGTH,
  getQuestionById,
  isValidChoiceId,
} from "@/lib/questions";
import type { Ballot, Phase, Question, SessionState, VoteResult } from "@/lib/types";

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
  rawAnswers: readonly string[],
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

  let answer: Ballot;
  if (question.kind === "choice") {
    const rawAnswer = rawAnswers[0];
    if (rawAnswers.length !== 1 || rawAnswer === undefined || !isValidChoiceId(question, rawAnswer)) {
      return { next: null, result: { ok: false, reason: "invalid" } };
    }
    answer = rawAnswer;
  } else if (question.kind === "multi") {
    // 悪意あるクライアントが上限なく送ってくる可能性を潰す:
    // 選択肢数を超える要素数は無条件で拒否する（切り詰めない）。
    if (rawAnswers.length === 0 || rawAnswers.length > question.choices.length) {
      return { next: null, result: { ok: false, reason: "invalid" } };
    }
    const selected = new Set(rawAnswers.filter((id) => isValidChoiceId(question, id)));
    if (selected.size === 0) {
      return { next: null, result: { ok: false, reason: "invalid" } };
    }
    // question.choices の順に正規化する（重複除去・表示順の安定化）。
    answer = question.choices.map((c) => c.id).filter((id) => selected.has(id));
  } else {
    const rawAnswer = rawAnswers[0] ?? "";
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
    // 新しい投票ラウンドを開始する操作なので、/present の固定表示
    // （presentQuestionId）は自動的に解除し、ライブ追従に戻す。固定した
    // ままだと「投票を再開したのに投影は古い結果のまま」という食い違いが
    // 起きるため（この設問を再度出題した場合を含む）。
    presentQuestionId: null,
    // この設問を過去に公開していても、新しいラウンドが始まった以上いったん
    // 「未公開」に戻す。再公開されれば applySetRevealed がまた追加する。
    // これをしないと、出題中で結果がまだ非公開の設問が参加者の「過去の
    // 結果」一覧に古い集計のまま出てしまう。
    revealedQuestionIds: current.revealedQuestionIds.filter((id) => id !== questionId),
  });
}

export function applySetPhase(current: SessionState, phase: Phase): SessionState {
  return commit(current, { phase });
}

export function applySetRevealed(current: SessionState, revealed: boolean): SessionState {
  // 結果を公開した瞬間、その設問idを「一度でも公開した」集合に記録する。
  // 参加者の「過去の結果」振り返り（PublicState.pastQuestions）が
  // 参照する唯一の書き込み経路 ── ここを通らない限り、参加者はどの設問の
  // 結果も振り返れない（講師が結果開示を制御する原則を振り返り機能でも守る）。
  const activeId = current.activeQuestionId;
  const revealedQuestionIds =
    revealed && activeId && !current.revealedQuestionIds.includes(activeId)
      ? [...current.revealedQuestionIds, activeId]
      : current.revealedQuestionIds;
  return commit(current, { revealed, revealedQuestionIds });
}

/** /present の固定表示先を切り替える。null で解除（ライブ追従に戻す）。 */
export function applySetPresentQuestion(
  current: SessionState,
  questionId: string | null,
): SessionState {
  return commit(current, { presentQuestionId: questionId });
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
    // 固定表示先の回答を消したなら、空の結果が投影に残らないよう解除する。
    presentQuestionId:
      current.presentQuestionId === questionId ? null : current.presentQuestionId,
    // 回答を消した以上、参加者の「過去の結果」からも除く（空の結果を
    // 振り返らせても意味が無い。再度公開されれば applySetRevealed が
    // また追加する）。
    revealedQuestionIds: current.revealedQuestionIds.filter((id) => id !== questionId),
  });
}

export function applyResetAll(current: SessionState): SessionState {
  return commit(current, {
    activeQuestionId: null,
    phase: "idle",
    revealed: false,
    ballots: {},
    hidden: {},
    presentQuestionId: null,
    revealedQuestionIds: [],
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
    Object.entries(existing)
      .map(([participantId, answer]): [string, Ballot | null] => {
        if (typeof answer !== "string") {
          // 複数選択: 削除された選択肢だけを抜く。全部消えたらエントリごと除外。
          const remaining = answer.filter((id) => !removed.has(id));
          return [participantId, remaining.length > 0 ? remaining : null];
        }
        // 単一選択: 削除された選択肢に投票していた票ごと除外。
        return [participantId, removed.has(answer) ? null : answer];
      })
      .filter((entry): entry is [string, Ballot] => entry[1] !== null),
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
    presentQuestionId:
      current.presentQuestionId === questionId ? null : current.presentQuestionId,
    revealedQuestionIds: current.revealedQuestionIds.filter((id) => id !== questionId),
  });
}
