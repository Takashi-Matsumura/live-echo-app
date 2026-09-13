import { headers } from "next/headers";
import { env } from "@/lib/env";
import { renderQrSvg } from "@/lib/qr";
import { resolveQrLogo } from "@/lib/qr-logo";

/**
 * リクエストの Host ヘッダーから QR の URL を組み立てる。
 * PUBLIC_BASE_URL が設定されていればそれを最優先する（将来のカスタムドメイン用）。
 * 通常の Cloudflare 運用では Host ヘッダーは常に正しいので、この上書きは
 * 未設定のままである想定。ローカルネットワーク検証のために .env.local で
 * 上書きする用途ではない（それがビルドに焼き込まれて本番 URL を壊した実バグの
 * 原因だった。lib/env.ts 参照）。
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
 * 互換性を優先し、/presenter の暗い背景の上には白いカードとして浮かせる。
 * ダーク背景に明るいモジュールの反転 QR は、機種によっては読み取れない
 * ことがあるため意図的に避けている。
 * 会社ロゴが登録されていれば中央に合成する（lib/qr.ts 参照。誤り訂正を
 * H に引き上げて、ロゴで覆った分を吸収する）。
 */
export async function QrPanel() {
  const [url, logo] = await Promise.all([resolveBaseUrl(), resolveQrLogo()]);
  const svg = renderQrSvg(url, logo);

  return (
    <div className="flex flex-col items-center gap-6">
      <div
        // lib/qr.ts の renderQrSvg は（元ネタの uqr/renderSVG 同様）width/height
        // 属性を付けない（viewBox のみ）ため、何も指定しないとブラウザ既定の
        // 小さいサイズで描画される。直接の子の svg 要素にサイズを明示する。
        // サイズは clamp() でビューポート幅に応じてスケールする
        // （投影機の解像度によらず大きく表示するため。result-bars.tsx の
        // "large" scale と同じ理由）。
        className="rounded-2xl bg-white p-6 shadow-[0_8px_32px_rgba(0,0,0,0.35)] [&>svg]:h-[clamp(16rem,30vw,26rem)] [&>svg]:w-[clamp(16rem,30vw,26rem)]"
        // svg はサーバー側で自前生成した文字列。ロゴの data URI 部分も含め
        // renderQrSvg 内で escapeAttr 済み（lib/qr.ts 参照）
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="break-all text-center text-[clamp(1.25rem,2vw,1.75rem)] font-medium tracking-wide text-white">
        {url}
      </p>
    </div>
  );
}
