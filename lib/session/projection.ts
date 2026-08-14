import { getQuestionById, getQuestionIndex } from "@/lib/questions";
import type {
  PublicResults,
  PublicState,
  Question,
  Role,
  SessionState,
} from "@/lib/types";

/**
 * ★SessionState → PublicState。結果開示ゲートはここ1箇所だけ。
 *
 * UI 側で `if (revealed) render(chart)` としてはいけない — サーバから counts /
 * answers が出た時点で DevTools から読めてしまう。「講師が結果開示を制御する」
 * 要件を満たすには、シリアライズ層でここだけが public/admin を切り分ける。
 *
 * questions は DO インスタンスが保持する現在の設問リスト
 * （lib/session/session-do.ts の this.questions）をそのつど渡す。設問を
 * 管理画面で編集した直後でも、ここで毎回引き直すので古い内容を
 * 配信することはない。
 */
export function toPublicState(
  state: SessionState,
  questions: readonly Question[],
  role: Role,
): PublicState {
  const question = state.activeQuestionId
    ? (getQuestionById(questions, state.activeQuestionId) ?? null)
    : null;

  const ballotsForQuestion =
    (state.activeQuestionId && state.ballots[state.activeQuestionId]) || {};
  const answeredCount = Object.keys(ballotsForQuestion).length;

  // admin（管理画面・投影モード）は締切タイミングを判断するため revealed に
  // 関係なく常に結果を見る。参加者は revealed === true のときだけ。
  const shouldShowResults = role === "admin" || state.revealed;
  const hiddenIds =
    (state.activeQuestionId && state.hidden[state.activeQuestionId]) || [];
  const results =
    shouldShowResults && question
      ? buildResults(question, ballotsForQuestion, hiddenIds, role)
      : null;

  const position = question
    ? { index: getQuestionIndex(questions, question.id), total: questions.length }
    : null;

  return {
    rev: state.rev,
    phase: state.phase,
    revealed: state.revealed,
    question,
    answeredCount,
    results,
    position,
  };
}

function buildResults(
  question: Question,
  ballots: Readonly<Record<string, string>>,
  hiddenParticipantIds: readonly string[],
  role: Role,
): PublicResults {
  if (question.kind === "choice") {
    const counts: Record<string, number> = {};
    for (const choice of question.choices) counts[choice.id] = 0;
    for (const answer of Object.values(ballots)) {
      if (answer in counts) counts[answer] += 1;
    }
    return { kind: "choice", counts };
  }

  const hiddenSet = new Set(hiddenParticipantIds);
  const entries = Object.entries(ballots);

  // admin（モデレーション UI）は伏せた回答も含めて全件見える必要がある
  // （でなければ一度伏せた回答を選んで戻すすべが無くなる）。id には
  // 実際の participantId をそのまま使い、hideAnswer/unhideAnswer の引数にする。
  if (role === "admin") {
    return {
      kind: "text",
      answers: entries.map(([id, text]) => ({
        id,
        text,
        hidden: hiddenSet.has(id),
      })),
    };
  }

  // 参加者・投影向け: 伏せられた回答は完全に除外し、匿名 cookie の値を
  // ブロードキャストで流さないよう設問内の連番に置き換える。
  const visible = entries.filter(([participantId]) => !hiddenSet.has(participantId));
  return {
    kind: "text",
    answers: visible.map(([, text], index) => ({ id: `a${index}`, text })),
  };
}
