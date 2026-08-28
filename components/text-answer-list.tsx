const SCALE = {
  default: { empty: "text-sm", item: "text-sm px-4 py-3" },
  // /present（投影モード）用。result-bars.tsx の "large" と同じ理由で
  // 通常の文字サイズ指針より大きくする（視聴距離が長いプロジェクタ投影のため）。
  large: {
    empty: "text-[clamp(1.125rem,1.6vw,1.5rem)]",
    item: "text-[clamp(1.25rem,1.9vw,1.875rem)] px-6 py-5",
  },
} as const;

/** 自由記述の回答一覧。伏せられた回答は projection.ts の時点で既に除外済み */
export function TextAnswerList({
  answers,
  scale = "default",
}: {
  answers: readonly { readonly id: string; readonly text: string }[];
  /** "large" は /present（投影モード）用。文字を大きくする */
  scale?: "default" | "large";
}) {
  const sizes = SCALE[scale];

  if (answers.length === 0) {
    return (
      <p className={`text-[var(--chart-text-muted)] ${sizes.empty}`}>まだ回答がありません</p>
    );
  }

  return (
    <ul className="flex flex-col gap-2" role="list">
      {answers.map((answer) => (
        <li
          key={answer.id}
          role="listitem"
          // 背景は固定の bg-white / dark: ではなく CSS 変数で持つ。
          // /present はシステムのカラースキームに関わらず常にダーク固定で
          // --chart-* を上書きするため、Tailwind の dark: バリアントだと
          // 追従できず「白背景に白文字」になってしまう。
          className={`line-clamp-3 rounded-lg bg-[var(--chart-track)] leading-relaxed text-[var(--chart-text)] ${sizes.item}`}
        >
          {answer.text}
        </li>
      ))}
    </ul>
  );
}
