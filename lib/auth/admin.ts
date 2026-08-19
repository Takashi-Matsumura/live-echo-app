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
// アイドルタイムアウト: この時間操作が無ければ失効する（sliding）。
const IDLE_TTL_MS = 2 * 60 * 60 * 1000; // 2時間
// 絶対TTL: 操作を続けていても、発行から this を超えたら必ず失効する。
// 盗まれた Cookie がずっと使われ続ける（アイドルのたびに延命される）事態の
// 歯止め。IDLE_TTL_MS の延長を issueAdminSession() 時刻からここまでで頭打ちにする。
const ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000; // 12時間
const TOTP_ISSUER = "live-echo-app";
const TOTP_ACCOUNT_LABEL = "admin";

function sign(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
}

/**
 * le_admin Cookie は `iat.exp.gen.mac` の4パート:
 * - iat: セッション発行時刻（絶対TTLの起点。リフレッシュしても変わらない）
 * - exp: 現在の失効時刻（アイドルタイムアウトのたびに前進する。絶対TTLで頭打ち）
 * - gen: 発行時点の管理者セッション世代番号（lib/session/session-do.ts の
 *   adminSessionGen）。「全端末ログアウト」は DO 側でこの値を進めるだけで、
 *   古い gen を持つ Cookie は署名が正しくても以後 isAdmin() が false を返す。
 * - mac: 上記3つを HMAC で署名した値（改ざん防止）
 *
 * 署名検証まではここで完結する（DO 呼び出し不要）。gen の一致確認だけは
 * DO の現在値が要るため、呼び出し側（isAdmin / refreshAdminSession）で行う。
 */
function parseSignedAdminCookie(
  raw: string,
): { iat: number; exp: number; gen: number } | null {
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const [iatRaw, expRaw, genRaw, mac] = parts;
  if (!iatRaw || !expRaw || !genRaw || !mac) return null;
  if (!safeEqualStrings(mac, sign(`admin|${iatRaw}|${expRaw}|${genRaw}`))) return null;
  const iat = Number(iatRaw);
  const exp = Number(expRaw);
  const gen = Number(genRaw);
  if (!Number.isFinite(iat) || !Number.isFinite(exp) || !Number.isFinite(gen)) return null;
  return { iat, exp, gen };
}

