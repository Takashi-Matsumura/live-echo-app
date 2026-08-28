"use client";

import { useState, type ReactNode } from "react";
import { useAdminMode } from "@/components/admin-mode";

type Tab = "questions" | "brand";

const TABS: { id: Tab; label: string }[] = [
  { id: "questions", label: "設問一覧" },
  { id: "brand", label: "ブランド設定" },
];

/**
 * 「設問一覧」と「ブランド設定」のタブ切り替え。
 *
 * ★両パネルは常にマウントしたまま hidden 属性で見た目だけ切り替える
 * （条件付きレンダーで questionsPanel をアンマウントしない）。questionsPanel
 * の中身は LiveStateProvider を含み、そのクリーンアップは EventSource を
 * close する（components/live-state-provider.tsx）。タブ切り替えのたびに
 * アンマウント/再マウントすると SSE が毎回切れて張り直しになり、進行中の
 * ライブ更新が一瞬止まる・DO の subscribers が無駄に出入りする。
 *
 * タブパネルの <div> 自体には flex/grid 等の display ユーティリティを付けない
 * — [hidden]{display:none} という UA 既定スタイルとの特異性衝突を避けるため。
 * 必要なレイアウトは questionsPanel/brandPanel（中身）側で組む。
 *
 * 呼び出し側は qr-panel.tsx を present-screen.tsx に渡すのと同じ
 * server-in-client の受け渡しパターンで questionsPanel/brandPanel を渡す
 * （app/admin/page.tsx 参照）。
 *
 * ★スクロール領域はここ（タブ本体の下）だけに区切る。タブの切り替えボタン
 * 自体は shrink-0 で常に見える位置に固定し、パネルの中身だけが
 * min-h-0 + overflow-y-auto で縦スクロールする。呼び出し元（app/admin/page.tsx）
 * がページ全体の高さを viewport に固定している前提。
 *
 * ★「ブランド設定」タブは進行中モードでは非表示にする（本番進行中に
 * ロゴの差し替え・削除に迷い込ませない）。進行中モードに切り替えた瞬間に
 * ブランド設定タブを見ていた場合は、空にならないよう設問一覧タブとして
 * 描画する。tab state 自体は「ブランド設定を最後に選んでいた」ことを
 * 覚えたままにし（準備中に戻せば復元される）、表示にだけ effectiveTab
 * という派生値をかませる ── useEffect + setState でモード変化のたびに
 * tab を書き換えると react-hooks/set-state-in-effect に引っかかるため。
 */
export function AdminTabs({
  questionsPanel,
  brandPanel,
}: {
  questionsPanel: ReactNode;
  brandPanel: ReactNode;
}) {
  const { mode } = useAdminMode();
  const [tab, setTab] = useState<Tab>("questions");
  const visibleTabs = mode === "live" ? TABS.filter((t) => t.id === "questions") : TABS;
  const effectiveTab: Tab = mode === "live" && tab === "brand" ? "questions" : tab;
  const panels: Record<Tab, ReactNode> = { questions: questionsPanel, brand: brandPanel };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div
        role="tablist"
        aria-label="管理メニュー"
        className="flex shrink-0 gap-6 border-b border-black/10 dark:border-white/15"
      >
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`admin-tab-${t.id}`}
            aria-selected={effectiveTab === t.id}
            aria-controls={`admin-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-1 pb-3 text-sm font-medium ${
              effectiveTab === t.id
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-black/50 dark:text-white/50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {TABS.map((t) => (
          <div
            key={t.id}
            id={`admin-panel-${t.id}`}
            role="tabpanel"
            aria-labelledby={`admin-tab-${t.id}`}
            hidden={effectiveTab !== t.id}
          >
            {panels[t.id]}
          </div>
        ))}
      </div>
    </div>
  );
}
