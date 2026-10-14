import { cookies } from "next/headers";
import { createHmac, randomUUID } from "node:crypto";
import { clientIp } from "@/lib/auth/client-ip";
import { safeEqualStrings } from "@/lib/auth/constant-time";
import { normalizeIpKey } from "@/lib/auth/ip-key";
import { verifyTurnstileToken } from "@/lib/auth/turnstile";
import { env } from "@/lib/env";
import { admitParticipant } from "@/lib/session/service";
import type { VoteResult } from "@/lib/types";

const COOKIE_NAME = "le_pid";
const MAX_AGE_SECONDS = 12 * 60 * 60; // 12時間
const UUID_PATTERN = /^[0-9a-f-]{36}$/;

/**
 * le_admin の署名（lib/auth/admin.ts）と同じ SESSION_SECRET を使うので、
 * 用途の違う署名どうしが流用できないよう接頭辞で分離する。
 */
function sign(id: string, exp: number): string {
  return createHmac("sha256", env.SESSION_SECRET)
    .update(`le_pid.v1:${id}.${exp}`)
    .digest("base64url");
}

/**
 * 参加者を識別する匿名 Cookie を読む。値は `<uuid>.<exp>.<mac>` で、サーバが
 * 発行したもの以外（自分で作った ID、署名の無い旧形式）と期限切れは null になる。
 *
 * ★署名が無いと、Cookie を書き換えるだけで別人として何票でも投票できる。
 * 「1つの ID で1設問1票」の前提は、ID をサーバしか作れないことで成り立つ。
 *
 * ★期限（exp）は Cookie の maxAge ではなく署名の中身で判定する。maxAge は
 * ブラウザへの指示に過ぎず、値を控えておけばいつまでも送り直せる。期限が
 * 署名に入っていないと、発行枠の範囲で少しずつ ID を貯めておき、後日の
 * イベントでまとめて使うことができてしまう。
 *
 * Cookie の発行はここでは行わない（閲覧だけの接続には ID を配らない）。
 * 発行は最初の投票時に admitNewParticipant() が行う。
 */
export async function peekParticipantId(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const [id, expRaw, mac, ...rest] = raw.split(".");
  if (!id || !expRaw || !mac || rest.length > 0) return null;
  if (!UUID_PATTERN.test(id) || !/^\d{1,15}$/.test(expRaw)) return null;
  const exp = Number(expRaw);
  if (!safeEqualStrings(mac, sign(id, exp))) return null;
  return exp > Date.now() ? id : null;
}

type Admission =
  | { readonly ok: true; readonly participantId: string }
  | Exclude<VoteResult, { ok: true }>;

/**
 * まだ ID を持たない参加者に、最初の投票のタイミングで ID を発行する。
 * 発行の条件は次の2つ:
 *
 * 1. Turnstile のトークンが検証を通ること。スクリプトで ID を量産するには
 *    その都度ブラウザで Turnstile を通す必要が出る。
 * 2. IP 単位の発行枠に収まること（SessionDO.admitParticipant）。1 を抜ける
 *    手段を持つ相手に対する上限。
 *
 * 制限するのは「投票リクエスト」ではなく「ID の発行」なので、正規の参加者が
 * 消費するのは1人1回だけ。会場 Wi-Fi のように全員が同じ IP になる環境でも、
 * 枠を会場の人数より大きく取っておける。
 *
 * 枠は Turnstile を通った後に消費する —— トークン無しのリクエストで他人の
 * 枠を削れないようにするため。
 */
export async function admitNewParticipant(token: FormDataEntryValue | null): Promise<Admission> {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "verification-required", siteKey: env.TURNSTILE_SITE_KEY };
  }
  const ip = await clientIp();
  if (!(await verifyTurnstileToken(token, ip))) {
    return { ok: false, reason: "verification-failed" };
  }
  if (!(await admitParticipant(normalizeIpKey(ip ?? "unknown")))) {
    return { ok: false, reason: "busy" };
  }

  const id = randomUUID();
  const exp = Date.now() + MAX_AGE_SECONDS * 1000;
  const store = await cookies();
  store.set(COOKIE_NAME, `${id}.${exp}.${sign(id, exp)}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
    // Cloudflare は HTTPS のみなので true で問題ない
    // （会場 LAN の http:// 運用は廃止した）。
    secure: true,
  });
  return { ok: true, participantId: id };
}
