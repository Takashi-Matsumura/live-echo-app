"use client";

import { useEffect, useRef, useTransition, type Ref } from "react";
import {
  hideAnswer,
  resetAll,
  resetQuestion,
  selectQuestion,
  setPhase,
  setRevealed,
  unhideAnswer,
} from "@/app/admin/actions";
import { ResultBars } from "@/components/result-bars";
import { useLiveState } from "@/components/live-state-provider";
import type { Deck, Phase, PublicResults, Question } from "@/lib/types";

export function AdminConsole({ questions }: { questions: Deck["questions"] }) {
  const { state } = useLiveState();
  const [pending, startTransition] = useTransition();
  const activeItemRef = useRef<HTMLLIElement>(null);

  function run(fn: () => Promise<void>) {
    startTransition(async () => {
      await fn();
    });
  }

  // 出題中の設問が切り替わったら、リストがスクロールしていても見える位置まで
  // 自動でスクロールする（下の <ul> に max-h + overflow-y-auto を付けたため、
  // 設問数が増えるとリストの途中に隠れうる）。
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [state.question?.id]);

  return (
    <div className="flex w-full min-w-0 flex-col gap-8">
      <section className="flex flex-col gap-2">
        {/* 見出しはタブボタン（「設問一覧」）自体が兼ねるため、ここでは重複させない
            （components/brand-settings.tsx と同じ判断）。
            設問一覧と「出題中の設問の詳細」はかつて別セクションだったが、
            1つのアコーディオンに統合した: 出題中の行だけが自動的に展開して
            操作ボタン・結果を表示し、他の行は要約のみの最小高さで並ぶ。
            出題中の1行ぶんしか大きくならないので、設問数が増えても
            「一覧の行＋別セクションの詳細」という二重の高さを持たない。
            それでも十分な設問数・回答数になった場合の保険として、リスト
            自体にも高さ上限つきスクロールを残す（ビューポート相対）。 */}
        <ul className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto pr-1">
          {questions.map((q, i) => {
            const isActive = state.question?.id === q.id;
            return (
              <QuestionRow
                key={q.id}
                itemRef={isActive ? activeItemRef : undefined}
                index={i}
                question={q}
                isActive={isActive}
                pending={pending}
                answeredCount={state.answeredCount}
                phase={state.phase}
                revealed={state.revealed}
                results={state.results}
                run={run}
              />
            );
          })}
        </ul>
      </section>

      <button
        type="button"
        disabled={pending}
        onClick={() => run(resetAll)}
        className="self-start text-sm text-red-600 underline disabled:opacity-50 dark:text-red-400"
      >
        全体をリセット
      </button>
    </div>
  );
}

