"use client";

import { useEffect, useRef, useState, useTransition, type Ref, type RefObject } from "react";
import {
  deleteQuestion,
  hideAnswer,
  resetAll,
  resetQuestion,
  selectQuestion,
  setPhase,
  setRevealed,
  unhideAnswer,
} from "@/app/admin/actions";
import { QuestionForm } from "@/components/question-form";
import { ResultBars } from "@/components/result-bars";
import { useLiveState } from "@/components/live-state-provider";
import { isChoiceLike, QUESTION_KIND_LABELS } from "@/lib/questions";
import type { Deck, Phase, PublicResults, Question } from "@/lib/types";

export function AdminConsole({ questions }: { questions: Deck["questions"] }) {
  const { state } = useLiveState();
  const [pending, startTransition] = useTransition();
  const activeItemRef = useRef<HTMLLIElement>(null);
  const formDialogRef = useRef<HTMLDialogElement>(null);
  // null = ダイアログを閉じている。"new" = 新規作成。Question = その設問を編集中。
  const [editing, setEditing] = useState<Question | "new" | null>(null);

  function run(fn: () => Promise<void>) {
    startTransition(async () => {
      await fn();
    });
  }

  // 出題中の設問が切り替わったら、パネルがスクロールしていても見える位置まで
  // 自動でスクロールする（スクロール領域は components/admin-tabs.tsx 側。
  // scrollIntoView は最も近いスクロール可能な祖先を自動で探すので、
  // 領域がどちらにあっても書き換え不要）。
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [state.question?.id]);

  function openCreateForm() {
    setEditing("new");
    formDialogRef.current?.showModal();
  }
  function openEditForm(question: Question) {
    setEditing(question);
    formDialogRef.current?.showModal();
  }
  function closeForm() {
    formDialogRef.current?.close();
    setEditing(null);
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-8">
      <section className="flex flex-col gap-3">
        {/* 見出しはタブボタン（「設問一覧」）自体が兼ねるため、ここでは重複させない
            （components/brand-settings.tsx と同じ判断）。
            設問一覧と「出題中の設問の詳細」はかつて別セクションだったが、
            1つのアコーディオンに統合した: 出題中の行だけが自動的に展開して
            操作ボタン・結果を表示し、他の行は要約のみの最小高さで並ぶ。
            スクロールはこのパネル全体（この「新しい設問を追加」ボタンから
            下）を包む components/admin-tabs.tsx 側の領域が担うため、ここでは
            高さを制限しない。 */}
        <button
          type="button"
          onClick={openCreateForm}
          className="self-start rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
        >
          新しい設問を追加
        </button>

        {questions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-black/10 px-4 py-8 text-center text-sm text-black/50 dark:border-white/15 dark:text-white/50">
            設問がまだ登録されていません。「新しい設問を追加」から作成してください。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
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
                  onEdit={openEditForm}
                />
              );
            })}
          </ul>
        )}
      </section>

      <button
        type="button"
        disabled={pending}
        onClick={() => run(resetAll)}
        className="self-start text-sm text-red-600 underline disabled:opacity-50 dark:text-red-400"
      >
        全体をリセット
      </button>

      {/* 作成・編集共用フォーム。1つのダイアログを使い回し、editing の値で
          中身（QuestionForm）を作り直す。key を切り替えることで、対象が
          変わるたびに内部 state（選択肢の行など）をまっさらにする。 */}
      <dialog
        ref={formDialogRef}
        onClose={() => setEditing(null)}
        className="m-auto rounded-xl border border-black/10 bg-[var(--background)] p-0 text-[var(--foreground)] backdrop:bg-black/40 dark:border-white/15"
      >
        {editing === "new" ? (
          <QuestionForm key="new" mode="create" onDone={closeForm} />
        ) : editing ? (
          <QuestionForm key={editing.id} mode="edit" question={editing} onDone={closeForm} />
        ) : null}
      </dialog>
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
  onEdit,
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
  onEdit: (question: Question) => void;
}) {
  const resetDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);

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
            {QUESTION_KIND_LABELS[question.kind]}
          </p>
          <p className="font-medium">{question.prompt}</p>
        </div>

        {/* 編集・削除は出題中かどうかに関係なく常設（出題中でない設問の
            方が編集・削除する機会は多い）。出題中の受付/結果公開の操作は
            下の展開部分に残す。 */}
        <button
          type="button"
          aria-label="この設問を編集"
          onClick={() => onEdit(question)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/10 text-black/60 dark:border-white/15 dark:text-white/60"
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          aria-label="この設問を削除"
          disabled={pending}
          onClick={() => deleteDialogRef.current?.showModal()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-300 text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-400"
        >
          <TrashIcon />
        </button>

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

          <ConfirmDialog
            dialogRef={resetDialogRef}
            title="この設問をリセットしますか？"
            description="集まった回答と結果公開の状態が消え、この設問は最初の状態に戻ります。"
            confirmLabel="リセットする"
            pending={pending}
            onConfirm={() => run(() => resetQuestion(question.id))}
          />
        </div>
      )}

      <ConfirmDialog
        dialogRef={deleteDialogRef}
        title="この設問を削除しますか？"
        description="回答も含めて完全に削除されます。この操作は取り消せません。"
        confirmLabel="削除する"
        pending={pending}
        onConfirm={() => run(() => deleteQuestion(question.id))}
      />
    </li>
  );
}

/**
 * 「本当に実行しますか？」の確認ダイアログ。この設問をリセット／削除の
 * 両方から使う共用部品。ネイティブ <dialog> + showModal() を使う理由と
 * 実装上の注意点は以下2点（どちらも実機で踏んだ地雷）:
 * - `m-auto` が無いと画面左上に張り付く。dialog:modal の UA スタイルは
 *   margin: auto で中央寄せするが、Tailwind の preflight が全要素に
 *   margin: 0 を当てており、preflight は author の通常優先度なので
 *   詳細度に関係なく UA スタイルに勝ってしまう。
 * - 確定ボタンは type="button" にして明示的に close() する。
 *   type="submit"（method="dialog" の中）のままだと、ネイティブの
 *   クローズ処理と onConfirm 内の startTransition が競合し、ダイアログが
 *   閉じないことがあった。
 */
function ConfirmDialog({
  dialogRef,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <dialog
      ref={dialogRef}
      className="m-auto rounded-xl border border-black/10 bg-[var(--background)] p-0 text-[var(--foreground)] backdrop:bg-black/40 dark:border-white/15"
    >
      <form method="dialog" className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-4 p-5">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-black/50 dark:text-white/50">{description}</p>
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
              onConfirm();
              dialogRef.current?.close();
            }}
            className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
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

function PencilIcon() {
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
      <path d="M13.4 3.4a1.5 1.5 0 0 1 2.12 0l1.08 1.08a1.5 1.5 0 0 1 0 2.12L7.2 15 3 16l1-4.2 9.4-9.4Z" />
      <path d="M11.6 5.2 14.8 8.4" />
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
  if (results.kind === "choice" && isChoiceLike(question)) {
    return (
      <ResultBars
        question={question}
        counts={results.counts}
        closed={closed}
        respondents={results.respondents}
      />
    );
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
