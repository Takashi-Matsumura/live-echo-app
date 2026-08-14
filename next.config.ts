import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {};

export default nextConfig;

// next dev でも wrangler.jsonc のバインディング（DO 等）にアクセスできるようにする。
initOpenNextCloudflareForDev();
