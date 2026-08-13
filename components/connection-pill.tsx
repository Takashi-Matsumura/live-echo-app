"use client";

import { useLiveState } from "@/components/live-state-provider";

/** 切断中は前回の描画を保持しつつ、小さなピルだけで再接続中を知らせる */
export function ConnectionPill() {
  const { live } = useLiveState();
  if (live) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-sm text-white shadow-lg dark:bg-white/90 dark:text-black">
      再接続中…
    </div>
  );
}
