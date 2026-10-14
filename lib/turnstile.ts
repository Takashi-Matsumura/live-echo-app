/**
 * Turnstile まわりでサーバとクライアントが共有する定数。環境変数や DOM に
 * 触れない純粋なモジュールにしてあり、どちら側からも import できる
 * （検証は lib/auth/turnstile.ts、ウィジェットは lib/turnstile-client.ts）。
 */

/** 投票フォームの FormData にトークンを載せるフィールド名（Turnstile の既定名）。 */
export const TURNSTILE_FIELD = "cf-turnstile-response";
