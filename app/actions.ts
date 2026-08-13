"use server";

import { getOrCreateParticipantId } from "@/lib/auth/participant";
import { checkRateLimit } from "@/lib/rate-limit";
import { castVote } from "@/lib/session/service";
import type { VoteResult } from "@/lib/types";

const VOTE_LIMIT = 20;
const VOTE_WINDOW_MS = 60_000;

/**
 * questionId は各投票フォームで `.bind(null, question.id)` により固定される
 * （progressive enhancement: JS 無効でもフォームのネイティブ送信で動く。
 * JS 有効時はクライアント側で preventDefault してこの関数を直接 await し、
 * 結果に応じて楽観更新する）。answer は FormData の "answer" フィールド
 * （選択式は hidden input、自由記述は textarea）から読む。
 */
export async function submitVote(
  questionId: string,
  formData: FormData,
): Promise<VoteResult> {
  const participantId = await getOrCreateParticipantId();

  if (!checkRateLimit(`vote:${participantId}`, VOTE_LIMIT, VOTE_WINDOW_MS)) {
    return { ok: false, reason: "rate-limited" };
  }

  const answer = String(formData.get("answer") ?? "");
  return castVote(participantId, questionId, answer);
}
