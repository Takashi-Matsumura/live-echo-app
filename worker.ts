// wrangler.jsonc の main エントリポイント。
// OpenNext が生成する Next.js 用ハンドラに、SessionDO（Durable Object）を
// 合流させて1つの Worker としてエクスポートする。
// .open-next/worker.js はビルド成果物なので、存在有無で @ts-expect-error の
// 要否が変わってしまう @ts-ignore を使う（tsc は常に無視、lint はこの行だけ許可）。
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { default as handler } from "./.open-next/worker.js";

export default {
  fetch: handler.fetch,
} satisfies ExportedHandler<CloudflareEnv>;

export { SessionDO } from "./lib/session/session-do";