function setAdminCookie(iat: number, exp: number, gen: number, store: Awaited<ReturnType<typeof cookies>>): void {
  const now = Date.now();
  store.set(COOKIE_NAME, `${iat}.${exp}.${gen}.${sign(`admin|${iat}|${exp}|${gen}`)}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(1, Math.floor((exp - now) / 1000)),
    // Cloudflare は HTTPS のみなので true で問題ない
    // （会場 LAN の http:// 運用は廃止した）。
    secure: true,
  });
}

export async function issueAdminSession(): Promise<void> {
  const stub = await getSessionStub();
  const gen = await stub.getAdminSessionGeneration();
  const iat = Date.now();
  const exp = iat + IDLE_TTL_MS; // 発行直後は iat===now なので絶対TTLには当たらない
  const store = await cookies();
  setAdminCookie(iat, exp, gen, store);
}

export async function clearAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** Server Component からも呼べる（read のみ）。DO への1往復を含む
 *  （gen の現在値確認のため） — 参加者の Cookie にはこの Cookie 自体が
 *  無いので、この往復が発生するのは管理者自身のリクエストだけ。 */
export async function isAdmin(): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE_NAME)?.value;
  if (!raw) return false;
  const parsed = parseSignedAdminCookie(raw);
  if (!parsed) return false;
  if (parsed.exp < Date.now()) return false;
  const stub = await getSessionStub();
  const currentGen = await stub.getAdminSessionGeneration();
  return parsed.gen === currentGen;
}

/**
 * アイドルタイムアウトの延長。isAdmin() が true を返した後に、Cookie を
 * 書き換えられる文脈（Server Action / Route Handler。Server Component から
 * は呼べない — cookies().set() が使えないため）でのみ呼ぶ。
 *
 * ここでも signature・exp・gen をすべて再検証してから書き換える（呼び出し側
 * が isAdmin() の結果を渡さず直接呼んでも安全なように、自己完結させてある）。
 * 既に失効・revoke 済みの Cookie を誤って延命させることはない。
 */
export async function refreshAdminSession(): Promise<void> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return;
  const parsed = parseSignedAdminCookie(raw);
  if (!parsed) return;
  const now = Date.now();
  if (parsed.exp < now) return;
  const stub = await getSessionStub();
  const currentGen = await stub.getAdminSessionGeneration();
  if (parsed.gen !== currentGen) return;
  const exp = Math.min(now + IDLE_TTL_MS, parsed.iat + ABSOLUTE_TTL_MS);
  setAdminCookie(parsed.iat, exp, parsed.gen, store);
}

/**
 * 「全端末ログアウト」。DO 側の世代番号を進めて、この端末を含む既発行の
 * Cookie を全部無効にしたうえで、この端末の Cookie も明示的に消す
 * （無効な Cookie を残しておく理由が無いため）。
 */
export async function revokeAllAdminSessions(): Promise<void> {
  const stub = await getSessionStub();
  await stub.revokeAdminSessions();
  await clearAdminSession();
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
 *
 * 通過したら（＝この操作は「アイドルではない」証拠なので）
 * refreshAdminSession() でアイドルタイムアウトを延長する。Server Action
 * からは Cookie を書き換えられるのでここで行える（Server Component 用の
 * requireAdmin() は書き換えられないため延長しない）。
 */
export async function assertAdmin(): Promise<void> {
  if (!(await isAdmin())) throw new Error("Unauthorized");
  await refreshAdminSession();
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
 * 登録済みTOTPシークレットに対する1回分のコード照合。ログイン（2回目以降）と
 * 破壊的操作前のステップアップ認証（assertAdminWithTotp）の両方から使う共通処理。
 * リプレイ防止・失敗カウンタ（DO の recordTotpAttempt）は用途を問わず同じ
 * ステップ・カウンタを共有する — 「ログインに使ったコードをそのまま
 * ステップアップにも使い回す」リプレイを構造的に防げるのはこの共有のおかげ。
 */
async function verifyRegisteredTotpCode(
  rawCode: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  let totpSecret: string;
  try {
    totpSecret = env.TOTP_SECRET;
  } catch (err) {
    console.error("[live-echo] TOTP_SECRET の読み込みに失敗しました", err);
    return { ok: false, message: "サーバ設定に問題があります。管理者に連絡してください。" };
  }
  const key = base32Decode(totpSecret);
  if (!key) {
    console.error("[live-echo] TOTP_SECRET が Base32 として不正です");
    return { ok: false, message: "サーバ設定に問題があります。管理者に連絡してください。" };
  }
  const fingerprint = totpSecretFingerprint(totpSecret);

  const stub = await getSessionStub();
  const gate = await stub.getTotpGate(fingerprint);
  if (gate.lockedOut) {
    return { ok: false, message: LOCKED_OUT_ERROR };
  }
  if (!gate.registered) {
    return { ok: false, message: "認証コードを入力してください。" };
  }

  const code = normalizeTotpCode(rawCode);
  if (code === null) {
    return { ok: false, message: "認証コードを入力してください。" };
  }
  const verified = verifyTotpCode(key, code, Date.now());
  if (!verified.ok) {
    await stub.recordTotpAttempt(fingerprint, { ok: false });
    return { ok: false, message: GENERIC_TOTP_ERROR };
  }
  const { accepted } = await stub.recordTotpAttempt(fingerprint, {
    ok: true,
    step: verified.step,
  });
  if (!accepted) {
    // 同じステップのコードが既に使用済み（リプレイ）。
    return { ok: false, message: GENERIC_TOTP_ERROR };
  }
  return { ok: true };
}

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
  const verified = await verifyRegisteredTotpCode(code ?? "");
  if (!verified.ok) {
    return { kind: "error", message: verified.message };
  }
  await issueAdminSession();
  return { kind: "ok" };
}

/**
 * 破壊的操作（全体リセット・設問の全置き換えインポート等）の直前に要求する
 * ステップアップ認証。すでにログイン済み（le_admin Cookie が有効）である
 * ことに加え、その場でもう一度TOTPコードの入力を求める — le_admin Cookie
 * だけが盗まれた場合でも、被害を「閲覧・小さな操作」程度に抑えるための
 * 多層防御（詳細は security-review-20260820.md の4番）。
 */
export async function assertAdminWithTotp(
  rawCode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertAdmin();
  const verified = await verifyRegisteredTotpCode(rawCode);
  if (!verified.ok) return { ok: false, error: verified.message };
  return { ok: true };
}
