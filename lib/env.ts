/**
 * 環境変数の fail-fast 検証。Workers には「起動時に一度だけ」実行される
 * フックが無いため、validateEnv() は app/api/health/route.ts から呼び、
 * 開演前チェックとして未設定に気づけるようにしてある。
 */

import { base32Decode } from "@/lib/auth/totp";

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`環境変数 ${name} が未設定です。.env.local を確認してください。`);
  }
  return value;
}

/** TOTP_SECRET が使い物になる値かを検証する。タイポした値は Authenticator
 *  アプリへの登録（QR表示）自体は成功してしまい、「登録できたのにコードが
 *  一致しない」という切り分けの難しい事故になるため、ここで弾く。 */
const MIN_TOTP_SECRET_BYTES = 10; // 80bit相当

function validateTotpSecret(value: string): string {
  const decoded = base32Decode(value);
  if (!decoded || decoded.byteLength < MIN_TOTP_SECRET_BYTES) {
    throw new Error(
      "環境変数 TOTP_SECRET が不正です（Base32 として解釈できないか短すぎます）。" +
        "node scripts/generate-totp-secret.mjs で生成し直してください。",
    );
  }
  return value;
}

export const env = {
  get ADMIN_PASSWORD(): string {
    return readEnv("ADMIN_PASSWORD");
  },
  get SESSION_SECRET(): string {
    return readEnv("SESSION_SECRET");
  },
  get TOTP_SECRET(): string {
    return validateTotpSecret(readEnv("TOTP_SECRET"));
  },
  /**
   * 未設定なら null。設定時は QR / present 画面の URL 生成を上書きする。
   * ブラケット記法（process.env["PUBLIC_BASE_URL"]）で読むのが重要: ドット記法
   * （process.env.PUBLIC_BASE_URL）で書くと Next.js のビルド時バンドラがそれを
   * リテラル参照とみなし、ビルド時点の .env.local 等の値をそのまま静的置換して
   * しまう。開発機の Tailscale IP のようなローカル上書きが Cloudflare Worker
   * バンドルに焼き込まれ、本番の Host ヘッダー由来の正しい URL を黙って上書き
   * してしまう、というのが実際に起きたバグ。上の readEnv() も同じブラケット
   * 記法を既に使っているが、あちらは ADMIN_PASSWORD / SESSION_SECRET を
   * Cloudflare Secrets からランタイムに解決するため（そもそもビルドへ焼き込ま
   * れては困る）の対策で、狙いは異なる。
   */
  get PUBLIC_BASE_URL(): string | null {
    const v = process.env["PUBLIC_BASE_URL"]?.trim();
    return v && v.length > 0 ? v : null;
  },
};

export function validateEnv(): void {
  void env.ADMIN_PASSWORD;
  void env.SESSION_SECRET;
  void env.TOTP_SECRET;
}
