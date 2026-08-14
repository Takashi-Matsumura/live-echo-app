"use client";

import { useActionState, type ReactNode } from "react";
import { removeBrandLogo, uploadBrandLogo, type BrandLogoState } from "@/app/admin/actions";

const initialState: BrandLogoState = {};

/**
 * 管理画面の「ブランド設定」セクション。ロゴの登録・差し替え・削除。
 * ライブ状態（LiveStateProvider）とは無関係なので、その外側に置く運用
 * （PhonePreview と同じ判断。app/admin/page.tsx 参照）。
 *
 * `preview` は現在登録済みのロゴ（Server Component の <BrandMark />）を
 * 呼び出し元から渡してもらう。このコンポーネント自身は "use client" なので
 * サーバー側の状態を直接読めない — qr-panel.tsx を present-screen.tsx に
 * 渡すのと同じ server-in-client の受け渡しパターン。
 */
export function BrandSettings({
  hasLogo,
  preview,
}: {
  hasLogo: boolean;
  preview: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(uploadBrandLogo, initialState);

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-black/10 p-5 dark:border-white/15">
      <h2 className="text-sm font-medium text-black/50 dark:text-white/50">
        ブランド設定
      </h2>

      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-black/10 dark:border-white/15">
          {hasLogo ? preview : (
            <span className="text-xs text-black/40 dark:text-white/40">未登録</span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2">
          <form action={formAction} className="flex flex-col gap-2">
            <input
              type="file"
              name="logo"
              accept="image/png,image/jpeg,image/webp"
              required
              className="text-sm file:mr-3 file:rounded-full file:border file:border-black/10 file:bg-transparent file:px-4 file:py-1.5 file:text-sm dark:file:border-white/15"
            />
            <button
              type="submit"
              disabled={pending}
              className="self-start rounded-full border border-black/10 px-4 py-1.5 text-sm disabled:opacity-50 dark:border-white/15"
            >
              {pending ? "アップロード中…" : hasLogo ? "差し替え" : "アップロード"}
            </button>
          </form>

          {hasLogo && (
            <form action={removeBrandLogo}>
              <button
                type="submit"
                className="self-start text-sm text-black/50 underline dark:text-white/50"
              >
                削除
              </button>
            </form>
          )}
        </div>
      </div>

      <p className="text-xs text-black/40 dark:text-white/40">
        PNG / JPEG / WebP・最大96KB・正方形推奨。QRコード中央と各画面のヘッダーに表示されます。
      </p>

      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </section>
  );
}
