"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/admin/actions";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="flex w-full max-w-xs flex-col gap-4">
      <h1 className="text-xl font-semibold">管理画面ログイン</h1>
      <input
        type="password"
        name="password"
        placeholder="パスワード"
        autoFocus
        required
        className="rounded-lg border border-black/10 bg-white px-4 py-3 outline-none focus:border-[var(--accent)] dark:border-white/15 dark:bg-white/5"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-[var(--accent)] px-6 py-3 font-medium text-white disabled:opacity-50"
      >
        {pending ? "ログイン中…" : "ログイン"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}
