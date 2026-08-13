import { networkInterfaces } from "node:os";
import { env } from "@/lib/env";

// リンクローカルアドレスと、Bonjour/VPN/ブリッジ系の仮想インターフェースは
// 参加者が実際に到達できないため候補から除外する。
const EXCLUDE_IFACE_PREFIXES = ["awdl", "llw", "utun", "bridge", "lo", "anpi"];
// Mac Studio では有線 LAN（トラベルルータの LAN ポート）を想定しているので、
// en0/en1 を優先する。
const PRIORITY_IFACES = ["en0", "en1"];

export type LanCandidate = {
  readonly iface: string;
  readonly address: string;
  readonly url: string;
};

export function getLanCandidates(port: number): LanCandidate[] {
  const nets = networkInterfaces();
  const candidates: LanCandidate[] = [];

  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    if (EXCLUDE_IFACE_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      if (addr.address.startsWith("169.254.")) continue; // link-local
      candidates.push({ iface: name, address: addr.address, url: `http://${addr.address}:${port}` });
    }
  }

  candidates.sort((a, b) => {
    const rankA = PRIORITY_IFACES.indexOf(a.iface);
    const rankB = PRIORITY_IFACES.indexOf(b.iface);
    const normalizedA = rankA === -1 ? PRIORITY_IFACES.length : rankA;
    const normalizedB = rankB === -1 ? PRIORITY_IFACES.length : rankB;
    return normalizedA - normalizedB;
  });

  return candidates;
}

/**
 * QR / 投影画面に載せる URL。`PUBLIC_BASE_URL` が設定されていれば最優先
 * （自動検出が外れた場合の逃げ道）。それ以外は検出した LAN IP の先頭候補、
 * 何も見つからなければ localhost にフォールバックする。
 */
export function getPreferredBaseUrl(port: number): string {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL;
  const [first] = getLanCandidates(port);
  return first?.url ?? `http://localhost:${port}`;
}

export function getServerPort(): number {
  const fromEnv = Number(process.env.PORT);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 3000;
}
