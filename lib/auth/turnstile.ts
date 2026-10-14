import { env } from "@/lib/env";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 5_000;
// Turnstile のトークンは最大 2048 文字（公式ドキュメントの上限）。
const MAX_TOKEN_LENGTH = 2048;

/**
 * Turnstile のトークンを Cloudflare に問い合わせて検証する。トークンは
 * 1回限り有効（同じトークンの2回目は Cloudflare 側が失敗を返す）なので、
 * ここで true が返ったトークンを使い回すことはできない。
 *
 * 問い合わせ自体が失敗した場合（タイムアウト・5xx）も false を返す ——
 * 検証できないまま参加者 ID を発行する経路を作らないため。
 */
export async function verifyTurnstileToken(token: string, ip: string | null): Promise<boolean> {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const result: unknown = await response.json();
    return (
      typeof result === "object" &&
      result !== null &&
      (result as { success?: unknown }).success === true
    );
  } catch {
    return false;
  }
}
