"use client";

import { useRef, useTransition } from "react";
import { revokeAllSessions } from "@/app/admin/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * Cookie の盗難に気づいたときの緊急停止ボタン。DO 側の管理者セッション
 * 世代番号を進め、この端末を含む発行済みの le_admin Cookie を全部無効に
 * する（lib/auth/admin.ts の revokeAllAdminSessions）。SESSION_SECRET の
 * ローテーション（再デプロイが要る）より即効性のある手段として用意した。
 */
export function RevokeSessionsButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="text-sm text-red-600 underline dark:text-red-400"
      >
        全端末ログアウト
      </button>
      <ConfirmDialog
        dialogRef={dialogRef}
        title="すべての端末からログアウトしますか？"
        description="この端末を含め、ログイン中のセッションがすべて無効になります。次回は改めてパスワードと認証コードでのログインが必要です。"
        confirmLabel="ログアウトする"
        pending={pending}
        onConfirm={() => startTransition(async () => { await revokeAllSessions(); })}
      />
    </>
  );
}
