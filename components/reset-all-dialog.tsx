"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { resetAll, type ResetAllState } from "@/app/admin/actions";

const initialState: ResetAllState = {};

/**
 * 「全体をリセット」の確認＋ステップアップ認証（TOTP再入力）フォーム。
 * components/question-import-form.tsx と同じ構造:
 * 外側の <dialog> は components/admin-console.tsx 側が持ち、開閉のたびに
 * このコンポーネント自体をマウント/アンマウントして内部 state
 * （入力途中のコード）をまっさらに戻す。
 */
export function ResetAllDialog({ onDone }: { onDone: () => void }) {
  const [state, formAction, pending] = useActionState(resetAll, initialState);
  const [code, setCode] = useState("");

  // components/question-import-form.tsx と同じパターン: 送信中 → 送信完了
  // かつエラー無し、の遷移だけを検知してダイアログを閉じる。
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      onDone();
    }
    wasPending.current = pending;
  }, [pending, state, onDone]);

  return (
    <form action={formAction} className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-4 p-5">
      <p className="font-medium">全体をリセットしますか？</p>
      <p className="text-sm text-black/50 dark:text-white/50">
        すべての設問の回答と結果公開の状態が消え、最初の状態に戻ります。この操作は取り消せません。
      </p>
      <label className="flex flex-col gap-1 text-sm text-red-600 dark:text-red-400">
        確認のため認証コード（6桁）を入力してください
        <input
          type="text"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          className="rounded-lg border border-black/10 bg-white px-4 py-3 tracking-widest text-[var(--foreground)] outline-none focus:border-[var(--accent)] dark:border-white/15 dark:bg-white/5"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-full border border-black/10 px-4 py-2 text-sm dark:border-white/15"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "実行中…" : "リセットする"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}
