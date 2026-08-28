import { answerText, getQuestionById, getQuestionIndex, isChoiceLike, selectedChoiceIds } from "@/lib/questions";
import type {
  Ballot,
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
    presentOverride: buildPresentOverride(state, questions, role),
    pastQuestions: buildPastQuestions(state, questions),
  };
}

/**
 * 参加者の「過去の結果」一覧に出す設問（一度でも公開されたもの）。
 * role を問わず同じ内容を配る ── 設問文は公開時点で既に見えていた情報
 * なので機密性は無い。実際の集計値はここには含めず、
 * GET /api/results?questionId=... で別途取得させる（resultsForQuestion
 * が revealedQuestionIds を再確認するので、ここでの絞り込みは表示上の
 * 一覧を作るためだけで、実際のアクセス制御はそちら側にもある）。
 *
 * ★以前は「今アクティブな設問はどのみちライブで見えているので除外する」
 * としていたが、それだと出題中の設問を切り替えて戻すだけで一覧から
 * 消えたり現れたりして分かりづらかった（実運用で確認された）。今は
 * アクティブかどうかに関わらず、公開済みなら常に一覧に出す。ライブ画面と
 * 一覧の両方に同じ設問が出ることになるが、実害は無い単純な重複でしかない。
 */
function buildPastQuestions(
  state: SessionState,
  questions: readonly Question[],
): PublicState["pastQuestions"] {
  const result: { id: string; prompt: string }[] = [];
  for (const id of state.revealedQuestionIds) {
    const question = getQuestionById(questions, id);
    if (question) result.push({ id: question.id, prompt: question.prompt });
  }
  return result;
}

/**
 * questionId を指定して、公開済みの設問の結果を取り出す
 * （GET /api/results ルートハンドラ専用）。revealedQuestionIds に無い
 * questionId には null を返す ── 講師がまだ公開していない集計や、
 * リセット・削除済みの設問を、URL 直叩きで参加者に取得されないための
 * サーバー側ゲート（buildPastQuestions が一覧に出すかどうかとは独立に、
 * ここでも必ず再検証する）。
 */
export function resultsForQuestion(
  state: SessionState,
  questions: readonly Question[],
  questionId: string,
  role: Role,
): { readonly question: Question; readonly results: PublicResults } | null {
  if (!state.revealedQuestionIds.includes(questionId)) return null;
  const question = getQuestionById(questions, questionId);
  if (!question) return null;
  const ballots = state.ballots[question.id] ?? {};
  const hiddenIds = state.hidden[question.id] ?? [];
  return { question, results: buildResults(question, ballots, hiddenIds, role) };
}

/**
 * /present の固定表示（SessionState.presentQuestionId）を role === "admin"
 * にだけ配る。participant には一切見せない（そもそも関係ない情報だが、
 * 念のため他の admin 専用情報と同じ扱いに揃える）。
 *
 * 固定先の設問は「もう投票を受け付けていない」前提（現在の
 * activeQuestionId と一致しない限り、applyCastVote が activeQuestionId
 * 一致を要求するため新規回答が入り得ない）なので、revealed のゲートは
 * 通さず常に結果を返す ── これは admin が明示的に選んだ操作であり、
 * 参加者向けの結果開示タイミング制御（shouldShowResults）とは別の話。
 */
function buildPresentOverride(
  state: SessionState,
  questions: readonly Question[],
  role: Role,
): PublicState["presentOverride"] {
  if (role !== "admin" || !state.presentQuestionId) return null;
  const question = getQuestionById(questions, state.presentQuestionId);
  if (!question) return null;
  const ballots = state.ballots[question.id] ?? {};
  const hiddenIds = state.hidden[question.id] ?? [];
  return { question, results: buildResults(question, ballots, hiddenIds, role) };
}

function buildResults(
  question: Question,
  ballots: Readonly<Record<string, Ballot>>,
  hiddenParticipantIds: readonly string[],
  role: Role,
): PublicResults {
  if (isChoiceLike(question)) {
    const counts: Record<string, number> = {};
    for (const choice of question.choices) counts[choice.id] = 0;
    for (const answer of Object.values(ballots)) {
      for (const id of selectedChoiceIds(answer)) {
        if (id in counts) counts[id] += 1;
      }
    }
    // respondents はこの設問に回答した人数（% の分母）。単一選択では
    // counts の総和と一致するが、複数選択では一致しない。
    return { kind: "choice", counts, respondents: Object.keys(ballots).length };
  }

  const hiddenSet = new Set(hiddenParticipantIds);
  const entries = Object.entries(ballots)
    .map(([id, answer]): [string, string] => [id, answerText(answer) ?? ""])
    .filter(([, text]) => text.length > 0);

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
