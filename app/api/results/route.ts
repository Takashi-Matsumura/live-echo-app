import { isAdmin, resolveRole } from "@/lib/auth/admin";
import { getResultsFor } from "@/lib/session/service";

/**
 * 参加者の「過去の結果」振り返り専用（components/participant-screen.tsx）。
 * PublicState.pastQuestions が一覧（id・設問文のみ）を返すのに対し、
 * こちらは実際の集計値を1問ぶんだけ取りに行く。
 *
 * ★アクセス制御はここではなく lib/session/projection.ts の
 * resultsForQuestion 側にある ── questionId が
 * SessionState.revealedQuestionIds に無ければ（講師がまだ公開していない、
 * またはリセット・削除済み）null を返し、この route は 404 にする。
 * pastQuestions に出ていない questionId を URL で直接叩かれても、
 * 同じ関数が再検証するので結果は取れない。
 */
export async function GET(request: Request) {
  const questionId = new URL(request.url).searchParams.get("questionId");
  if (!questionId) {
    return new Response(null, { status: 400 });
  }

  const actuallyAdmin = await isAdmin();
  const role = resolveRole(request, actuallyAdmin);

  const result = await getResultsFor(questionId, role);
  if (!result) {
    return new Response(null, { status: 404 });
  }

  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
