import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { checkRateLimit, type RateLimitBuckets } from "@/lib/rate-limit";
import type { Role } from "@/lib/types";

const COOKIE_NAME = "le_admin";
const TTL_MS = 12 * 60 * 60 * 1000; // 12時間
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 60_000;

// Cloudflare 移行後は Durable Object のインスタンスフィールドに置き換わる
// 暫定実装（lib/rate-limit.ts の doc comment 参照）。
const loginBuckets: RateLimitBuckets = new Map();

function sign(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
}

/** 文字列長の違いで早期リターンしないよう、固定長ハッシュにしてから比較する */
function safeEqualStrings(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
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

export async function verifyPassword(candidate: string): Promise<boolean> {
  const key = await loginRateLimitKey();
  if (!checkRateLimit(loginBuckets, `login:${key}`, LOGIN_LIMIT, LOGIN_WINDOW_MS)) {
    return false;
  }
  return safeEqualStrings(candidate, env.ADMIN_PASSWORD);
}
