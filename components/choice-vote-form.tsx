"use client";

import { useState, useTransition } from "react";
import { submitVote } from "@/app/actions";
import { useLiveState } from "@/components/live-state-provider";
import { asFormAction } from "@/lib/form-action";
import { voteErrorMessage } from "@/lib/vote-messages";
import type { ChoiceQuestion, VoteResult } from "@/lib/types";

export function ChoiceVoteForm({ question }: { question: ChoiceQuestion }) {
  const { you, markAnswered } = useLiveState();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // question.id を固定した Server Action。<form action> のネイティブ送信
  // （JS 無効時のフォールバック）と、直接 await する JS 有効時の両方で使う。
  const boundAction = submitVote.bind(null, question.id);
  const formAction = asFormAction(boundAction);

  function vote(choiceId: string, formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result: VoteResult = await boundAction(formData);
      if (result.ok) {
        markAnswered(question.id, choiceId);
      } else {
        setError(voteErrorMessage(result.reason));
      }
    });
  }

  return (
    <div className="flex flex-col gap-3" role="list">
      {question.choices.map((choice) => {
        const isMine = you.myAnswer === choice.id;
        return (
          <form
            key={choice.id}
            action={formAction}
            role="listitem"
            onSubmit={(event) => {
              event.preventDefault();
              vote(choice.id, new FormData(event.currentTarget));
            }}
          >
            <input type="hidden" name="answer" value={choice.id} />
            <button
              type="submit"
              disabled={pending}
              aria-pressed={isMine}
              className={`flex w-full items-center justify-between rounded-xl border px-5 py-4 text-left text-base font-medium transition-colors disabled:opacity-60 ${
                isMine
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-black/10 bg-white hover:border-black/20 dark:border-white/15 dark:bg-white/5 dark:hover:border-white/25"
              }`}
            >
              <span>{choice.label}</span>
              {isMine && <span aria-hidden>✓</span>}
            </button>
          </form>
        );
      })}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
