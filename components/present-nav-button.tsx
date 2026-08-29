"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";

/**
 * 「設問 X / Y」「振り返り表示」の左右に置く切り替えアイコン
 * （components/present-header.tsx から使う）。投影画面はカーソルを
 * 消している（present-screen.tsx の rootClassName の [cursor:none]）が、
 * この操作はマウスで行う前提（ユーザー指示）なので、ボタン上だけ
 * cursor-pointer で明示的にカーソルを復活させる。
 */
export function PresentNavButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={direction === "prev" ? "前の設問の結果に切り替え" : "次の設問の結果に切り替え"}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/25 text-white/70 transition hover:border-white/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/25 disabled:hover:text-white/70"
    >
      {direction === "prev" ? <ChevronLeftIcon /> : <ChevronRightIcon />}
    </button>
  );
}
