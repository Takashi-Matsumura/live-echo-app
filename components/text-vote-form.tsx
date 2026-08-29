"use client";

import { useState, useTransition } from "react";
import { submitVote } from "@/app/actions";
import { useLiveState } from "@/components/live-state-provider";
import { VoteError } from "@/components/vote-error";
import { VoteSubmitButton } from "@/components/vote-submit-button";
import { asFormAction } from "@/lib/form-action";
import { voteErrorMessage } from "@/lib/vote-messages";
import type { TextQuestion, VoteResult } from "@/lib/types";
import { answerText, DEFAULT_TEXT_MAX_LENGTH } from "@/lib/questions";

/**
 * 設問が切り替わったときに入力欄の state をリセットするため、呼び出し側
 * （participant-screen.tsx）で `key={question.id}` を付けてマウントし直す
 * 前提。useEffect で state を同期させるより単純で、React 19 の推奨パターン。
 */
export function TextVoteForm({ question }: { question: TextQuestion }) {
  const { you, markAnswered } = useLiveState();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(answerText(you.myAnswer) ?? "");
  const [error, setError] = useState<string | null>(null);
  const maxLength = question.maxLength ?? DEFAULT_TEXT_MAX_LENGTH;

  const boundAction = submitVote.bind(null, question.id);
  const formAction = asFormAction(boundAction);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const trimmed = value.trim();
        if (trimmed.length === 0) return;
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result: VoteResult = await boundAction(formData);
          if (result.ok) {
            markAnswered(question.id, trimmed);
          } else {
            setError(voteErrorMessage(result.reason));
          }
        });
      }}
      className="flex flex-col gap-3"
    >
      <textarea
        name="answer"
        value={value}
        onChange={(event) => setValue(event.target.value.slice(0, maxLength))}
        maxLength={maxLength}
        placeholder={question.placeholder}
        rows={4}
        className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base outline-none focus:border-[var(--accent)] dark:border-white/15 dark:bg-white/5"
      />
      <div className="flex items-center justify-between text-sm text-black/50 dark:text-white/50">
        <span>{you.myAnswer ? "回答済み。編集して再回答できます" : ""}</span>
        <span className="tabular-nums">
          {value.length}/{maxLength}
        </span>
      </div>
      <VoteSubmitButton
        pending={pending}
        disabled={value.trim().length === 0}
        alreadyAnswered={!!you.myAnswer}
      />
      <VoteError error={error} />
    </form>
  );
}
