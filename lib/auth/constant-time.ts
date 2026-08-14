import { createHash, timingSafeEqual } from "node:crypto";

/**
 * 定時間文字列比較。lib/auth/admin.ts（パスワード検証）と lib/auth/totp.ts
 * （TOTPコード検証）の両方から使うため単一責務モジュールに切り出してある
 * （admin.ts ⇄ totp.ts の循環importを避けるため。lib/rate-limit.ts と同じ流儀）。
 *
 * 文字列長の違いで早期リターンしないよう、固定長ハッシュにしてから比較する。
 */
export function safeEqualStrings(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
