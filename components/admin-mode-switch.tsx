"use client";

import { useAdminMode, type AdminMode } from "@/components/admin-mode";

const OPTIONS: { readonly id: AdminMode; readonly label: string }[] = [
  { id: "setup", label: "準備中" },
  { id: "live", label: "進行中" },
];

/**
 * ヘッダに常設するモード切替。準備中／進行中の2択で、進行中を選ぶと
 * 設問の編集・削除・データ入出力・全体リセット・全端末ログアウト・
 * ブランド設定が画面から消える（components/admin-console.tsx,
 * components/admin-tabs.tsx 側で useAdminMode() を見て出し分ける）。
 *
 * role="radiogroup" の自作セグメンテッドコントロール。
 * components/admin-console.tsx の ToggleButton は on/off の2状態切替用
 * なのでここでは流用しない（意味が違う）が、配色語彙は合わせてある。
 */
export function AdminModeSwitch() {
  const { mode, setMode } = useAdminMode();

  return (
    <div
      role="radiogroup"
      aria-label="管理画面のモード"
      className="flex shrink-0 rounded-full border border-black/10 p-0.5 text-sm dark:border-white/15"
    >
      {OPTIONS.map((option) => {
        const checked = mode === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => setMode(option.id)}
            className={`rounded-full px-3 py-1 font-medium ${
              checked
                ? "bg-[var(--accent)] text-white"
                : "text-black/60 dark:text-white/60"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
