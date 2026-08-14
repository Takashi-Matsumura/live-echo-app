"use client";

import { ChoiceVoteForm } from "@/components/choice-vote-form";
import { MultiVoteForm } from "@/components/multi-vote-form";
import { TextVoteForm } from "@/components/text-vote-form";
import { ResultBars } from "@/components/result-bars";
import { TextAnswerList } from "@/components/text-answer-list";
import { useLiveState } from "@/components/live-state-provider";
import { isChoiceLike, selectedChoiceIds } from "@/lib/questions";

export function ParticipantScreen() {
  const { state, you } = useLiveState();
  const { question, phase, revealed, answeredCount, results, position } = state;

  if (!question) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-medium">まもなく開始します</p>
        <p className="text-sm text-black/50 dark:text-white/50">
          講師が設問を選ぶまでお待ちください
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-1">
        {position && (
          <p className="text-xs font-medium tracking-wide text-black/40 dark:text-white/40">
            設問 {position.index + 1} / {position.total}
          </p>
        )}
        <h1 className="text-xl font-semibold leading-relaxed">{question.prompt}</h1>
        {question.note && (
          <p className="text-sm text-black/50 dark:text-white/50">{question.note}</p>
        )}
      </header>

      {revealed && results ? (
        results.kind === "choice" && isChoiceLike(question) ? (
          <ResultBars
            question={question}
            counts={results.counts}
            closed={phase === "closed"}
            respondents={results.respondents}
            yourAnswerIds={selectedChoiceIds(you.myAnswer)}
          />
        ) : results.kind === "text" ? (
          <TextAnswerList answers={results.answers} />
        ) : null
      ) : phase === "open" ? (
        question.kind === "text" ? (
          <TextVoteForm key={question.id} question={question} />
        ) : question.kind === "multi" ? (
          <MultiVoteForm key={question.id} question={question} />
        ) : (
          <ChoiceVoteForm key={question.id} question={question} />
        )
      ) : (
        <p className="text-sm text-black/60 dark:text-white/60">
          受付を締め切りました。結果発表をお待ちください。
        </p>
      )}

      <p className="text-xs text-black/40 dark:text-white/40">
        回答済み: {answeredCount}人
      </p>
    </div>
  );
}
