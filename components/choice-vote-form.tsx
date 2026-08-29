"use client";

import { useState, useTransition } from "react";
import { submitVote } from "@/app/actions";
import { useLiveState } from "@/components/live-state-provider";
import { VoteError } from "@/components/vote-error";
import { VoteOptionLabel } from "@/components/vote-option-label";
import { VoteSubmitButton } from "@/components/vote-submit-button";
import { asFormAction } from "@/lib/form-action";
import { answerText } from "@/lib/questions";
import { voteErrorMessage } from "@/lib/vote-messages";
import type { ChoiceQuestion, VoteResult } from "@/lib/types";

/**
 * 単一選択式の投票フォーム。選択肢をタップした瞬間には送信しない —
 * 複数選択式（multi-vote-form.tsx）・自由記述（text-vote-form.tsx）と
 * 同じ「選ぶ／書く → 回答するボタンで送信」という一貫した操作にするため。
 *
 * 設問が切り替わったときに state をリセットするため、呼び出し側
 * （participant-screen.tsx）で `key={question.id}` を付けてマウントし直す
 * 前提（他の投票フォームと同じ規約）。
 */
export function ChoiceVoteForm({ question }: { question: ChoiceQuestion }) {
  const { you, markAnswered } = useLiveState();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string | null>(() => answerText(you.myAnswer));
  const [error, setError] = useState<string | null>(null);

  const boundAction = submitVote.bind(null, question.id);
  const formAction = asFormAction(boundAction);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (!selected) return;
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result: VoteResult = await boundAction(formData);
          if (result.ok) {
            markAnswered(question.id, selected);
          } else {
            setError(voteErrorMessage(result.reason));
          }
        });
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-3" role="list">
        {question.choices.map((choice) => (
          <VoteOptionLabel
            key={choice.id}
            type="radio"
            label={choice.label}
            value={choice.id}
            checked={selected === choice.id}
            onChange={() => setSelected(choice.id)}
          />
        ))}
      </div>

      {you.myAnswer && (
        <p className="text-sm text-black/50 dark:text-white/50">
          回答済み。選び直して再回答できます
        </p>
      )}

      <VoteSubmitButton pending={pending} disabled={!selected} alreadyAnswered={!!you.myAnswer} />
      <VoteError error={error} />
    </form>
  );
}
