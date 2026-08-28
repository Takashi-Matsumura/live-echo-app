"use client";

import { useRef, useState } from "react";
import { ChoiceVoteForm } from "@/components/choice-vote-form";
import { MultiVoteForm } from "@/components/multi-vote-form";
import { TextVoteForm } from "@/components/text-vote-form";
import { ResultBars } from "@/components/result-bars";
import { TextAnswerList } from "@/components/text-answer-list";
import { useLiveState } from "@/components/live-state-provider";
import { isChoiceLike, selectedChoiceIds } from "@/lib/questions";
import type { PublicResults, Question } from "@/lib/types";

type PastResult = { readonly question: Question; readonly results: PublicResults };

async function fetchPastResult(questionId: string): Promise<PastResult | null> {
  try {
    // "/" は常に view=participant（components/live-state-provider.tsx の
    // view prop と同じ理由 — le_admin Cookie を持つ端末でも、この画面から
    // 取得する結果は参加者向けの形にする）。
    const res = await fetch(
      `/api/results?questionId=${encodeURIComponent(questionId)}&view=participant`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as PastResult;
  } catch {
    return null;
  }
}

export function ParticipantScreen() {
  const { state, you } = useLiveState();
  const { question, phase, revealed, answeredCount, results, position, pastQuestions } = state;

  // null = 通常のライブ画面。文字列なら「過去の結果」一覧の中でその
  // questionId を開いている状態（一覧自体は常時 pastQuestions から出す
  // ので別 state は要らない）。
  const [viewingPastId, setViewingPastId] = useState<string | null>(null);
  const [pastListOpen, setPastListOpen] = useState(false);
  const [pastResult, setPastResult] = useState<PastResult | null>(null);
  const [pastLoadFailed, setPastLoadFailed] = useState(false);
  // 取得中に選び直された／画面を閉じられた場合に、古い fetch の結果で
  // 上書きしないためのガード（setState を関数の中で読み書きする回りくどい
  // パターンを避け、単純な採番で「今表示すべき応答か」を判定する）。
  const pastRequestIdRef = useRef(0);

  function closePastBrowser() {
    pastRequestIdRef.current += 1;
    setPastListOpen(false);
    setViewingPastId(null);
    setPastResult(null);
    setPastLoadFailed(false);
  }

  function backToPastList() {
    pastRequestIdRef.current += 1;
    setViewingPastId(null);
    setPastResult(null);
    setPastLoadFailed(false);
  }

  async function openPastQuestion(id: string) {
    const requestId = (pastRequestIdRef.current += 1);
    setViewingPastId(id);
    setPastResult(null);
    setPastLoadFailed(false);
    const result = await fetchPastResult(id);
    if (pastRequestIdRef.current !== requestId) return;
    if (result) {
      setPastResult(result);
    } else {
      setPastLoadFailed(true);
    }
  }

  // ── 過去の結果: 個別表示 ─────────────────────────────────────
  if (viewingPastId) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-10">
        <button
          type="button"
          onClick={backToPastList}
          className="self-start text-sm text-black/50 underline dark:text-white/50"
        >
          ← 一覧に戻る
        </button>

        {pastResult ? (
          <>
            <h1 className="text-xl font-semibold leading-relaxed">
              {pastResult.question.prompt}
            </h1>
            {pastResult.results.kind === "choice" && isChoiceLike(pastResult.question) ? (
              <ResultBars
                question={pastResult.question}
                counts={pastResult.results.counts}
                // 過去に公開された設問は、もう投票を受け付けていない前提。
                closed
                respondents={pastResult.results.respondents}
              />
            ) : pastResult.results.kind === "text" ? (
              <TextAnswerList answers={pastResult.results.answers} />
            ) : null}
          </>
        ) : pastLoadFailed ? (
          <p className="text-sm text-black/60 dark:text-white/60">
            結果を取得できませんでした。もう一度お試しください。
          </p>
        ) : (
          <p className="text-sm text-black/50 dark:text-white/50">読み込み中…</p>
        )}
      </div>
    );
  }

  // ── 過去の結果: 一覧 ────────────────────────────────────────
  if (pastListOpen) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-6 py-10">
        <button
          type="button"
          onClick={closePastBrowser}
          className="self-start text-sm text-black/50 underline dark:text-white/50"
        >
          ← 戻る
        </button>
        <h1 className="text-lg font-semibold">過去の結果</h1>
        {pastQuestions.length === 0 ? (
          <p className="text-sm text-black/50 dark:text-white/50">
            まだ結果が公開された設問はありません
          </p>
        ) : (
          <ul className="flex flex-col gap-2" role="list">
            {pastQuestions.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => openPastQuestion(q.id)}
                  className="w-full rounded-lg border border-black/10 px-4 py-3 text-left text-sm dark:border-white/15"
                >
                  {q.prompt}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── 通常のライブ画面 ────────────────────────────────────────
  if (!question) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-medium">まもなく開始します</p>
        <p className="text-sm text-black/50 dark:text-white/50">
          講師が設問を選ぶまでお待ちください
        </p>
        {pastQuestions.length > 0 && (
          <button
            type="button"
            onClick={() => setPastListOpen(true)}
            className="mt-4 text-sm text-black/50 underline dark:text-white/50"
          >
            過去の結果を見る
          </button>
        )}
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

      {pastQuestions.length > 0 && (
        <button
          type="button"
          onClick={() => setPastListOpen(true)}
          className="self-start text-sm text-black/50 underline dark:text-white/50"
        >
          過去の結果を見る
        </button>
      )}
    </div>
  );
}
