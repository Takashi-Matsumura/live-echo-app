import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 開発中に会場 LAN のスマホから http://<IP>:3000 へ next dev でアクセス
  // する場合に必要（dev アセットのクロスオリジンブロックを避ける）。
  // 当日の本番運用は next build && next start を使い、next dev は使わない。
  // 100.*.*.* は Tailscale の CGNAT アドレス範囲（100.64.0.0/10）を含む
  // ワイルドカード（実機検証で Tailscale 経由アクセスする場合に必要）。
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*", "100.*.*.*"],
};

export default nextConfig;
