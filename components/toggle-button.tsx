"use client";

/**
 * on/off の2状態切替用ピル型トグル。components/question-row.tsx から
 * 「受付中/受付停止」「結果公開中/結果非公開」に使う。
 *
 * components/admin-mode-switch.tsx の準備中／進行中セグメンテッドコントロール
 * とは意味が違う（あちらは3択以上にも開かれた排他選択 = role="radiogroup"）
 * ため流用しないが、配色語彙は合わせてある。
 */
export function ToggleButton({
  checked,
  disabled,
  onClick,
  onLabel,
  offLabel,
}: {
  checked: boolean;
  disabled: boolean;
  onClick: () => void;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
        checked
          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
          : "border-black/10 text-black/60 dark:border-white/15 dark:text-white/60"
      }`}
    >
      <span
        aria-hidden
        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full ${
          checked ? "bg-[var(--accent)]" : "bg-black/20 dark:bg-white/20"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </span>
      {checked ? onLabel : offLabel}
    </button>
  );
}
