"use client";

import { useEffect, useRef, useTransition, type ReactNode, type Ref } from "react";
import {
  goToAdjacentQuestion,
  hideAnswer,
  resetAll,
  resetQuestion,
  selectQuestion,
  setPhase,
  setRevealed,
  unhideAnswer,
} from "@/app/admin/actions";
import { ResultBars } from "@/components/result-bars";
import { useLiveState } from "@/components/live-state-provider";
import type { Deck, Phase, PublicResults, Question } from "@/lib/types";

export function AdminConsole({ questions }: { questions: Deck["questions"] }) {
  const { state } = useLiveState();
  const [pending, startTransition] = useTransition();
  const activeItemRef = useRef<HTMLLIElement>(null);

  function run(fn: () => Promise<void>) {
    startTransition(async () => {
      await fn();
    });
  }

  // 出題中の設問が切り替わったら、リストがスクロールしていても見える位置まで
  // 自動でスクロールする（下の <ul> に max-h + overflow-y-auto を付けたため、
  // 設問数が増えるとリストの途中に隠れうる）。
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [state.question?.id]);

  return (
    <div className="flex w-full min-w-0 flex-col gap-8">
      <section className="flex flex-col gap-2">
        {/* 見出しはタブボタン（「設問一覧」）自体が兼ねるため、ここでは重複させない
            （components/brand-settings.tsx と同じ判断）。
            設問一覧と「出題中の設問の詳細」はかつて別セクションだったが、
            1つのアコーディオンに統合した: 出題中の行だけが自動的に展開して
            操作ボタン・結果を表示し、他の行は要約のみの最小高さで並ぶ。
            出題中の1行ぶんしか大きくならないので、設問数が増えても
            「一覧の行＋別セクションの詳細」という二重の高さを持たない。
            それでも十分な設問数・回答数になった場合の保険として、リスト
            自体にも高さ上限つきスクロールを残す（ビューポート相対）。 */}
        <ul className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto pr-1">
          {questions.map((q, i) => {
            const isActive = state.question?.id === q.id;
            return (
              <QuestionRow
                key={q.id}
                itemRef={isActive ? activeItemRef : undefined}
                index={i}
                question={q}
                isActive={isActive}
                pending={pending}
                answeredCount={state.answeredCount}
                phase={state.phase}
                revealed={state.revealed}
                results={state.results}
                run={run}
              />
            );
          })}
        </ul>
      </section>

      <button
        type="button"
        disabled={pending}
        onClick={() => run(resetAll)}
        className="self-start text-sm text-red-600 underline disabled:opacity-50 dark:text-red-400"
      >
        全体をリセット
      </button>
    </div>
  );
}

function QuestionRow({
  itemRef,
  index,
  question,
  isActive,
  pending,
  answeredCount,
  phase,
  revealed,
  results,
  run,
}: {
  itemRef?: Ref<HTMLLIElement>;
  index: number;
  question: Question;
  isActive: boolean;
  pending: boolean;
  answeredCount: number;
  phase: Phase;
  revealed: boolean;
  results: PublicResults | null;
  run: (fn: () => Promise<void>) => void;
}) {
  return (
    <li
      ref={itemRef}
      className={`rounded-lg border ${
        isActive ? "border-[var(--accent)]" : "border-black/10 dark:border-white/15"
      }`}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-xs text-black/40 dark:text-white/40">
            設問 {index + 1}（{question.kind === "choice" ? "選択式" : "自由記述"}）
          </p>
          <p className="font-medium">{question.prompt}</p>
        </div>
        {isActive ? (
          // ★出題中の行はボタンではなく非活性の pill にする。以前は出題中でも
          // 同じ selectQuestion 呼び出しが残っていて、押すと
          // applySelectQuestion（lib/session/mutations.ts）が phase/revealed
          // を無条件でリセットしてしまっていた（受付締切後や結果公開後に
          // 誤って押すと状態が巻き戻る実害のあるバグ）。ここで併せて直す。
          <span className="shrink-0 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">
            出題中
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => selectQuestion(question.id))}
            className="shrink-0 rounded-full border border-black/10 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-white/15"
          >
            この設問を出す
          </button>
        )}
      </div>

      {/* 展開部分。出題中の行だけ描画される＝アコーディオンの「開」状態。
          非出題中の設問には安全なプレビューが無い（selectQuestion は必ず
          phase/revealed をリセットする本番の状態変更で、結果も
          projection.ts が出題中の設問ぶんしかクライアントに配らない）ため、
          他の行は要約のままにしてある。 */}
      {isActive && (
        <div className="flex flex-col gap-4 border-t border-black/10 px-4 py-4 dark:border-white/15">
          <span className="text-sm text-black/50 dark:text-white/50">
            回答済み: {answeredCount}人
          </span>

          <div className="flex flex-wrap gap-2">
            <ControlButton
              disabled={pending}
              onClick={() => run(() => goToAdjacentQuestion(-1))}
            >
              ← 前の設問
            </ControlButton>
            <ControlButton
              disabled={pending}
              onClick={() => run(() => goToAdjacentQuestion(1))}
            >
              次の設問 →
            </ControlButton>
            <ControlButton
              disabled={pending}
              onClick={() => run(() => setPhase(phase === "open" ? "closed" : "open"))}
            >
              {phase === "open" ? "受付を締め切る" : "受付を再開する"}
            </ControlButton>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setRevealed(!revealed))}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {revealed ? "結果を非公開に戻す" : "結果を公開する"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => resetQuestion(question.id))}
              className="rounded-full border border-red-300 px-4 py-2 text-sm text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-400"
            >
              この設問をリセット
            </button>
          </div>

          {results && (
            <AdminResults
              question={question}
              results={results}
              closed={phase === "closed"}
              pending={pending}
              run={run}
            />
          )}
        </div>
      )}
    </li>
  );
}

function ControlButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-full border border-black/10 px-4 py-2 text-sm disabled:opacity-50 dark:border-white/15"
    >
      {children}
    </button>
  );
}

function AdminResults({
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
  if (results.kind === "choice" && question.kind === "choice") {
    return <ResultBars question={question} counts={results.counts} closed={closed} />;
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
