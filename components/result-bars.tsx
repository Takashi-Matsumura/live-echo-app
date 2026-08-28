"use client";

import { useEffect, useState } from "react";
import type { AnyChoiceQuestion } from "@/lib/types";

const SCALE = {
  default: {
    track: "h-3.5",
    label: "text-sm",
    count: "text-sm",
    badge: "h-4 w-4 text-[10px]",
    medal: "text-sm",
  },
  // /present（投影モード）用。dataviz スキルの「バーは24px以下」という
  // マーク仕様は、複数系列が並ぶ通常のダッシュボードを前提にした指針。
  // ここは1画面1系列（choice）だけを大写しする「投影の主役」なので、
  // 視聴距離の長さを踏まえてあえて超える（clamp()でビューポート幅に
  // 応じて滑らかにスケールし、小さい投影機では過大にならない）。
  large: {
    track: "h-[clamp(2.25rem,3.4vw,4rem)]",
    label: "text-[clamp(1.375rem,2.1vw,2.25rem)]",
    count: "text-[clamp(1.125rem,1.6vw,1.75rem)]",
    badge: "h-8 w-8 text-base",
    medal: "text-[clamp(1.5rem,2.2vw,2.25rem)]",
  },
} as const;

const RANK_EMOJI: Record<1 | 2 | 3, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

// 行ごとの段差（スタガー）演出用の遅延クラス。Tailwind はビルド時に
// クラス名を静的解析するため、`` `delay-[${n}ms]` `` のようなテンプレート
// 文字列では拾えない。固定の文字列配列にして参照する（MAX_CHOICES=8件分）。
// motion-safe: 修飾子付きなので prefers-reduced-motion のときは効かない。
const STAGGER_DELAY_CLASSES = [
  "motion-safe:delay-[0ms]",
  "motion-safe:delay-[70ms]",
  "motion-safe:delay-[140ms]",
  "motion-safe:delay-[210ms]",
  "motion-safe:delay-[280ms]",
  "motion-safe:delay-[350ms]",
  "motion-safe:delay-[420ms]",
  "motion-safe:delay-[490ms]",
] as const;

/** 締切後（closed）の上位3位を選択肢idごとに算出する。同数は同順位
 *  （例: 2choiceが同数で1位なら両方rank1、次点はrank2）。0票は対象外。 */
function computeRanks(
  question: AnyChoiceQuestion,
  counts: Readonly<Record<string, number>>,
): ReadonlyMap<string, 1 | 2 | 3> {
  const distinctDesc = Array.from(
    new Set(question.choices.map((c) => counts[c.id] ?? 0)),
  )
    .filter((v) => v > 0)
    .sort((a, b) => b - a);
  const rankByValue = new Map<number, 1 | 2 | 3>(
    distinctDesc.slice(0, 3).map((value, i) => [value, (i + 1) as 1 | 2 | 3]),
  );
  const result = new Map<string, 1 | 2 | 3>();
  for (const choice of question.choices) {
    const rank = rankByValue.get(counts[choice.id] ?? 0);
    if (rank) result.set(choice.id, rank);
  }
  return result;
}

/**
 * 選択式（単一・複数）の結果を横棒グラフで表示する。dataviz スキルの原則:
 * - 1系列=1色。選択肢ごとに色を変えない（読者のタスクは大小比較であって識別ではない）
 * - 勝者の強調は closed（締切後）のときだけ。受付中に色分けすると票が入るたびに
 *   ちらつくため、受付中は全バー同色
 * - 自分の回答は色ではなくチェックマークで示す（色だけに意味を持たせない）
 * - 凡例・軸・グリッド・ツールチップは無し（1系列・全値に直接ラベル）
 *
 * ★上位3位の色分け（closed限定）は dataviz スキルの categorical
 * 六項目チェックの対象外として扱う ── 識別用の可変カテゴリ色ではなく、
 * 「1位・2位・3位」という意味が固定された少数スケール（status パレット
 * と同じ性質）。CVD分離・通常視野floor・背景コントラストは検証済み
 * （app/globals.css の --chart-bar-rank1/2/3 のコメント参照）。色だけに
 * 頼らせないよう、絵文字メダル（🥇🥈🥉）を必ず併記する。
 *
 * % は respondents（この設問に回答した人数）を分母にする。単一選択では
 * 必ず counts の総和と一致するが、複数選択では1人が複数選ぶため一致
 * せず、合計が100%を超えうる（question.kind === "multi" のとき注記を出す）。
 */
