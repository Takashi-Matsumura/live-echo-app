"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { importQuestions, type QuestionImportState } from "@/app/admin/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";

const initialState: QuestionImportState = {};

/**
 * 設問の一括インポートフォーム。components/admin-console.tsx から
 * <dialog> の中身として使う（components/question-form.tsx と同じ配置）。
 *
 * 「既存に追加」と「全て置き換え」をラジオで選べる。置き換えは選択肢を
 * 選んだだけでは実行させず、ConfirmDialog（components/confirm-dialog.tsx）
 * で二重に確認を取ってから送信する。
 */
export function QuestionImportForm({ onDone }: { onDone: () => void }) {
  const [state, formAction, pending] = useActionState(importQuestions, initialState);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const formRef = useRef<HTMLFormElement>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);

  // components/question-form.tsx と同じパターン: 送信中 → 送信完了 かつ
  // エラー無し、の遷移だけを検知してダイアログを閉じる。pending の
  // 立ち下がりで判定しないと、マウント直後に誤って閉じてしまう。
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      onDone();
    }
    wasPending.current = pending;
  }, [pending, state, onDone]);

  function handleSubmitClick() {
    // ファイル未選択・置き換えの同意チェック未入力のまま確認ダイアログが
    // 開くのを防ぐため、ネイティブ検証を先に走らせる。
    if (formRef.current?.reportValidity()) {
      confirmDialogRef.current?.showModal();
    }
  }

  return (
    <>
      <form ref={formRef} action={formAction} className="flex w-[28rem] max-w-[calc(100vw-2rem)] flex-col gap-4 p-5">
        <p className="font-medium">設問をインポート</p>

        <label className="flex flex-col gap-1 text-sm">
          エクスポートした JSON ファイル
          <input
            type="file"
            name="file"
            accept="application/json,.json"
            required
            className="text-sm file:mr-3 file:rounded-full file:border file:border-black/10 file:bg-transparent file:px-4 file:py-1.5 file:text-sm dark:file:border-white/15"
          />
        </label>

        <div className="flex flex-col gap-2" role="radiogroup" aria-label="取り込み方法">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              value="append"
              checked={mode === "append"}
              onChange={() => setMode("append")}
            />
            既存の設問に追加する
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              value="replace"
              checked={mode === "replace"}
              onChange={() => setMode("replace")}
            />
            既存の設問をすべて置き換える
          </label>
        </div>

        {mode === "replace" && (
          <div className="flex flex-col gap-2 rounded-lg border border-red-300 p-3 dark:border-red-900">
            <p className="text-sm text-red-600 dark:text-red-400">
              今ある設問と集まった回答はすべて破棄され、ファイルの内容だけになります。この操作は取り消せません。
            </p>
            <label className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <input type="checkbox" name="confirmReplace" value="1" required />
              内容を確認しました
            </label>
            {/* 破壊的操作なのでステップアップ認証（TOTP再入力）を要求する。
                app/admin/actions.ts の importQuestions 参照。 */}
            <label className="flex flex-col gap-1 text-sm text-red-600 dark:text-red-400">
              確認のため認証コード（6桁）を入力してください
              <input
                type="text"
                name="totpCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                className="rounded-lg border border-black/10 bg-white px-4 py-3 tracking-widest text-[var(--foreground)] outline-none focus:border-[var(--accent)] dark:border-white/15 dark:bg-white/5"
              />
            </label>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onDone}
            className="rounded-full border border-black/10 px-4 py-2 text-sm dark:border-white/15"
          >
            キャンセル
          </button>
          {mode === "replace" ? (
            <button
              type="button"
              disabled={pending}
              onClick={handleSubmitClick}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? "読み込み中…" : "読み込む"}
            </button>
          ) : (
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? "読み込み中…" : "読み込む"}
            </button>
          )}
        </div>

        {state.error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}
      </form>

      <ConfirmDialog
        dialogRef={confirmDialogRef}
        title="既存の設問をすべて置き換えますか？"
        description="今ある設問と集まった回答はすべて破棄されます。この操作は取り消せません。"
        confirmLabel="置き換える"
        pending={pending}
        onConfirm={() => formRef.current?.requestSubmit()}
      />
    </>
  );
}
