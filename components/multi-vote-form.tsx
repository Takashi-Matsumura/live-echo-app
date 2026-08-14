"use client";

import { useState, useTransition } from "react";
import { submitVote } from "@/app/actions";
import { useLiveState } from "@/components/live-state-provider";
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
        {question.choices.map((choice) => {
          const isChecked = selected.has(choice.id);
          return (
            <label
              key={choice.id}
              role="listitem"
              className={`flex w-full cursor-pointer items-center justify-between rounded-xl border px-5 py-4 text-left text-base font-medium transition-colors ${
                isChecked
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-black/10 bg-white hover:border-black/20 dark:border-white/15 dark:bg-white/5 dark:hover:border-white/25"
              }`}
            >
              <span>{choice.label}</span>
              <input
                type="checkbox"
                name="answer"
                value={choice.id}
                checked={isChecked}
                onChange={() => toggle(choice.id)}
                className="sr-only"
              />
              {isChecked && <span aria-hidden>✓</span>}
            </label>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-sm text-black/50 dark:text-white/50">
        <span>
          {you.myAnswer ? "回答済み。選び直して再回答できます" : "当てはまるものをすべて選んでください"}
        </span>
        <span className="tabular-nums">{selected.size}個選択中</span>
      </div>

      <button
        type="submit"
        disabled={pending || selected.size === 0}
        className="self-start rounded-full bg-[var(--accent)] px-6 py-3 font-medium text-white disabled:opacity-50"
      >
        {you.myAnswer ? "回答し直す" : "回答する"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
