import { headers } from "next/headers";
import { normalizeIpKey } from "@/lib/auth/ip-key";

/**
 * リクエスト元の IP。Cloudflare が付与する cf-connecting-ip はクライアントが
 * 偽装できないため最優先で使う。x-forwarded-for / x-real-ip はローカル
 * next dev でのフォールバック用に残す。どれも無ければ null。
 */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf;
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || null;
}

/**
 * IP 単位のレート制限のキー。IPv6 は /64 に丸める（lib/auth/ip-key.ts 参照。
 * アドレスを変えるだけで制限を抜けられないようにする）。
 */
export async function clientIpKey(): Promise<string> {
  return normalizeIpKey((await clientIp()) ?? "unknown");
}
