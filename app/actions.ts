"use server";

import { admitNewParticipant, peekParticipantId } from "@/lib/auth/participant";
import { castVote } from "@/lib/session/service";
import { TURNSTILE_FIELD } from "@/lib/turnstile";
import type { VoteResult } from "@/lib/types";

/**
 * questionId は各投票フォームで `.bind(null, question.id)` により固定される
 * （JS 有効時はクライアント側で preventDefault してこの関数を直接 await し、
 * 結果に応じて楽観更新する）。answer は FormData の "answer" フィールド
 * （選択式は hidden input、自由記述は textarea）から常に配列で読む
 * （getAll。複数選択式は checkbox で同名フィールドを複数送る）。
 *
 * 参加者 ID（le_pid Cookie）は最初の投票時にここで発行する。まだ ID が
 * 無ければ Turnstile のトークンを要求し（"verification-required"）、
 * クライアント（lib/turnstile-client.ts）がトークンを取って送り直す。
 * 2回目以降の投票は Cookie があるのでトークン不要。この都合で、JS 無効の
 * ネイティブ送信では最初の1票を投じられない。
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
  const answers = formData.getAll("answer").map((v) => String(v));

  let participantId = await peekParticipantId();
  if (!participantId) {
    const admission = await admitNewParticipant(formData.get(TURNSTILE_FIELD));
    if (!admission.ok) return admission;
    participantId = admission.participantId;
  }
  return await castVote(participantId, questionId, answers);
}
