/**
 * レートリミットのキーにする IP アドレスの正規化。I/O を持たない純粋関数
 * （lib/auth/constant-time.ts と同じ「単一責務の小さなモジュール」）。
 *
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
