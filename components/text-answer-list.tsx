/** 自由記述の回答一覧。伏せられた回答は projection.ts の時点で既に除外済み */
export function TextAnswerList({
  answers,
}: {
  answers: readonly { readonly id: string; readonly text: string }[];
}) {
  if (answers.length === 0) {
    return (
      <p className="text-sm text-[var(--chart-text-muted)]">まだ回答がありません</p>
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
          className="line-clamp-3 rounded-lg bg-[var(--chart-track)] px-4 py-3 text-sm leading-relaxed text-[var(--chart-text)]"
        >
          {answer.text}
        </li>
      ))}
    </ul>
  );
}
