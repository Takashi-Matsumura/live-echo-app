import { TURNSTILE_FIELD } from "@/lib/turnstile";
import type { VoteResult } from "@/lib/types";

/**
 * 投票フォーム（choice/multi/text-vote-form.tsx）から使う、Turnstile の
 * ブラウザ側。スクリプトは最初に必要になった時点で読み込む —— トークンが
 * 要るのは参加者 ID がまだ無い最初の1票だけで、2回目以降の投票や投影画面・
 * 管理画面では読み込まれない。
 */

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// 対話型のチャレンジ（チェックボックス）が出た場合に人が操作する時間を含む。
const TOKEN_TIMEOUT_MS = 120_000;

type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: "interaction-only";
      callback: (token: string) => void;
      "error-callback": () => void;
    },
  ): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstilePromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  turnstilePromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    const fail = () => {
      // 次の投票でもう一度読み込みを試せるようにする（会場の回線が
      // 一時的に不安定だった場合など）。
      turnstilePromise = null;
      script.remove();
      reject(new Error("Turnstile を読み込めませんでした"));
    };
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : fail());
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return turnstilePromise;
}

/**
 * Turnstile を1回実行してトークンを得る。通常は何も表示されずに終わり、
 * 対話が必要と判定されたときだけ画面下部にチェックボックスが出る
 * （appearance: "interaction-only"）。
 */
async function requestTurnstileToken(siteKey: string): Promise<string> {
  const turnstile = await loadTurnstile();
  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;left:0;right:0;bottom:24px;z-index:50;display:flex;justify-content:center";
  document.body.appendChild(container);

  let widgetId: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Turnstile がタイムアウトしました")), TOKEN_TIMEOUT_MS);
      widgetId = turnstile.render(container, {
        sitekey: siteKey,
        appearance: "interaction-only",
        callback: resolve,
        "error-callback": () => reject(new Error("Turnstile の検証に失敗しました")),
      });
    });
  } finally {
    clearTimeout(timer);
    if (widgetId !== null) turnstile.remove(widgetId);
    container.remove();
  }
}

/**
 * 投票を送る。サーバが "verification-required" を返したとき（参加者 ID が
 * まだ無い最初の1票）だけ Turnstile のトークンを取り、付けて送り直す。
 */
export async function submitVoteVerified(
  action: (formData: FormData) => Promise<VoteResult>,
  formData: FormData,
): Promise<VoteResult> {
  const result = await action(formData);
  if (result.ok || result.reason !== "verification-required") return result;

  let token: string;
  try {
    token = await requestTurnstileToken(result.siteKey);
  } catch {
    return { ok: false, reason: "verification-failed" };
  }
  formData.set(TURNSTILE_FIELD, token);
  return await action(formData);
}
