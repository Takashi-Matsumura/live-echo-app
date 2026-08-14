"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { login, type LoginState } from "@/app/admin/actions";

const initialState: LoginState = {};

/**
 * ★パスワード・コードの両方を controlled input にしている。React 19 は
 * <form action={fn}> の送信完了後、成功・失敗を問わず無条件で
 * form.reset() を実行する（uncontrolled input は値が消える。controlled
 * input は value prop への defaultValue 同期により実質無傷）。
 * ここを uncontrolled のままにすると、QR 表示後の2回目送信でパスワード欄が
 * 空になり初回登録フローが壊れる。
 */
export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const codeInputRef = useRef<HTMLInputElement>(null);

  // QR が表示されたら（= パスワードは通過済み）コード欄へフォーカスを移す。
  useEffect(() => {
    if (state.qrSvg) codeInputRef.current?.focus();
  }, [state.qrSvg]);

  return (
    <form action={formAction} className="flex w-full max-w-xs flex-col gap-4">
      <h1 className="text-xl font-semibold">管理画面ログイン</h1>
      <input
        type="password"
        name="password"
        placeholder="パスワード"
        autoFocus
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className="rounded-lg border border-black/10 bg-white px-4 py-3 outline-none focus:border-[var(--accent)] dark:border-white/15 dark:bg-white/5"
      />
      <input
        ref={codeInputRef}
        type="text"
        name="code"
        placeholder="認証コード（6桁）"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
        className="rounded-lg border border-black/10 bg-white px-4 py-3 tracking-widest outline-none focus:border-[var(--accent)] dark:border-white/15 dark:bg-white/5"
      />

      {state.qrSvg && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-black/10 p-4 dark:border-white/15">
          <p className="text-center text-sm text-black/60 dark:text-white/60">
            Authenticator アプリでこのQRコードを読み取り、表示された6桁のコードを入力してください
          </p>
          <div
            className="rounded-xl bg-white p-3 [&>svg]:h-56 [&>svg]:w-56"
            // svg はサーバー側（lib/qr.ts の renderQrSvg）で自前生成した文字列
            dangerouslySetInnerHTML={{ __html: state.qrSvg }}
          />
          {state.manualSecret && (
            <div className="flex flex-col items-center gap-1">
              <p className="text-xs text-black/40 dark:text-white/40">
                QRコードを読み取れない場合は、このコードを手動で入力してください
              </p>
              <p className="select-all break-all text-center font-mono text-sm">
                {state.manualSecret}
              </p>
            </div>
          )}
        </div>
      )}

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
