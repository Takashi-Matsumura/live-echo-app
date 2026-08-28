const SCALE = {
  default: { empty: "text-sm", item: "text-sm px-4 py-3", gap: "gap-2" },
  // /present（投影モード）用。result-bars.tsx の "large" と同じ理由で
  // 通常の文字サイズ指針より大きくする（視聴距離が長いプロジェクタ投影のため）。
  // ★選択肢と違い自由記述の件数には上限が無いため、result-bars.tsx の
  // ように「最大8件」を前提にした固定サイズには収まらない。文字サイズ・
  // 項目の高さは選択肢と同じ考え方で dvh 基準の固定値にしたうえで、
  // はみ出す分は（以前のように画面全体を縮小するのではなく）このリスト
  // 内だけをスクロールさせて全件見られるようにする（present-screen.tsx
  // 側で高さを固定した親要素に overflow-y-auto の本要素を収める構成）。
  large: {
    empty: "text-[clamp(1.125rem,2dvh,1.5rem)]",
    item: "text-[clamp(1.1rem,2dvh,1.75rem)] px-6 py-4",
    gap: "gap-[1.4dvh]",
  },
} as const;

/** 自由記述の回答一覧。伏せられた回答は projection.ts の時点で既に除外済み */
export function TextAnswerList({
  answers,
  scale = "default",
}: {
  answers: readonly { readonly id: string; readonly text: string }[];
  /** "large" は /present（投影モード）用。文字を大きくし、親の固定高さの中でスクロールする */
  scale?: "default" | "large";
}) {
  const sizes = SCALE[scale];

  if (answers.length === 0) {
    return (
      <p className={`text-[var(--chart-text-muted)] ${sizes.empty}`}>まだ回答がありません</p>
    );
  }

  return (
    <ul
      className={`flex h-full min-h-0 flex-col overflow-y-auto ${sizes.gap}`}
      role="list"
    >
      {answers.map((answer) => (
        <li
          key={answer.id}
          role="listitem"
          // 背景は固定の bg-white / dark: ではなく CSS 変数で持つ。
          // /present はシステムのカラースキームに関わらず常にダーク固定で
          // --chart-* を上書きするため、Tailwind の dark: バリアントだと
          // 追従できず「白背景に白文字」になってしまう。
          className={`line-clamp-3 shrink-0 rounded-lg bg-[var(--chart-track)] leading-relaxed text-[var(--chart-text)] ${sizes.item}`}
        >
          {answer.text}
        </li>
      ))}
    </ul>
  );
}
