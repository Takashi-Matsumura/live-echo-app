import type { Materials } from "@/components/use-materials";

/**
 * 研修資料の表示（参加者向け）。リンクを主役に、QR は補助として畳んでおく
 * ── 自分のスマホ画面に出た QR はその本人にはスキャンできないため
 * （投影画面向けの大きな QR は components/present-screen.tsx 側で別途出す）。
 */
export function MaterialsPanel({ materials }: { materials: Materials }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-black/10 p-5 dark:border-white/15">
      <p className="text-sm font-medium">{materials.label ?? "研修資料"}</p>
      <a
        href={materials.url}
        target="_blank"
        rel="noopener noreferrer"
        className="self-start rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white"
      >
        資料を開く
      </a>

      <details className="text-sm">
        <summary className="cursor-pointer text-black/50 dark:text-white/50">
          QRコードを表示
        </summary>
        <div className="mt-3 flex flex-col items-center gap-2">
          <div
            className="rounded-xl bg-white p-3 shadow-sm [&>svg]:h-48 [&>svg]:w-48"
            // svg はサーバー側（app/api/materials/route.ts）で renderQrSvg
            // により自前生成した文字列（lib/qr.ts 参照。ロゴの data URI 部分も
            // 含め escapeAttr 済み）。
            dangerouslySetInnerHTML={{ __html: materials.qrSvg }}
          />
          <p className="break-all text-center text-xs text-black/50 dark:text-white/50">
            {materials.url}
          </p>
        </div>
      </details>
    </section>
  );
}
