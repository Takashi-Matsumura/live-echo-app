/**
 * DO（lib/session/session-do.ts）と Next.js の Route Handler の両方から
 * 参照するエラー定数だけを集めた、依存の無いファイル。
 *
 * ★session-do.ts は "cloudflare:workers" を import しており、これは
 * Workers ランタイム専用で Node.js（next build のページデータ収集）からは
 * 解決できない。Route Handler が session-do.ts を直接 import すると、
 * ビルド時に「Failed to load external module cloudflare:workers」で
 * 落ちる（実際に踏んだ）。エラー定数だけをここに独立させ、DO 側・
 * Route Handler 側の両方がこのファイルだけを import することで、
 * Route Handler から session-do.ts への依存を作らずに済ませる。
 */
export const SESSION_FULL_ERROR = "SESSION_FULL";
