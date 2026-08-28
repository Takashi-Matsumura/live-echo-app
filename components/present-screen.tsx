"use client";

import { useEffect, useMemo, useTransition, type CSSProperties, type ReactNode } from "react";
import { setPresentQuestion } from "@/app/admin/actions";
import { FitToViewport } from "@/components/fit-to-viewport";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { ResultBars } from "@/components/result-bars";
import { TextAnswerList } from "@/components/text-answer-list";
import { useLiveState } from "@/components/live-state-provider";
import { isChoiceLike } from "@/lib/questions";
import type { Question } from "@/lib/types";

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

/**
 * 「設問 X / Y」「振り返り表示」の左右に置く切り替えアイコン。投影画面は
 * カーソルを消している（rootClassName の [cursor:none]）が、この操作は
 * マウスで行う前提（ユーザー指示）なので、ボタン上だけ cursor-pointer で
 * 明示的にカーソルを復活させる。
 */
function PresentNavButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={direction === "prev" ? "前の設問の結果に切り替え" : "次の設問の結果に切り替え"}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/25 text-white/70 transition hover:border-white/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-white/25 disabled:hover:text-white/70"
    >
      {direction === "prev" ? <ChevronLeftIcon /> : <ChevronRightIcon />}
    </button>
  );
}

export function PresentScreen({
  qrPanel,
  questions,
}: {
  qrPanel: ReactNode;
  /** 設問一覧（登録順）。過去の結果を切り替える左右アイコンの並び順・
   *  対象を決めるために使う。設問の登録・編集・削除はサーバー操作の
   *  たびにページ全体が作り直されるので、admin-console.tsx と同様に
   *  マウント時に受け取った値をそのまま使う（SSE では配信されない）。 */
  questions: readonly Question[];
}) {
  const { state } = useLiveState();
  const { question, phase, revealed, answeredCount, results, position, presentOverride } = state;
  const [pending, startTransition] = useTransition();

  // ★投影を切り替えられるのは「一度でも結果を公開した設問」だけ（結果が
  // 無い設問を切り替え先にしても見せるものが無いため）。state.pastQuestions
  // は revealedQuestionIds 由来（lib/session/projection.ts の
  // buildPastQuestions）で、公開直後の出題中の設問も含む。並び順は登録順
  // （questions）に揃える ── 公開した順（pastQuestions の配列順）だと、
  // 講師が設問を出す順番を入れ替えた場合に「設問 2/4」の左右と食い違う。
  const revealedIdSet = useMemo(
    () => new Set(state.pastQuestions.map((p) => p.id)),
    [state.pastQuestions],
  );
  const navigableIds = useMemo(
    () => questions.filter((q) => revealedIdSet.has(q.id)).map((q) => q.id),
    [questions, revealedIdSet],
  );
  // 表示中の設問id。固定表示中はその設問、そうでなければ出題中の設問
  // （まだ結果を公開していなくても位置は分かるようにここでは緩く持つ。
  // 実際に矢印を出すかどうかは canGoPrev/canGoNext 側で navigableIds に
  // 含まれるかを見て決める）。
  const currentId = presentOverride ? presentOverride.question.id : (question?.id ?? null);
  const currentIndex = currentId ? navigableIds.indexOf(currentId) : -1;
  // 出題中の設問（まだ固定していない「ライブ」表示）に戻す先の id。
  // 矢印で右端（最新）まで進んだときはここに戻す ── 個別の設問idを
  // pin するのではなく null にして setPresentQuestion(null) を呼ぶ。
  // presentOverride（lib/session/projection.ts の buildPresentOverride）は
  // revealed の状態を無視して常に結果を返すため、出題中の設問をそのまま
  // pin し続けると、講師が「結果非公開」に戻しても投影だけ結果を出し
  // 続けてしまう。null に戻せば通常のライブ分岐（revealed && results）を
  // 通るので、その食い違いが起きない。
  const liveQuestionId = question?.id ?? null;
  const canGoPrev = navigableIds.length > 1 && (currentIndex > 0 || currentIndex === -1);
  const canGoNext =
    navigableIds.length > 1 && currentIndex >= 0 && currentIndex < navigableIds.length - 1;
  const showNav = navigableIds.length > 1;

  function goToPrevious(): void {
    if (!canGoPrev) return;
    const targetId =
      currentIndex > 0 ? navigableIds[currentIndex - 1] : navigableIds[navigableIds.length - 1];
    if (!targetId) return;
    startTransition(async () => {
      await setPresentQuestion(targetId);
    });
  }

  function goToNext(): void {
    if (!canGoNext) return;
    const targetId = navigableIds[currentIndex + 1];
    if (!targetId) return;
    startTransition(async () => {
      // 最新（出題中）の設問まで進んだら、pin ではなくライブ追従に戻す。
      await setPresentQuestion(targetId === liveQuestionId ? null : targetId);
    });
  }

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
            <div className="flex items-center gap-3">
              {showNav && (
                <PresentNavButton
                  direction="prev"
                  disabled={!canGoPrev || pending}
                  onClick={goToPrevious}
                />
              )}
              <p className="text-[clamp(1rem,1.8dvh,1.5rem)] font-medium tracking-wide text-white/50">
                振り返り表示
              </p>
              {showNav && (
                <PresentNavButton
                  direction="next"
                  disabled={!canGoNext || pending}
                  onClick={goToNext}
                />
              )}
            </div>
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
              <div className="flex items-center gap-3">
                {showNav && (
                  <PresentNavButton
                    direction="prev"
                    disabled={!canGoPrev || pending}
                    onClick={goToPrevious}
                  />
                )}
                <p className="text-[clamp(1rem,1.8dvh,1.5rem)] font-medium tracking-wide text-white/50">
                  設問 {position.index + 1} / {position.total}
                </p>
                {showNav && (
                  <PresentNavButton
                    direction="next"
                    disabled={!canGoNext || pending}
                    onClick={goToNext}
                  />
                )}
              </div>
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
                // ★以前は phase === "closed" のときだけ順位（🥇🥈🥉）を出して
                // いた（受付中に票が入るたびメダルの位置がちらつくのを避ける
                // ため）。だが投影は「結果公開中」にした時点で聴衆に見せる
                // 主役画面であり、過去の結果（presentOverride、下の
                // if (presentOverride) 分岐）は常に締切後扱いで順位を出して
                // いるのに、出題中の設問だけ受付中は順位が出ないのは見た目が
                // 揃わない、という指摘を受けて締切前でも常に出す方針に変えた。
                closed
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
