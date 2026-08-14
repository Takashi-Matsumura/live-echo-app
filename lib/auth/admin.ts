import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac } from "node:crypto";
import { safeEqualStrings } from "@/lib/auth/constant-time";
import {
  base32Decode,
  buildOtpauthUri,
  normalizeTotpCode,
  totpSecretFingerprint,
  verifyTotpCode,
} from "@/lib/auth/totp";
import { env } from "@/lib/env";
import { getSessionStub } from "@/lib/session/stub";
import type { Role } from "@/lib/types";

const COOKIE_NAME = "le_admin";
const TTL_MS = 12 * 60 * 60 * 1000; // 12時間
const TOTP_ISSUER = "live-echo-app";
const TOTP_ACCOUNT_LABEL = "admin";

function sign(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
}

export async function issueAdminSession(): Promise<void> {
  const exp = String(Date.now() + TTL_MS);
  const store = await cookies();
  store.set(COOKIE_NAME, `${exp}.${sign(`admin|${exp}`)}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: TTL_MS / 1000,
    // Cloudflare は HTTPS のみなので true で問題ない
    // （会場 LAN の http:// 運用は廃止した）。
    secure: true,
  });
}

export async function clearAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** Server Component からも呼べる（read のみ） */
export async function isAdmin(): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE_NAME)?.value;
  if (!raw) return false;
  const dot = raw.indexOf(".");
  if (dot === -1) return false;
  const exp = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  if (!exp || !mac) return false;
  if (Number(exp) < Date.now()) return false;
  return safeEqualStrings(mac, sign(`admin|${exp}`));
}

/** Server Component 用。未認証ならログイン画面へリダイレクト */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}

/**
 * /api/stream・/api/state の role 決定に使う。
 *
 * ★重要: le_admin Cookie は path: "/" なので、講師が管理画面にログイン
 * した後で同じブラウザの別タブ（あるいは同じ端末）で参加者用の "/" を
 * 開くと、isAdmin() が true になってしまう。それだけを根拠に role を
 * 決めると、講師の端末が参加者ページを開いた瞬間に非公開の集計や
 * 伏せた自由記述まで見えてしまう。
 *
 * そのため「このリクエストがどの画面から来たか」をクエリの view で
 * 明示させ、isAdmin() が true でも view=participant のときは強制的に
 * 降格する。安全性は isAdmin() 側にある: view=admin を偽って付けても
 * isAdmin() が false なら決して 'admin' にはならない（降格方向にしか
 * 効かないクエリなので、なりすましの入り口にはならない）。
 */
export function resolveRole(request: Request, actuallyAdmin: boolean): Role {
  const view = new URL(request.url).searchParams.get("view");
  if (view === "participant") return "participant";
  return actuallyAdmin ? "admin" : "participant";
}

/**
 * Server Action 用。未認証なら throw。
 * Proxy の matcher で保護しても Server Action は別ルート扱いで保護から漏れうる
 * ため、各アクションの先頭で必ずこれを呼ぶ。
 */
export async function assertAdmin(): Promise<void> {
  if (!(await isAdmin())) throw new Error("Unauthorized");
}

/**
 * ログイン試行のレートリミット用キー。Cloudflare が付与する
 * cf-connecting-ip はクライアントが偽装できない（Cloudflare が上書きする）
 * ため最優先で使う。x-forwarded-for / x-real-ip はローカル next dev での
 * フォールバック用に残す。
 */
async function loginRateLimitKey(): Promise<string> {
  const h = await headers();
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf;
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip") || "unknown";
}

/** attemptAdminLogin() の内部でのみ使う。TOTP を経由せずセッションを
 *  発行できる経路を型レベルで無くすため export しない。 */
async function verifyPassword(candidate: string): Promise<boolean> {
  const key = await loginRateLimitKey();
  const stub = await getSessionStub();
  if (!(await stub.checkLoginRate(key))) {
    return false;
  }
  return safeEqualStrings(candidate, env.ADMIN_PASSWORD);
}

/** otpauth ラベルにホスト名を含める。preview（.env.local のシークレット）
 *  と本番（Cloudflare Secrets のシークレット）は別値なので、これが無いと
 *  Authenticator アプリ内で2つのエントリを区別できず事故る。 */
async function totpAccountLabel(): Promise<string> {
  const h = await headers();
  const host = h.get("host")?.trim();
  return host ? `${TOTP_ACCOUNT_LABEL}@${host.slice(0, 64)}` : TOTP_ACCOUNT_LABEL;
}

export type LoginAttemptResult =
  | { readonly kind: "ok" } // ★セッション発行済み。呼び出し側は redirect するだけでよい
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "totp-setup";
      readonly otpauthUri: string;
      readonly manualSecret: string;
      /** 初回表示なら null。誤入力後の再表示なら文言が入る（QRを消さないため） */
      readonly message: string | null;
    };

const GENERIC_TOTP_ERROR = "認証コードが正しくありません。";
const LOCKED_OUT_ERROR = "試行回数の上限に達しました。しばらくしてから再度お試しください。";

/**
 * パスワード＋TOTPコードの2要素ログインを1箇所で判定する。パスワードが
 * 合っていて未登録（またはシークレットがローテーションされて指紋が
 * 一致しない）なら QR を返す。セッション発行（issueAdminSession）は
 * TOTP まで通過した場合にのみこの関数の内側で行う — union の判定を
 * 呼び出し側で誤ってもTOTPを迂回してセッションが発行されることがない
 * ようにするため。
 */
export async function attemptAdminLogin(
  password: string,
  rawCode: string,
): Promise<LoginAttemptResult> {
  if (!(await verifyPassword(password))) {
    return {
      kind: "error",
      message: "パスワードが違うか、試行回数の上限に達しました。しばらくしてから再度お試しください。",
    };
  }

  let totpSecret: string;
  try {
    totpSecret = env.TOTP_SECRET;
  } catch (err) {
    console.error("[live-echo] TOTP_SECRET の読み込みに失敗しました", err);
    return { kind: "error", message: "サーバ設定に問題があります。管理者に連絡してください。" };
  }
  const key = base32Decode(totpSecret);
  if (!key) {
    console.error("[live-echo] TOTP_SECRET が Base32 として不正です");
    return { kind: "error", message: "サーバ設定に問題があります。管理者に連絡してください。" };
  }
  const fingerprint = totpSecretFingerprint(totpSecret);

  const stub = await getSessionStub();
  const gate = await stub.getTotpGate(fingerprint);
  if (gate.lockedOut) {
    return { kind: "error", message: LOCKED_OUT_ERROR };
  }

  const code = normalizeTotpCode(rawCode);

  if (!gate.registered) {
    const account = await totpAccountLabel();
    const otpauthUri = buildOtpauthUri(totpSecret, account, TOTP_ISSUER);

    if (code === null) {
      // 初回表示。まだ何も試行していないのでレート予算は消費しない。
      return { kind: "totp-setup", otpauthUri, manualSecret: totpSecret, message: null };
    }

    const verified = verifyTotpCode(key, code, Date.now());
    if (!verified.ok) {
      await stub.recordTotpAttempt(fingerprint, { ok: false });
      return {
        kind: "totp-setup",
        otpauthUri,
        manualSecret: totpSecret,
        message: GENERIC_TOTP_ERROR,
      };
    }
    const { accepted } = await stub.recordTotpAttempt(fingerprint, {
      ok: true,
      step: verified.step,
    });
    if (!accepted) {
      return {
        kind: "totp-setup",
        otpauthUri,
        manualSecret: totpSecret,
        message: GENERIC_TOTP_ERROR,
      };
    }
    await issueAdminSession();
    return { kind: "ok" };
  }

  // 登録済み。
  if (code === null) {
    return { kind: "error", message: "認証コードを入力してください。" };
  }
  const verified = verifyTotpCode(key, code, Date.now());
  if (!verified.ok) {
    await stub.recordTotpAttempt(fingerprint, { ok: false });
    return { kind: "error", message: GENERIC_TOTP_ERROR };
  }
  const { accepted } = await stub.recordTotpAttempt(fingerprint, {
    ok: true,
    step: verified.step,
  });
  if (!accepted) {
    // 同じステップのコードが既に使用済み（リプレイ）。
    return { kind: "error", message: GENERIC_TOTP_ERROR };
  }
  await issueAdminSession();
  return { kind: "ok" };
}
