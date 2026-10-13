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
  if (cf) return normalizeIpKey(cf);
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return normalizeIpKey(forwarded || h.get("x-real-ip") || "unknown");
}

/**
 * IPv6 は先頭 64bit（/64）に丸める。IPv6 では1台の端末が /64 全体を
 * 使えるのが普通で、アドレスをそのままキーにすると、リクエストごとに
 * 送信元アドレスを変えるだけで IP 単位の制限を抜けられてしまう。
 * IPv4 と、IPv6 として解釈できない値はそのまま返す。
 */
export function normalizeIpKey(ip: string): string {
  if (!ip.includes(":") || ip.includes(".")) return ip;
  const [head, tail, ...rest] = ip.toLowerCase().split("::");
  if (rest.length > 0) return ip;
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return ip;
  const groups = [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return ip;
  const prefix = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, ""));
  return `${prefix.join(":")}::/64`;
}
