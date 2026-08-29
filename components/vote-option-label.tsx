/** 選択式（単一・複数）の1選択肢行。choice-vote-form.tsx / multi-vote-form.tsx
 *  から使う ── type="radio" か "checkbox" かと選択ハンドラだけが違い、
 *  見た目（枠線・チェックマーク）は完全に共通。 */
export function VoteOptionLabel({
  type,
  label,
  value,
  checked,
  onChange,
}: {
  type: "radio" | "checkbox";
  label: string;
  value: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      role="listitem"
      className={`flex w-full cursor-pointer items-center justify-between rounded-xl border px-5 py-4 text-left text-base font-medium transition-colors ${
        checked
          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
          : "border-black/10 bg-white hover:border-black/20 dark:border-white/15 dark:bg-white/5 dark:hover:border-white/25"
      }`}
    >
      <span>{label}</span>
      <input
        type={type}
        name="answer"
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      {checked && <span aria-hidden>✓</span>}
    </label>
  );
}