export function ResultBars({
  question,
  counts,
  closed,
  respondents,
  yourAnswerIds,
  scale = "default",
}: {
  question: AnyChoiceQuestion;
  counts: Readonly<Record<string, number>>;
  closed: boolean;
  /** この設問に回答した人数。% の分母。 */
  respondents: number;
  yourAnswerIds?: readonly string[];
  /** "large" は /present（投影モード）用。バー・文字を大きくする */
  scale?: "default" | "large";
}) {
  const values = question.choices.map((choice) => counts[choice.id] ?? 0);
  const max = Math.max(1, ...values);
  const sizes = SCALE[scale];
  const yourAnswerSet = new Set(yourAnswerIds ?? []);
  const ranks = closed ? computeRanks(question, counts) : null;

  // マウント直後は幅0から現在値まで伸ばす「登場アニメーション」。
  // present-screen.tsx / admin-console.tsx はどちらも「結果を表示する
  // 瞬間に ResultBars を新規マウントする」構成（revealed が false の間は
  // そもそもレンダーされない）ので、mount = 結果が現れる瞬間そのもの。
  // 投票が入るたびの差分更新は、下の motion-safe:transition-[width] に
  // 引き続き任せる（この state は初回だけ false→true になり、以後は
  // 変化しない）。
  const [grown, setGrown] = useState(false);
  // 行ごとの段差（スタガー）演出は登場時の1回だけに限定する。stagger中
  // フラグを一定時間で自動的に降ろし、以後の差分更新（投票の増減）では
  // 全行が即座に反応するようにする。
  const [staggering, setStaggering] = useState(true);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setGrown(true));
    const timer = setTimeout(() => setStaggering(false), 1200);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, []);

  return (
    <ul className="flex flex-col gap-3" role="list">
      {question.choices.map((choice, index) => {
        const count = counts[choice.id] ?? 0;
        const pct = respondents > 0 ? Math.round((count / respondents) * 100) : 0;
        const widthPct = respondents > 0 ? (count / max) * 100 : 0;
        const rank = ranks?.get(choice.id) ?? null;
        const isYours = yourAnswerSet.has(choice.id);
        const barColor = !closed
          ? "var(--chart-bar)"
          : rank
            ? `var(--chart-bar-rank${rank})`
            : "var(--chart-bar-muted)";

        return (
          <li
            key={choice.id}
            role="listitem"
            aria-label={`${choice.label}: ${count}票（${pct}%）${rank ? `・${rank}位` : ""}${isYours ? "・あなたの回答" : ""}`}
            className="grid grid-cols-[1fr_auto] items-center gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <span
                className={`flex items-center gap-1.5 text-[var(--chart-text)] ${sizes.label}`}
              >
                {rank && (
                  <span aria-hidden className={sizes.medal}>
                    {RANK_EMOJI[rank]}
                  </span>
                )}
                <span>{choice.label}</span>
                {isYours && (
                  <span
                    aria-hidden
                    className={`inline-flex items-center justify-center rounded-full bg-[var(--accent)] text-white ${sizes.badge}`}
                  >
                    ✓
                  </span>
                )}
              </span>
              <div className={`overflow-hidden rounded-r bg-[var(--chart-track)] ${sizes.track}`}>
                <div
                  className={`relative h-full overflow-hidden rounded-r motion-safe:transition-[width] motion-safe:duration-[750ms] motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)] ${
                    staggering ? (STAGGER_DELAY_CLASSES[index] ?? "motion-safe:delay-[490ms]") : "motion-safe:delay-[0ms]"
                  }`}
                  style={{
                    width: grown ? `${widthPct}%` : "0%",
                    boxShadow: rank === 1 ? "0 0 18px var(--chart-bar-rank1)" : undefined,
                  }}
                >
                  {/* 塗り本体 */}
                  <div className="absolute inset-0" style={{ backgroundColor: barColor }} />
                  {/* macOS風の「グラス」仕上げ: 上半分に強いハイライト、
                      全体にごく薄い縦グラデーション。ボーダーではなく光の
                      層で立体感を出す（マークを線で囲わない、というdataviz
                      スキルの原則を守る）。 */}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/35 via-white/0 to-black/10" />
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/45 to-transparent" />
                  <div className="pointer-events-none absolute inset-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]" />
                </div>
              </div>
            </div>
            <span
              aria-hidden
              className={`shrink-0 text-right tabular-nums text-[var(--chart-text-muted)] ${sizes.count}`}
            >
              {count}票（{pct}%）
            </span>
          </li>
        );
      })}
      {question.kind === "multi" && (
        <li aria-hidden className="text-xs text-[var(--chart-text-muted)]">
          複数選択式のため、割合の合計が100%を超えることがあります。
        </li>
      )}
    </ul>
  );
}
