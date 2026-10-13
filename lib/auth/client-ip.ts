import { headers } from "next/headers";

/**
 * レートリミット用のクライアント識別キー。Cloudflare が付与する
 * cf-connecting-ip はクライアントが偽装できない（Cloudflare が上書きする）
 * ため最優先で使う。x-forwarded-for / x-real-ip はローカル next dev での
 * フォールバック用に残す。
 *
 * ログイン試行（lib/auth/admin.ts）と投票（app/actions.ts）の両方から使う。
 */
export async function clientIpKey(): Promise<string> {
  const h = await headers();
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf;
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || "unknown";
}
