"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { revokeAllSessions } from "@/app/admin/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LogoutIcon } from "@/components/icons";

async function fetchConnectionCount(): Promise<number | null> {
  try {
    const res = await fetch("/api/admin/connections", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { count: number };
    return data.count;
  } catch {
    return null;
  }
}

/**
 * Cookie の盗難に気づいたときの緊急停止ボタン。DO 側の管理者セッション
 * 世代番号を進め、この端末を含む発行済みの le_admin Cookie を全部無効に
 * する（lib/auth/admin.ts の revokeAllAdminSessions）。SESSION_SECRET の
 * ローテーション（再デプロイが要る）より即効性のある手段として用意した。
 *
 * ★配置は components/admin-console.tsx の「危険な操作」ブロック（準備中
 * モード限定）。かつてはヘッダの「ログアウト」の隣に置いていたが、
 * ラベルが1単語しか違わず押し間違いの導線になっていたため移設した。
 *
 * ★ラベルの接続数は目安であって正確な端末数ではない（投影画面を含む・
 * 同一端末の複数タブは別々に数える・Cookie有効なまま閉じたタブは含まれ
 * ない）。詳細は lib/session/session-do.ts の getAdminConnectionCount()。
 * マウント時に一度取得し、ボタンを押して確認ダイアログを開く瞬間（＝
 * 実際に判断する瞬間）にも取り直して鮮度を保つ。
 */
export function RevokeSessionsButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    void fetchConnectionCount().then(setCount);
  }, []);

  function openDialog() {
    dialogRef.current?.showModal();
    void fetchConnectionCount().then(setCount);
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex items-center gap-2 rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-600 dark:border-red-900 dark:text-red-400"
      >
        <LogoutIcon />
        {count !== null ? `全端末ログアウト（現在接続中: ${count}画面）` : "全端末ログアウト"}
      </button>
      <ConfirmDialog
        dialogRef={dialogRef}
        title="すべての端末からログアウトしますか？"
        description={
          count !== null
            ? `この端末を含め、現在接続中の${count}画面（投影画面・複数タブを含む目安）がすべて無効になります。次回は改めてパスワードと認証コードでのログインが必要です。`
            : "この端末を含め、ログイン中のセッションがすべて無効になります。次回は改めてパスワードと認証コードでのログインが必要です。"
        }
        confirmLabel="ログアウトする"
        pending={pending}
        onConfirm={() => startTransition(async () => { await revokeAllSessions(); })}
      />
    </>
  );
}
