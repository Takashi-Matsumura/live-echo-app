"use server";

import { getOrCreateParticipantId } from "@/lib/auth/participant";
import { castVote } from "@/lib/session/service";
import type { VoteResult } from "@/lib/types";

/**
 * questionId は各投票フォームで `.bind(null, question.id)` により固定される
 * （progressive enhancement: JS 無効でもフォームのネイティブ送信で動く。
 * JS 有効時はクライアント側で preventDefault してこの関数を直接 await し、
 * 結果に応じて楽観更新する）。answer は FormData の "answer" フィールド
 * （選択式は hidden input、自由記述は textarea）から常に配列で読む
 * （getAll。複数選択式は checkbox で同名フィールドを複数送る）。
 *
 * 投票のレート制限は Durable Object（castVote 内）で行う。同時多発する
 * リクエストがすべて DO の単一インスタンスを経由するため、そこで一元的に
 * 判定するのが自然かつ正確（Next.js の Worker 側は複数 isolate に
 * 分散しうるため、ここで独自にレート制限を持つと isolate ごとに別集計になる）。
 */
export async function submitVote(
  questionId: string,
  formData: FormData,
): Promise<VoteResult> {
  const participantId = await getOrCreateParticipantId();
  const answers = formData.getAll("answer").map((v) => String(v));
  return await castVote(participantId, questionId, answers);
}
