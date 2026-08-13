/**
 * 環境変数の fail-fast 検証。instrumentation.ts の起動処理から validateEnv() を
 * 呼び、未設定なら起動直後に例外で落とす（開演直前に気づくより遥かにまし）。
 */

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `環境変数 ${name} が未設定です。.env.local を作成し ADMIN_PASSWORD / SESSION_SECRET を設定してください。`,
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
  /** 未設定なら null。設定時は QR / present 画面の URL 生成を上書きする */
  get PUBLIC_BASE_URL(): string | null {
    const v = process.env.PUBLIC_BASE_URL?.trim();
    return v && v.length > 0 ? v : null;
  },
};

export function validateEnv(): void {
  void env.ADMIN_PASSWORD;
  void env.SESSION_SECRET;
}
