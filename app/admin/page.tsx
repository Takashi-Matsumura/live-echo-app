import type { Metadata } from "next";
import Link from "next/link";
import { logout } from "@/app/admin/actions";
import { AdminConsole } from "@/components/admin-console";
import { AdminTabs } from "@/components/admin-tabs";
import { BrandMark } from "@/components/brand-mark";
import { BrandSettings } from "@/components/brand-settings";
import { LiveStateProvider } from "@/components/live-state-provider";
import { PhonePreview } from "@/components/phone-preview";
import { RevokeSessionsButton } from "@/components/revoke-sessions-button";
import { requireAdmin } from "@/lib/auth/admin";
import { getBrandLogoMeta, getQuestions, snapshotFor } from "@/lib/session/service";

export const metadata: Metadata = {
  title: "管理画面",
};

export default async function AdminPage() {
  await requireAdmin();
  const [state, logoMeta, questions] = await Promise.all([
    snapshotFor("admin"),
    getBrandLogoMeta(),
    getQuestions(),
  ]);

  return (
    // ★ページ全体は縦スクロールさせない（h-dvh + overflow-hidden）。スクロール
    // させたいのは左側の設問一覧パネルだけで、右側のスマホプレビューは常に
    // 画面内に固定表示する。スクロール領域は AdminTabs 側（タブ本体の下）で
    // min-h-0 + overflow-y-auto として区切る。
    <div className="mx-auto flex h-dvh w-full max-w-[1600px] flex-col gap-6 overflow-hidden px-6 py-10">
      {/* 未登録なら BrandMark 自体が null を返すので、ここでの分岐は不要 */}
      <BrandMark size="sm" />

      <div className="grid min-h-0 flex-1 gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
        {/* max-w を付けずグリッドトラック（1fr）の幅いっぱいまで広げる。
            右のスマホプレビューとの間に余白ができないよう、余った横幅は
            設問一覧側で使い切る。 */}
        <div className="flex min-h-0 min-w-0 flex-col gap-6">
          {/* タブ切り替えに関係なく常時表示する操作。QRコード表示・ログアウト
              はどちらのタブを見ていても必要なので、タブの外に置く。
              スクロール領域の外なので、下の一覧をどれだけスクロールしても
              常に見える。 */}
          <header className="flex shrink-0 items-center justify-between gap-3">
            <h1 className="text-xl font-semibold">管理画面</h1>
            <div className="flex items-center gap-4">
              <Link
                href="/present"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-black/10 px-4 py-1.5 text-sm dark:border-white/15"
              >
                QRコードを表示 ↗
              </Link>
              <RevokeSessionsButton />
              <form action={logout}>
                <button
                  type="submit"
                  className="text-sm text-black/50 underline dark:text-white/50"
                >
                  ログアウト
                </button>
              </form>
            </div>
          </header>

          <AdminTabs
            questionsPanel={
              <LiveStateProvider
                initialState={state}
                initialYou={{ questionId: null, myAnswer: null }}
                view="admin"
              >
                <AdminConsole questions={questions} />
              </LiveStateProvider>
            }
            brandPanel={
              <BrandSettings hasLogo={logoMeta !== null} preview={<BrandMark size="md" />} />
            }
          />
        </div>

        {/* 参加者プレビュー。LiveStateProvider の外に置くことで、admin 用に
            投影された state がここに渡る経路を構造的に無くしている。実体は
            "/" を iframe で埋め込んだもの（components/phone-preview.tsx）。
            ページ自体がスクロールしないため sticky は不要 — 常に固定表示になる。 */}
        <aside className="hidden self-start lg:block">
          <PhonePreview />
        </aside>
      </div>
    </div>
  );
}
