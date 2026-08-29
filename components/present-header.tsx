"use client";

import { PresentNavButton } from "@/components/present-nav-button";
import type { PresentNav } from "@/components/use-present-nav";

/**
 * /present の見出し行。ラベル（「設問 X / Y」または「振り返り表示」）の
 * 左右に切り替え矢印を置き、その下に設問文を出す。presentOverride の
 * 「振り返り表示」分岐と、出題中設問のライブ結果分岐の両方から使う
 * （present-screen.tsx）。「回答済み」待ち分岐（FitToViewport 側）は
 * 矢印を出さない別レイアウトのままなのでここでは共有しない。
 *
 * label が null なら見出し行そのものを出さない（元の
 * `{position && (...)}` 条件をそのまま踏襲 ── 実際には question が
 * 存在する限り position も必ず存在するが、型上 null になり得るため
 * 呼び出し側の分岐に合わせてここでも null を許容する）。
 */
export function PresentHeader({
  label,
  prompt,
  nav,
}: {
  label: string | null;
  prompt: string;
  nav: PresentNav;
}) {
  return (
    <header className="flex shrink-0 flex-col gap-3">
      {label !== null && (
        <div className="flex items-center gap-3">
          {nav.showNav && (
            <PresentNavButton
              direction="prev"
              disabled={!nav.canGoPrev || nav.pending}
              onClick={nav.goToPrevious}
            />
          )}
          <p className="text-[clamp(1rem,1.8dvh,1.5rem)] font-medium tracking-wide text-white/50">
            {label}
          </p>
          {nav.showNav && (
            <PresentNavButton
              direction="next"
              disabled={!nav.canGoNext || nav.pending}
              onClick={nav.goToNext}
            />
          )}
        </div>
      )}
      <h1 className="line-clamp-2 text-[clamp(1.75rem,3.8dvh,3.5rem)] font-semibold leading-tight">
        {prompt}
      </h1>
    </header>
  );
}
