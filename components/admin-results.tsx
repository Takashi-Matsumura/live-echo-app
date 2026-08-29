"use client";

import { hideAnswer, unhideAnswer } from "@/app/admin/actions";
import { ResultBars } from "@/components/result-bars";
import { isChoiceLike } from "@/lib/questions";
import type { PublicResults, Question } from "@/lib/types";

/** 出題中の設問の展開部分に出す結果表示。選択式はグラフ、自由記述は
 *  一覧＋伏せる/表示するボタン（components/question-row.tsx から使う）。 */
export function AdminResults({
  question,
  results,
  closed,
  pending,
  run,
}: {
  question: Question;
  results: PublicResults;
  closed: boolean;
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
}) {
  if (results.kind === "choice" && isChoiceLike(question)) {
    return (
      <ResultBars
        question={question}
        counts={results.counts}
        closed={closed}
        respondents={results.respondents}
      />
    );
  }

  if (results.kind === "text") {
    if (results.answers.length === 0) {
      return (
        <p className="text-sm text-black/50 dark:text-white/50">
          まだ回答がありません
        </p>
      );
    }
    return (
      // 回答は参加者数ぶん増えうる。上の進行ボタン群が常に画面内に留まるよう
      // ここだけ高さ上限つきでスクロールさせる（外側の <ul> とは独立した領域）。
      <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
        {results.answers.map((answer) => (
          <li
            key={answer.id}
            className={`flex items-start justify-between gap-3 rounded-lg px-4 py-3 text-sm ${
              answer.hidden
                ? "bg-black/5 text-black/40 dark:bg-white/5 dark:text-white/40"
                : "bg-black/5 dark:bg-white/10"
            }`}
          >
            <span className="flex-1">
              {answer.hidden && <span className="mr-1">（伏せ中）</span>}
              {answer.text}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() =>
                  answer.hidden
                    ? unhideAnswer(question.id, answer.id)
                    : hideAnswer(question.id, answer.id),
                )
              }
              className="shrink-0 text-xs text-black/40 underline disabled:opacity-50 dark:text-white/40"
            >
              {answer.hidden ? "表示する" : "伏せる"}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return null;
}
