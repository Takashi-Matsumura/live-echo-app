import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// このアプリは全ページが動的（cookies() を読むため常に SSR）で、
// ISR/キャッシュを使わない。R2 等の追加バインディングは不要。
export default defineCloudflareConfig({});
