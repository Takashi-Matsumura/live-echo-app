import type { VoteResult } from "@/lib/types";

export function voteErrorMessage(reason: Exclude<VoteResult, { ok: true }>["reason"]): string {
  switch (reason) {
    case "closed":
      return "この設問はいま受付を締め切っています。";
    case "stale":
      return "設問が切り替わりました。画面を確認してもう一度お試しください。";
    case "invalid":
      return "無効な回答です。";
    case "too-long":
      return "文字数が上限を超えています。";
    case "rate-limited":
      return "少し間隔を空けてからもう一度お試しください。";
  }
}
