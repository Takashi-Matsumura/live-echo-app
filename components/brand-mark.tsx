import { getBrandLogoMeta } from "@/lib/session/service";

const SIZE_CLASSES = {
  sm: "h-6 w-6",
  md: "h-9 w-9",
} as const;

/**
 * 登録済みの会社ロゴをヘッダーに表示する（Server Component）。
 * 未登録なら null を返す — 呼び出し側は常に配置してよく、ロゴの有無で
 * 条件分岐を書く必要がない（app/page.tsx, app/admin/page.tsx,
 * components/present-screen.tsx 参照）。
 *
 * 画像本体は app/api/brand/logo/route.ts から配信する。QR コード中央への
 * 埋め込みはこれとは別経路（components/qr-panel.tsx がバイト列を data URI
 * 化して SVG に直接焼き込む）なので、ここでは軽量な getBrandLogoMeta（バイト
 * 列を含まない）だけで済む。
 *
 * Cloudflare Workers 上の運用で next/image の最適化ローダーを別途組む
 * ほどの画像量ではないため、他の箇所と同様プレーンな <img> にしている。
 */
export async function BrandMark({
  size = "md",
  className = "",
}: {
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}) {
  const meta = await getBrandLogoMeta();
  if (!meta) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- 自前配信の小さなロゴ画像。next/image の最適化ローダーは Cloudflare Workers 構成では未設定
    <img
      src={`/api/brand/logo?v=${meta.updatedAt}`}
      alt="ロゴ"
      className={`${SIZE_CLASSES[size]} rounded-lg object-contain ${className}`}
    />
  );
}
