"use client";

import { useState, useTransition } from "react";
import { submitVote } from "@/app/actions";
import { useLiveState } from "@/components/live-state-provider";
import { VoteError } from "@/components/vote-error";
import { VoteOptionLabel } from "@/components/vote-option-label";
import { VoteSubmitButton } from "@/components/vote-submit-button";
import { asFormAction } from "@/lib/form-action";
import { selectedChoiceIds } from "@/lib/questions";
import { voteErrorMessage } from "@/lib/vote-messages";
import type { MultiChoiceQuestion, VoteResult } from "@/lib/types";

/**
 * 複数選択式の投票フォーム。単一選択（choice-vote-form.tsx）・自由記述
 * （text-vote-form.tsx）と同じ「選ぶ／書く → 回答するボタンで送信」と
 * いう操作に揃えている。タップした瞬間には送信しない — 選択肢を選び
 * 終えるまでの途中経過を都度サーバへ送ると (1) 投票のレート制限
 * （20回/60秒）にすぐ達し、(2) 投影画面に選択途中の状態がちらつく。
 * ここでは選択をローカル state でトグルし、ボタンで一括送信する。
 *
 * 設問が切り替わったときに state をリセットするため、呼び出し側
 * （participant-screen.tsx）で `key={question.id}` を付けてマウントし直す
 * 前提（text-vote-form.tsx と同じ規約）。
 */
export function MultiVoteForm({ question }: { question: MultiChoiceQuestion }) {
  const { you, markAnswered } = useLiveState();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(selectedChoiceIds(you.myAnswer)),
  );
  const [error, setError] = useState<string | null>(null);

  const boundAction = submitVote.bind(null, question.id);
  const formAction = asFormAction(boundAction);

  function toggle(choiceId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(choiceId)) {
        next.delete(choiceId);
      } else {
        next.add(choiceId);
      }
      return next;
    });
  }

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (selected.size === 0) return;
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result: VoteResult = await boundAction(formData);
          if (result.ok) {
            markAnswered(question.id, question.choices.map((c) => c.id).filter((id) => selected.has(id)));
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
            type="checkbox"
            label={choice.label}
            value={choice.id}
            checked={selected.has(choice.id)}
            onChange={() => toggle(choice.id)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between text-sm text-black/50 dark:text-white/50">
        <span>
          {you.myAnswer ? "回答済み。選び直して再回答できます" : "当てはまるものをすべて選んでください"}
        </span>
        <span className="tabular-nums">{selected.size}個選択中</span>
      </div>

      <VoteSubmitButton
        pending={pending}
        disabled={selected.size === 0}
        alreadyAnswered={!!you.myAnswer}
      />
      <VoteError error={error} />
    </form>
  );
}
