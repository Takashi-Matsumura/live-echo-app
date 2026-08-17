"use client";

import type { RefObject } from "react";

/**
 * 「本当に実行しますか？」の確認ダイアログ。設問のリセット／削除／
 * インポート時の置き換えなど、破壊的な操作の確認に共用する部品。
 * ネイティブ <dialog> + showModal() を使う理由と実装上の注意点は以下
 * 2点（どちらも実機で踏んだ地雷）:
 * - `m-auto` が無いと画面左上に張り付く。dialog:modal の UA スタイルは
 *   margin: auto で中央寄せするが、Tailwind の preflight が全要素に
 *   margin: 0 を当てており、preflight は author の通常優先度なので
 *   詳細度に関係なく UA スタイルに勝ってしまう。
 * - 確定ボタンは type="button" にして明示的に close() する。
 *   type="submit"（method="dialog" の中）のままだと、ネイティブの
 *   クローズ処理と onConfirm 内の startTransition が競合し、ダイアログが
 *   閉じないことがあった。
 */
export function ConfirmDialog({
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
