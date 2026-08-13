import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

const COOKIE_NAME = "le_pid";
const MAX_AGE_SECONDS = 12 * 60 * 60; // 12時間
const UUID_PATTERN = /^[0-9a-f-]{36}$/;

/**
 * 参加者を識別する匿名 Cookie。GET /api/stream で発行するのが本流（参加者は
 * 必ずそこを開くので追加のラウンドトリップがゼロ）。submitVote の先頭でも
 * 同じ関数を呼ぶことで、SSE 接続より先に投票が飛ぶ競合にも耐える。
 *
 * ★ secure: true は絶対に付けない。会場運用は http:// なので、付けると
 * Cookie が一切保存されず全員が毎回別人になる。
 */
export async function getOrCreateParticipantId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;
  if (existing && UUID_PATTERN.test(existing)) {
    return existing;
  }
  const id = randomUUID();
  store.set(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
    secure: false,
  });
  return id;
}

/**
 * Server Component から読むだけの版（Cookie を発行しない）。
 * 初回訪問者は null が返り、呼び出し側は「未回答」として扱えばよい
 * （実際の Cookie 発行と正確な状態同期は GET /api/stream 接続時に行われる）。
 */
export async function peekParticipantId(): Promise<string | null> {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;
  return existing && UUID_PATTERN.test(existing) ? existing : null;
}
