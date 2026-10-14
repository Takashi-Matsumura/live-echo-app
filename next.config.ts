import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // クリックジャッキング対策。管理画面が参加者画面 "/" を iframe で
          // 埋め込んでいる（components/phone-preview.tsx）ので、DENY ではなく
          // 同一オリジンのみ許可する。frame-ancestors が現行の指定方法で、
          // X-Frame-Options は古いブラウザ向けの併記。
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

// next dev でも wrangler.jsonc のバインディング（DO 等）にアクセスできるようにする。
initOpenNextCloudflareForDev();
