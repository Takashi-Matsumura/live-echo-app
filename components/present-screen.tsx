"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { FitToViewport } from "@/components/fit-to-viewport";
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
  const { question, phase, revealed, answeredCount, results, position, presentOverride } = state;

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

  // ★ルートは h-dvh + overflow-hidden で画面ちょうどの高さに固定する
  // （min-h-screen だとページ自体が伸びてスクロールしうる）。
  // アイドル画面（QR）と「回答済み」待ち表示は、内容量が変動しないため
  // 引き続き FitToViewport（components/fit-to-viewport.tsx）で包んで
  // 中央寄せする。結果表示（choice/text）は選択肢数・回答数によって
  // 画面全体を縮小する挙動をやめ、下記の各分岐で固定サイズのレイアウトを
  // 直接組む。
  const rootClassName =
    "flex h-dvh flex-col overflow-hidden bg-[var(--chart-surface)] text-white [cursor:none]";

  // ★admin が「他の設問の結果を投影で見る」を選んでいる間は、こちらを
  // 進行中の activeQuestionId より優先する（components/admin-console.tsx
  // の投影切替、lib/session/mutations.ts の presentQuestionId 参照）。
  // 参加者の投票フロー（question/phase/revealed/answeredCount）には
  // 一切触れない ── /present の表示だけが一時的に切り離される。
  if (presentOverride) {
    const { question: pinnedQuestion, results: pinnedResults } = presentOverride;
    return (
      <div style={DARK_CHART_VARS} className={rootClassName}>
        <div className="mx-auto flex h-full w-[92vw] max-w-[1800px] flex-col gap-[2dvh] px-[2vw] py-[2dvh]">
          <header className="flex shrink-0 flex-col gap-3">
            <p className="text-[clamp(1rem,1.8dvh,1.5rem)] font-medium tracking-wide text-white/50">
              振り返り表示
            </p>
            <h1 className="line-clamp-2 text-[clamp(1.75rem,3.8dvh,3.5rem)] font-semibold leading-tight">
              {pinnedQuestion.prompt}
            </h1>
          </header>

          <div
            className={`min-h-0 flex-1 ${
              pinnedResults.kind === "choice" ? "flex flex-col justify-center" : ""
            }`}
          >
            {pinnedResults.kind === "choice" && isChoiceLike(pinnedQuestion) ? (
              <ResultBars
                question={pinnedQuestion}
                counts={pinnedResults.counts}
                // この設問はもう投票を受け付けていない（進行中の設問と一致
                // しない限り新規回答は入り得ない）ので、常に締切後扱いにする。
                closed
                respondents={pinnedResults.respondents}
                scale="large"
              />
            ) : pinnedResults.kind === "text" ? (
              <TextAnswerList answers={pinnedResults.answers} scale="large" />
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const showIdle = !question || phase === "idle";

  return (
    <div style={DARK_CHART_VARS} className={rootClassName}>
      {showIdle ? (
        <FitToViewport>
          <div className="flex flex-col items-center gap-10 px-8 py-12 text-center">
            <h1 className="text-[clamp(2rem,4.5vw,4rem)] font-semibold">
              アンケートに参加する
            </h1>
            {qrPanel}
          </div>
        </FitToViewport>
      ) : revealed && results ? (
        // ★以前は max-w-4xl（896px）に収めていたため、大画面プロジェクタでは
        // 左右に大きな余白が残っていた。表示物を主役にするため、幅は
        // ビューポート基準（w-[92vw]、上限だけ広めに確保）にする。
        //
        // ★以前はここも FitToViewport で包み、はみ出す分は画面全体を
        // transform: scale() で縮小して吸収していた。選択肢は最大8つ
        // （lib/questions.ts の MAX_CHOICES）という制約があるため、
        // result-bars.tsx / text-answer-list.tsx の "large" scale 側で
        // 8項目がスクロールなしで収まる固定サイズに決め打ちし、縮小には
        // 頼らない。自由記述だけは件数の上限が無いので、この固定領域の
        // 中を TextAnswerList 自身がスクロールする。
        <div className="mx-auto flex h-full w-[92vw] max-w-[1800px] flex-col gap-[2dvh] px-[2vw] py-[2dvh]">
          <header className="flex shrink-0 flex-col gap-3">
            {position && (
              <p className="text-[clamp(1rem,1.8dvh,1.5rem)] font-medium tracking-wide text-white/50">
                設問 {position.index + 1} / {position.total}
              </p>
            )}
            <h1 className="line-clamp-2 text-[clamp(1.75rem,3.8dvh,3.5rem)] font-semibold leading-tight">
              {question.prompt}
            </h1>
          </header>

          <div
            className={`min-h-0 flex-1 ${
              results.kind === "choice" ? "flex flex-col justify-center" : ""
            }`}
          >
            {results.kind === "choice" && isChoiceLike(question) ? (
              <ResultBars
                question={question}
                counts={results.counts}
                closed={phase === "closed"}
                respondents={results.respondents}
                scale="large"
              />
            ) : results.kind === "text" ? (
              <TextAnswerList answers={results.answers} scale="large" />
            ) : null}
          </div>
        </div>
      ) : (
        <FitToViewport>
          <div className="mx-auto flex w-[92vw] max-w-[1800px] flex-col gap-[3vw] px-[2vw] py-[3vw]">
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

            <div className="flex flex-col items-center gap-4 py-12">
              <p className="text-[clamp(6rem,14vw,12rem)] font-bold tabular-nums">
                {answeredCount}
              </p>
              <p className="text-[clamp(1.5rem,2.6vw,2.5rem)] text-white/60">人 回答済み</p>
            </div>
          </div>
        </FitToViewport>
      )}
    </div>
  );
}
