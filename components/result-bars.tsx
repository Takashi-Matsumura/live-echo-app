import type { ChoiceQuestion } from "@/lib/types";

const SCALE = {
  default: { track: "h-3.5", label: "text-sm", count: "text-sm", badge: "h-4 w-4 text-[10px]" },
  large: { track: "h-6", label: "text-lg", count: "text-base", badge: "h-6 w-6 text-sm" },
} as const;

/**
 * 選択式の結果を横棒グラフで表示する。dataviz スキルの原則:
 * - 1系列=1色。選択肢ごとに色を変えない（読者のタスクは大小比較であって識別ではない）
 * - 勝者の強調は closed（締切後）のときだけ。受付中に色分けすると票が入るたびに
 *   ちらつくため、受付中は全バー同色
 * - 自分の回答は色ではなくチェックマークで示す（色だけに意味を持たせない）
 * - 凡例・軸・グリッド・ツールチップは無し（1系列・6本以下で全値に直接ラベル）
 */
export function ResultBars({
  question,
  counts,
  closed,
  yourAnswerId,
  scale = "default",
}: {
  question: ChoiceQuestion;
  counts: Readonly<Record<string, number>>;
  closed: boolean;
  yourAnswerId?: string | null;
  /** "large" は /present（投影モード）用。バー・文字を大きくする */
  scale?: "default" | "large";
}) {
  const values = question.choices.map((choice) => counts[choice.id] ?? 0);
  const total = values.reduce((sum, v) => sum + v, 0);
  const max = Math.max(1, ...values);
  const topCount = Math.max(0, ...values);
  const sizes = SCALE[scale];

  return (
    <ul className="flex flex-col gap-3" role="list">
      {question.choices.map((choice) => {
        const count = counts[choice.id] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const widthPct = total > 0 ? (count / max) * 100 : 0;
        const isTop = closed && total > 0 && count === topCount && count > 0;
        const isYours = choice.id === yourAnswerId;

        return (
          <li
            key={choice.id}
            role="listitem"
            aria-label={`${choice.label}: ${count}票（${pct}%）${isYours ? "・あなたの回答" : ""}`}
            className="grid grid-cols-[1fr_auto] items-center gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <span
                className={`flex items-center gap-1.5 text-[var(--chart-text)] ${sizes.label}`}
              >
                {choice.label}
                {isYours && (
                  <span
                    aria-hidden
                    className={`inline-flex items-center justify-center rounded-full bg-[var(--accent)] text-white ${sizes.badge}`}
                  >
                    ✓
                  </span>
                )}
              </span>
              <div className={`rounded-r bg-[var(--chart-track)] ${sizes.track}`}>
                <div
                  className="h-full rounded-r motion-safe:transition-[width] motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor:
                      !closed || isTop ? "var(--chart-bar)" : "var(--chart-bar-muted)",
                  }}
                />
              </div>
            </div>
            <span
              aria-hidden
              className={`shrink-0 text-right tabular-nums text-[var(--chart-text-muted)] ${sizes.count}`}
            >
              {count}票（{pct}%）
            </span>
          </li>
        );
      })}
    </ul>
  );
}
