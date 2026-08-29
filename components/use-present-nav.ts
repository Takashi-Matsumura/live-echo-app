"use client";

import { useMemo, useTransition } from "react";
import { setPresentQuestion } from "@/app/admin/actions";
import type { PublicState, Question } from "@/lib/types";

export type PresentNav = {
  readonly pending: boolean;
  /** 切り替えられる公開済みの設問が2件以上あるときだけ true。矢印自体の表示可否に使う。 */
  readonly showNav: boolean;
  readonly canGoPrev: boolean;
  readonly canGoNext: boolean;
  goToPrevious(): void;
  goToNext(): void;
};

/**
 * /present の「設問 X / Y」「振り返り表示」の左右アイコンで、公開済みの
 * 設問（登録順）を行き来するためのロジック。既存の presentQuestionId
 * 固定表示の仕組み（app/admin/actions.ts の setPresentQuestion）を
 * そのまま使う。components/present-screen.tsx から使う。
 */
export function usePresentNav(
  state: PublicState,
  questions: readonly Question[],
): PresentNav {
  const { question, presentOverride, pastQuestions } = state;
  const [pending, startTransition] = useTransition();

  // ★投影を切り替えられるのは「一度でも結果を公開した設問」だけ（結果が
  // 無い設問を切り替え先にしても見せるものが無いため）。pastQuestions は
  // revealedQuestionIds 由来（lib/session/projection.ts の
  // buildPastQuestions）で、公開直後の出題中の設問も含む。並び順は登録順
  // （questions）に揃える ── 公開した順（pastQuestions の配列順）だと、
  // 講師が設問を出す順番を入れ替えた場合に「設問 2/4」の左右と食い違う。
  const revealedIdSet = useMemo(
    () => new Set(pastQuestions.map((p) => p.id)),
    [pastQuestions],
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

  return { pending, showNav, canGoPrev, canGoNext, goToPrevious, goToNext };
}
