"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type AdminMode = "setup" | "live";

const STORAGE_KEY = "live-echo:admin-mode";

// ── localStorage を外部ストアとして useSyncExternalStore に接続する ──────
// このリポジトリで localStorage を読むのはここが初めて。useState +
// useEffect で「マウント後に読んで setState」という素朴な実装も考えたが、
// react-hooks/set-state-in-effect に引っかかる（エフェクト内で直接
// setState するとカスケード再描画を招くという React 公式の指摘どおり）。
// useSyncExternalStore はまさにこの「外部の可変ステートを同期的に読む」
// ためのフックで、SSR 用の getServerSnapshot と実際の getSnapshot が
// 異なる場合、ハイドレーション後に React が自動で再描画してくれる
// （このためだけの追加コードは不要）。

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function handleStorageEvent(event: StorageEvent): void {
  // event.key === null は localStorage.clear()。どちらのときも読み直す。
  if (event.key === STORAGE_KEY || event.key === null) emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("storage", handleStorageEvent);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", handleStorageEvent);
    }
  };
}

function readStoredMode(): AdminMode | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "setup" || raw === "live" ? raw : null;
  } catch {
    // プライベートブラウズ等で localStorage が使えない環境でも描画は継続する。
    return null;
  }
}

/** SSR と、ハイドレーション時の最初のクライアント描画で使う値。未確定
 *  （null）を返し、Provider 側で defaultMode にフォールバックさせる。
 *  ハイドレーション完了後、React が readStoredMode() の実値と比較して
 *  異なれば自動的に再描画する（useSyncExternalStore 標準の挙動）。 */
function getServerSnapshot(): AdminMode | null {
  return null;
}

type AdminModeValue = {
  readonly mode: AdminMode;
  readonly setMode: (mode: AdminMode) => void;
};

const AdminModeContext = createContext<AdminModeValue | null>(null);

/**
 * 管理画面の「準備中／進行中」モード。危険な操作（設問の編集・削除・
 * インポート・全体リセット・全端末ログアウト・ブランド設定）を進行中は
 * 画面から隠し、本番進行中の操作者が見る・押せるものを最小限に絞る。
 *
 * サーバへは一切保存しない ── 純粋にこの端末だけの表示ガードレールで、
 * 認可・TOTP ステップアップはサーバ側 Server Action（app/admin/actions.ts /
 * lib/auth/admin.ts）が従来どおり担う。モードを "live" にしても危険な
 * 操作が実行できてしまうことはない（そもそもボタンが無い）が、逆に
 * "setup" にしたところで TOTP チェックが免除されるわけでもない。
 *
 * localStorage に保存し、端末をまたいでは共有しない。
 */
export function AdminModeProvider({
  defaultMode,
  children,
}: {
  /** localStorage に保存済みの値が無いときのフォールバック。
   *  呼び出し側（app/admin/page.tsx）がサーバの実態（出題中の設問が
   *  あるか）から算出して渡す。 */
  defaultMode: AdminMode;
  children: ReactNode;
}) {
  const stored = useSyncExternalStore(subscribe, readStoredMode, getServerSnapshot);
  const mode = stored ?? defaultMode;

  const value = useMemo<AdminModeValue>(
    () => ({
      mode,
      setMode(next) {
        try {
          window.localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // 保存できなくても、この場でのモード切替は emit() 経由で反映される。
          // 次回起動時は defaultMode に戻る。
        }
        emit();
      },
    }),
    [mode],
  );

  return (
    <AdminModeContext.Provider value={value}>{children}</AdminModeContext.Provider>
  );
}

export function useAdminMode(): AdminModeValue {
  const ctx = useContext(AdminModeContext);
  if (!ctx) throw new Error("useAdminMode must be used within AdminModeProvider");
  return ctx;
}
