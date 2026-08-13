/**
 * ストア実装の選択箇所。将来 Vercel（外部 KV 等）へ載せ替えるときは、
 * ここの export だけを差し替えれば lib/session/* 以下は変更不要。
 */
export { createMemoryStore as createStateStore } from "@/lib/store/memory-store";
export { createBroadcaster } from "@/lib/store/in-process-broadcaster";
export type { StateStore, Broadcaster, Listener } from "@/lib/store/ports";
