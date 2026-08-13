"use client";

import Link from "next/link";
import { useTransition, type ReactNode } from "react";
import {
  goToAdjacentQuestion,
  hideAnswer,
  logout,
  resetAll,
  resetQuestion,
  selectQuestion,
  setPhase,
  setRevealed,
  unhideAnswer,
} from "@/app/admin/actions";
import { ResultBars } from "@/components/result-bars";
import { useLiveState } from "@/components/live-state-provider";
import type { Deck, PublicResults, Question } from "@/lib/types";

export function AdminConsole({ questions }: { questions: Deck["questions"] }) {
  const { state } = useLiveState();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<void>) {
    startTransition(async () => {
      await fn();
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">管理画面</h1>
        <div className="flex items-center gap-4">
          <Link
            href="/present"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-black/10 px-4 py-1.5 text-sm dark:border-white/15"
          >
            QRコードを表示 ↗
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="text-sm text-black/50 underline dark:text-white/50"
            >
              ログアウト
            </button>
          </form>
        </div>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-black/50 dark:text-white/50">
          設問一覧
        </h2>
        <ul className="flex flex-col gap-2">
          {questions.map((q, i) => {
            const isActive = state.question?.id === q.id;
            return (
              <li
                key={q.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-black/10 px-4 py-3 dark:border-white/15"
              >
                <div>
                  <p className="text-xs text-black/40 dark:text-white/40">
                    設問 {i + 1}（{q.kind === "choice" ? "選択式" : "自由記述"}）
                  </p>
                  <p className="font-medium">{q.prompt}</p>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => selectQuestion(q.id))}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                    isActive
                      ? "bg-[var(--accent)] text-white"
                      : "border border-black/10 dark:border-white/15"
                  }`}
                >
                  {isActive ? "出題中" : "この設問を出す"}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {state.question && (
        <section className="flex flex-col gap-4 rounded-xl border border-black/10 p-5 dark:border-white/15">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium">{state.question.prompt}</h2>
            <span className="shrink-0 text-sm text-black/50 dark:text-white/50">
              回答済み: {state.answeredCount}人
            </span>
          </div>

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
              onClick={() =>
                run(() => setPhase(state.phase === "open" ? "closed" : "open"))
              }
            >
              {state.phase === "open" ? "受付を締め切る" : "受付を再開する"}
            </ControlButton>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setRevealed(!state.revealed))}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {state.revealed ? "結果を非公開に戻す" : "結果を公開する"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const questionId = state.question?.id;
                if (!questionId) return;
                run(() => resetQuestion(questionId));
              }}
              className="rounded-full border border-red-300 px-4 py-2 text-sm text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-400"
            >
              この設問をリセット
            </button>
          </div>

          {state.results && (
            <AdminResults
              question={state.question}
              results={state.results}
              closed={state.phase === "closed"}
              pending={pending}
              run={run}
            />
          )}
        </section>
      )}

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
      <ul className="flex flex-col gap-2">
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
