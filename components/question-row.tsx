"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  deleteQuestion,
  resetQuestion,
  selectQuestion,
  setPhase,
  setRevealed,
} from "@/app/admin/actions";
import { AdminResults } from "@/components/admin-results";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { GripIcon, PencilIcon, TrashIcon } from "@/components/icons";
import { ToggleButton } from "@/components/toggle-button";
import { QUESTION_KIND_LABELS } from "@/lib/questions";
import type { Phase, PublicResults, Question } from "@/lib/types";

/** 設問一覧の1行。出題中の行だけ自動的に展開して操作ボタン・結果を表示し、
 *  他の行は要約のみの最小高さで並ぶ（components/admin-console.tsx から使う）。 */
export function QuestionRow({
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
  editable,
}: {
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
  /** 準備中モードのときだけ true。編集・削除・この設問のリセットは
   *  破壊的操作なので、進行中モードでは画面から隠す
   *  （components/admin-mode.tsx 参照）。 */
  editable: boolean;
}) {
  const resetDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const liRef = useRef<HTMLLIElement>(null);

  // 出題中になったら、パネルがスクロールしていても見える位置まで自動で
  // スクロールする（スクロール領域は components/admin-tabs.tsx 側。
  // scrollIntoView は最も近いスクロール可能な祖先を自動で探す）。以前は
  // 親（admin-console.tsx）から ref を受け取っていたが、dnd-kit の
  // setNodeRef と合成する必要が出たため、この行自身が isActive を見て
  // 自分でスクロールする形に寄せた。
  useEffect(() => {
    if (isActive) liRef.current?.scrollIntoView({ block: "nearest" });
  }, [isActive]);

  // 並び替えは準備中モード（editable）限定 ── 編集・削除と同じ制約
  // （進行中に順序が変わると参加者・投影画面の「設問 n / 総数」表示が
  // 動くため）。ドラッグはハンドル（GripIcon）だけに attributes/listeners
  // を付け、行全体には付けない ── 編集・削除ボタンの誤爆・ドラッグ開始を防ぐ。
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: question.id, disabled: !editable || pending });

  function setRefs(node: HTMLLIElement | null) {
    liRef.current = node;
    setNodeRef(node);
  }

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setRefs}
      style={style}
      className={`rounded-lg border ${
        isDragging ? "relative z-10 bg-[var(--background)] shadow-lg" : ""
      } ${isActive ? "border-[var(--accent)]" : "border-black/10 dark:border-white/15"}`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {editable && (
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label="ドラッグして並び替え"
            disabled={pending}
            className="flex h-8 w-8 shrink-0 touch-none items-center justify-center rounded-full text-black/40 disabled:opacity-50 dark:text-white/40"
            {...attributes}
            {...listeners}
          >
            <GripIcon />
          </button>
        )}
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
            下の展開部分に残す。★準備中モード限定 — 進行中は「この設問を
            出す」の隣に破壊的な削除ボタンが常設される導線を構造的に消す。 */}
        {editable && (
          <>
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
          </>
        )}

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
            {editable && (
              <button
                type="button"
                disabled={pending}
                aria-label="この設問をリセット"
                onClick={() => resetDialogRef.current?.showModal()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-300 text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-400"
              >
                <TrashIcon />
              </button>
            )}
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
