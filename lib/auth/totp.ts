import { createHash, createHmac } from "node:crypto";
import { safeEqualStrings } from "@/lib/auth/constant-time";

/**
 * RFC 6238（TOTP）/ RFC 4226（HOTP）の純粋関数の集まり。I/O は一切持たない
 * （lib/session/mutations.ts と同じ「純粋関数はここ、副作用は呼び出し側」の
 * 分離）。既存の暗号ユーティリティが全て node:crypto に統一されている
 * （crypto.subtle は未使用）ため、ここでも createHmac を使う。
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * RFC 4648 Base32 デコード。想定外の入力は例外を投げず null を返す
 * （lib/session/sanitize.ts の「想定外の形は捨てる」思想に合わせる —
 * ここで throw すると、シークレット設定ミスがログイン画面のエラーページに
 * 直結してしまう）。
 *
 * Authenticator アプリ・手動入力どちらも大小文字混在やパディング省略が
 * ありうるため、大文字化・空白/ハイフン除去・末尾"="除去で正規化してから
 * デコードする。
 */
export function base32Decode(input: string): Uint8Array | null {
  const normalized = input.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (normalized.length === 0) return null;

  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) return null; // アルファベット外（0/1/8/9 等を含む）
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  // 末尾に残った 8bit 未満の余りビットは仕様上捨てる。
  return new Uint8Array(bytes);
}

/** Authenticator アプリ入力・手動入力からの生文字列を検証用に正規化する。
 *  空白除去のうえ6桁の数字でなければ null（未入力と「入力したが不正」を
 *  呼び出し側で区別できるよう、空文字も null 扱いにする）。 */
export function normalizeTotpCode(raw: string): string | null {
  const trimmed = raw.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * counter を 8byte のビッグエンディアンに変換する。target: ES2017 のため
 * BigInt リテラル（0n 等）は使えないので、Number の hi/lo 32bit に分割して
 * 書き出す（counter は 2^53 を超えない範囲でしか使わないため精度は保たれる
 * — 30秒刻みで 2^32 に達するまで約4000億年かかる）。
 */
function counterToBytes(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  let hi = Math.floor(counter / 0x1_0000_0000);
  let lo = counter >>> 0; // ToUint32
  for (let i = 7; i >= 4; i--) {
    buf[i] = lo & 0xff;
    lo = lo >>> 8;
  }
  for (let i = 3; i >= 0; i--) {
    buf[i] = hi & 0xff;
    hi = hi >>> 8;
  }
  return buf;
}

/** RFC 6238: 与えられたステップ（30秒単位のカウンタ）ぶんの6桁コードを1つ計算する。 */
export function totpCodeForStep(key: Uint8Array, step: number): string {
  const hmac = createHmac("sha1", Buffer.from(key)).update(counterToBytes(step)).digest();
  // 動的切り出し（RFC 4226 §5.3）。offset は SHA-1 の出力20byteの範囲に収まる
  // （hmac[19] & 0x0f は最大15、hmac[offset+3] まで読んでも19番目まで）。
  const offset = hmac[19] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  // 最上位ビットを 0x7f でマスク済みなので code は 32bit 符号付き演算でも
  // 正の値に収まり、%10^digits は安全。
  const truncated = code % 10 ** TOTP_DIGITS;
  return String(truncated).padStart(TOTP_DIGITS, "0");
}

/**
 * 現在時刻を基準に ±window ステップ（既定 ±1 = 前後30秒）の範囲でコードを
 * 照合する。スマホ側の時刻ズレを吸収するための許容幅で、サーバ側の時刻は
 * Date.now()（Cloudflare の時刻同期に依存）をそのまま使えばよい —
 * TOTP はタイムゾーンに関係なく Unix エポック秒基準。
 *
 * 一致したステップ番号を返すのはリプレイ防止（RFC 6238 §5.2）のため。
 * どのステップで一致したかがタイミングから漏れる可能性はあるが、
 * ステップ自体は時刻から公開情報として導出できるので実害はない。
 */
export function verifyTotpCode(
  key: Uint8Array,
  candidate: string,
  nowMs: number,
  window = 1,
): { ok: true; step: number } | { ok: false } {
  const currentStep = Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
  for (let offset = -window; offset <= window; offset++) {
    const step = currentStep + offset;
    if (safeEqualStrings(totpCodeForStep(key, step), candidate)) {
      return { ok: true, step };
    }
  }
  return { ok: false };
}

/**
 * シークレットの「指紋」。Durable Object にはシークレットの生値を保存せず、
 * この指紋だけを保存する（lib/session/session-do.ts の TotpRecord 参照）。
 * 素の sha256 で十分（TOTP_SECRET は160bit相当の高エントロピー値なので
 * 原像攻撃の懸念はない）。SESSION_SECRET で HMAC する案もあるが、それだと
 * SESSION_SECRET のローテーションに TOTP 登録が巻き添えで無効化される
 * 不要な結合が生まれるため避ける。
 */
export function totpSecretFingerprint(secretBase32: string): string {
  return createHash("sha256").update(secretBase32).digest("hex").slice(0, 16);
}

/**
 * Authenticator アプリ登録用の otpauth:// URI を組み立てる。
 * algorithm=SHA1・digits=6・period=30 は主要アプリ（Google Authenticator /
 * 1Password / Bitwarden / Aegis / Microsoft Authenticator）が無指定でも
 * 前提にする仕様上のデフォルトなので、あえて省略する。省くとURIが短くなり
 * QRのバージョンが下がって投影・撮影時の読み取り成功率が上がる。
 */
export function buildOtpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret: secretBase32, issuer });
  return `otpauth://totp/${label}?${params.toString()}`;
}
