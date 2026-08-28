"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { ResultBars } from "@/components/result-bars";
import { TextAnswerList } from "@/components/text-answer-list";
import { useLiveState } from "@/components/live-state-provider";
import { isChoiceLike } from "@/lib/questions";

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
  // app/globals.css の dark版メダル色と同じ値（検証済み、result-bars.tsx参照）
  "--chart-bar-rank1": "#eab308",
  "--chart-bar-rank2": "#9fb0c3",
  "--chart-bar-rank3": "#d9663a",
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
        <div className="flex flex-1 flex-col items-center justify-center gap-10 px-8 py-12 text-center">
          <h1 className="text-[clamp(2rem,4.5vw,4rem)] font-semibold">
            アンケートに参加する
          </h1>
          {qrPanel}
        </div>
      ) : (
        // ★以前は max-w-4xl（896px）に収めていたため、大画面プロジェクタでは
        // 左右に大きな余白が残っていた。表示物を主役にするため、幅は
        // ビューポート基準（w-[92vw]、上限だけ広めに確保）に、文字・バーの
        // サイズも clamp() でビューポート幅に応じてスケールする
        // （result-bars.tsx の "large" scale・qr-panel.tsx と同じ方針）。
        <div className="mx-auto flex w-[92vw] max-w-[1800px] flex-1 flex-col justify-center gap-[3vw] px-[2vw] py-[3vw]">
          <header className="flex flex-col gap-3">
            {position && (
              <p className="text-[clamp(1.125rem,1.8vw,1.75rem)] font-medium tracking-wide text-white/50">
                設問 {position.index + 1} / {position.total}
              </p>
            )}
            <h1 className="text-[clamp(2.5rem,4.6vw,5rem)] font-semibold leading-tight">
              {question.prompt}
            </h1>
          </header>

          {revealed && results ? (
            results.kind === "choice" && isChoiceLike(question) ? (
              <ResultBars
                question={question}
                counts={results.counts}
                closed={phase === "closed"}
                respondents={results.respondents}
                scale="large"
              />
            ) : results.kind === "text" ? (
              <TextAnswerList answers={results.answers} scale="large" />
            ) : null
          ) : (
            <div className="flex flex-col items-center gap-4 py-12">
              <p className="text-[clamp(6rem,14vw,12rem)] font-bold tabular-nums">
                {answeredCount}
              </p>
              <p className="text-[clamp(1.5rem,2.6vw,2.5rem)] text-white/60">人 回答済み</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
