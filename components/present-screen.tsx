"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { ResultBars } from "@/components/result-bars";
import { TextAnswerList } from "@/components/text-answer-list";
import { useLiveState } from "@/components/live-state-provider";

// /present は投影用なので、システムのカラースキームに関わらず常にダーク
// 固定にする。globals.css の @media (prefers-color-scheme: dark) には
// 乗らない（会場が明るい部屋でも、投影機の設定が light でも関係ない）ため、
// この div のスコープだけ CSS 変数を直接上書きする。
const DARK_CHART_VARS = {
  "--chart-surface": "#1a1a19",
  "--chart-bar": "#3987e5",
  "--chart-bar-muted": "#898781",
  "--chart-track": "#2c2c2a",
  "--chart-text": "#ffffff",
  "--chart-text-muted": "#c3c2b7",
  "--accent": "#3987e5",
} as CSSProperties;

export function PresentScreen({ qrPanel }: { qrPanel: ReactNode }) {
  const { state } = useLiveState();
  const { question, phase, revealed, answeredCount, results, position } = state;

  useEffect(() => {
    // スリープ抑止。対応ブラウザ（iOS Safari 16.4+ 等）でのみ効く。
    // 失敗しても投影自体は継続できるので握り潰す。
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> };
    };
    let sentinel: { release(): Promise<void> } | null = null;
    nav.wakeLock
      ?.request("screen")
      .then((s) => {
        sentinel = s;
      })
      .catch(() => {});
    return () => {
      void sentinel?.release().catch(() => {});
    };
  }, []);

  const showIdle = !question || phase === "idle";

  return (
    <div
      style={DARK_CHART_VARS}
      className="flex min-h-screen flex-1 flex-col bg-[var(--chart-surface)] text-white [cursor:none]"
    >
      {showIdle ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-8 py-16 text-center">
          <h1 className="text-3xl font-semibold">アンケートに参加する</h1>
          {qrPanel}
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-10 px-12 py-16">
          <header className="flex flex-col gap-3">
            {position && (
              <p className="text-lg font-medium tracking-wide text-white/50">
                設問 {position.index + 1} / {position.total}
              </p>
            )}
            <h1 className="text-4xl font-semibold leading-tight">{question.prompt}</h1>
          </header>

          {revealed && results ? (
            results.kind === "choice" && question.kind === "choice" ? (
              <ResultBars
                question={question}
                counts={results.counts}
                closed={phase === "closed"}
                scale="large"
              />
            ) : results.kind === "text" ? (
              <TextAnswerList answers={results.answers} />
            ) : null
          ) : (
            <div className="flex flex-col items-center gap-4 py-12">
              <p className="text-8xl font-bold tabular-nums">{answeredCount}</p>
              <p className="text-2xl text-white/60">人 回答済み</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