function QuestionRow({
  itemRef,
  index,
  question,
  isActive,
  pending,
  answeredCount,
  phase,
  revealed,
  results,
  run,
}: {
  itemRef?: Ref<HTMLLIElement>;
  index: number;
  question: Question;
  isActive: boolean;
  pending: boolean;
  answeredCount: number;
  phase: Phase;
  revealed: boolean;
  results: PublicResults | null;
  run: (fn: () => Promise<void>) => void;
}) {
  const resetDialogRef = useRef<HTMLDialogElement>(null);

  return (
    <li
      ref={itemRef}
      className={`rounded-lg border ${
        isActive ? "border-[var(--accent)]" : "border-black/10 dark:border-white/15"
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {/* 設問番号を丸バッジにして視認性を上げる（旧「設問1」というテキストより
            大きく目立つ）。種別ラベルはバッジと重複しないよう「選択式」等のみ残す。 */}
        <span
          aria-hidden
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            isActive
              ? "bg-[var(--accent)] text-white"
              : "bg-black/5 text-black/60 dark:bg-white/10 dark:text-white/60"
          }`}
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-black/40 dark:text-white/40">
            {question.kind === "choice" ? "選択式" : "自由記述"}
          </p>
          <p className="font-medium">{question.prompt}</p>
        </div>
        {isActive ? (
          // ★出題中の行はボタンではなく非活性の pill にする。以前は出題中でも
          // 同じ selectQuestion 呼び出しが残っていて、押すと
          // applySelectQuestion（lib/session/mutations.ts）が phase/revealed
          // を無条件でリセットしてしまっていた（受付締切後や結果公開後に
          // 誤って押すと状態が巻き戻る実害のあるバグ）。ここで併せて直す。
          <span className="shrink-0 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">
            出題中
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => selectQuestion(question.id))}
            className="shrink-0 rounded-full border border-black/10 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-white/15"
          >
            この設問を出す
          </button>
        )}
      </div>

      {/* 展開部分。出題中の行だけ描画される＝アコーディオンの「開」状態。
          非出題中の設問には安全なプレビューが無い（selectQuestion は必ず
          phase/revealed をリセットする本番の状態変更で、結果も
          projection.ts が出題中の設問ぶんしかクライアントに配らない）ため、
          他の行は要約のままにしてある。 */}
      {isActive && (
        <div className="flex flex-col gap-4 border-t border-black/10 px-4 py-4 dark:border-white/15">
          <span className="text-sm text-black/50 dark:text-white/50">
            回答済み: {answeredCount}人
          </span>

          <div className="flex flex-wrap items-center gap-2">
            <ToggleButton
              checked={phase === "open"}
              disabled={pending}
              onClick={() => run(() => setPhase(phase === "open" ? "closed" : "open"))}
              onLabel="受付中"
              offLabel="受付停止"
            />
            <ToggleButton
              checked={revealed}
              disabled={pending}
              onClick={() => run(() => setRevealed(!revealed))}
              onLabel="結果公開中"
              offLabel="結果非公開"
            />
            <button
              type="button"
              disabled={pending}
              aria-label="この設問をリセット"
              onClick={() => resetDialogRef.current?.showModal()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-300 text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-400"
            >
              <TrashIcon />
            </button>
          </div>

          {results && (
            <AdminResults
              question={question}
              results={results}
              closed={phase === "closed"}
              pending={pending}
              run={run}
            />
          )}

          {/* リセットは破壊的操作（回答・結果公開状態が消える）なので、
              ネイティブ <dialog> で確認を挟む。showModal() が Esc キー・
              フォーカストラップ・背景クリックでの扱いも面倒を見てくれる。
              ★ m-auto は必須。dialog:modal の UA スタイルは margin: auto で
              画面中央に配置するが、Tailwind の preflight が * に margin: 0
              を当てており、preflight は author の通常優先度なので UA
              スタイルに（詳細度に関係なく）必ず勝つ。結果、m-auto を
              明示しないと dialog が左上に張り付く（実機で確認済み）。 */}
          <dialog
            ref={resetDialogRef}
            className="m-auto rounded-xl border border-black/10 bg-[var(--background)] p-0 text-[var(--foreground)] backdrop:bg-black/40 dark:border-white/15"
          >
            <form method="dialog" className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-4 p-5">
              <p className="font-medium">この設問をリセットしますか？</p>
              <p className="text-sm text-black/50 dark:text-white/50">
                集まった回答と結果公開の状態が消え、この設問は最初の状態に戻ります。
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="submit"
                  className="rounded-full border border-black/10 px-4 py-2 text-sm dark:border-white/15"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    // ★ type="submit" のままだと、method="dialog" のネイティブ
                    // クローズ処理と onClick 内の run()（startTransition）が
                    // 競合し、ダイアログが閉じないことがあった（実機で確認済み）。
                    // type="button" にして明示的に close() する。
                    run(() => resetQuestion(question.id));
                    resetDialogRef.current?.close();
                  }}
                  className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  リセットする
                </button>
              </div>
            </form>
          </dialog>
        </div>
      )}
    </li>
  );
}

function ToggleButton({
  checked,
  disabled,
  onClick,
  onLabel,
  offLabel,
}: {
  checked: boolean;
  disabled: boolean;
  onClick: () => void;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
        checked
          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
          : "border-black/10 text-black/60 dark:border-white/15 dark:text-white/60"
      }`}
    >
      <span
        aria-hidden
        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full ${
          checked ? "bg-[var(--accent)]" : "bg-black/20 dark:bg-white/20"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </span>
      {checked ? onLabel : offLabel}
    </button>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m-6.5 0 .6 9.4A1.5 1.5 0 0 0 7.6 17h4.8a1.5 1.5 0 0 0 1.5-1.6L14.5 6M8.5 9.5v4m3-4v4" />
    </svg>
  );
}

function AdminResults({
  question,
  results,
  closed,
  pending,
  run,
}: {
  question: Question;
  results: PublicResults;
  closed: boolean;
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
}) {
  if (results.kind === "choice" && question.kind === "choice") {
    return <ResultBars question={question} counts={results.counts} closed={closed} />;
  }

  if (results.kind === "text") {
    if (results.answers.length === 0) {
      return (
        <p className="text-sm text-black/50 dark:text-white/50">
          まだ回答がありません
        </p>
      );
    }
    return (
      // 回答は参加者数ぶん増えうる。上の進行ボタン群が常に画面内に留まるよう
      // ここだけ高さ上限つきでスクロールさせる（外側の <ul> とは独立した領域）。
      <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
        {results.answers.map((answer) => (
          <li
            key={answer.id}
            className={`flex items-start justify-between gap-3 rounded-lg px-4 py-3 text-sm ${
              answer.hidden
                ? "bg-black/5 text-black/40 dark:bg-white/5 dark:text-white/40"
                : "bg-black/5 dark:bg-white/10"
            }`}
          >
            <span className="flex-1">
              {answer.hidden && <span className="mr-1">（伏せ中）</span>}
              {answer.text}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() =>
                  answer.hidden
                    ? unhideAnswer(question.id, answer.id)
                    : hideAnswer(question.id, answer.id),
                )
              }
              className="shrink-0 text-xs text-black/40 underline disabled:opacity-50 dark:text-white/40"
            >
              {answer.hidden ? "表示する" : "伏せる"}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return null;
}
