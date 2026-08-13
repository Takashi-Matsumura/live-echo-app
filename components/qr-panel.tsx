import { headers } from "next/headers";
import { renderSVG } from "uqr";
import { env } from "@/lib/env";

/**
 * リクエストの Host ヘッダーから QR の URL を組み立てる。
 * PUBLIC_BASE_URL が設定されていればそれを最優先する（独自ドメイン等）。
 */
async function resolveBaseUrl(): Promise<string> {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL;
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

/**
 * QR コードを生成する（Server Component）。
 * QR は常に「白背景・黒モジュール」の標準配色にする — スキャナの読み取り
 * 互換性を優先し、/present の暗い背景の上には白いカードとして浮かせる。
 * ダーク背景に明るいモジュールの反転 QR は、機種によっては読み取れない
 * ことがあるため意図的に避けている。
 */
export async function QrPanel() {
  const url = await resolveBaseUrl();
  const svg = renderSVG(url, {
    ecc: "M",
    border: 2,
    pixelSize: 8,
    whiteColor: "#ffffff",
    blackColor: "#0b0b0b",
  });

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        // uqr の renderSVG は width/height 属性を付けない（viewBox のみ）ため、
        // 何も指定しないとブラウザ既定の小さいサイズで描画される。直接の子の
        // svg 要素にサイズを明示する。
        className="rounded-2xl bg-white p-4 shadow-[0_8px_32px_rgba(0,0,0,0.35)] [&>svg]:h-64 [&>svg]:w-64"
        // svg はサーバー側で自前生成した信頼済み文字列（外部入力を含まない）
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="break-all text-center text-xl font-medium tracking-wide text-white">
        {url}
      </p>
    </div>
  );
}
