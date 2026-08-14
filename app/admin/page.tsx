import { AdminConsole } from "@/components/admin-console";
import { BrandMark } from "@/components/brand-mark";
import { BrandSettings } from "@/components/brand-settings";
import { LiveStateProvider } from "@/components/live-state-provider";
import { PhonePreview } from "@/components/phone-preview";
import { requireAdmin } from "@/lib/auth/admin";
import { deck } from "@/lib/questions";
import { getBrandLogoMeta, snapshotFor } from "@/lib/session/service";

export default async function AdminPage() {
  await requireAdmin();
  const [state, logoMeta] = await Promise.all([snapshotFor("admin"), getBrandLogoMeta()]);

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-6 py-10">
      {/* 未登録なら BrandMark 自体が null を返すので、ここでの分岐は不要 */}
      <BrandMark size="sm" />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-8">
          <LiveStateProvider
            initialState={state}
            initialYou={{ questionId: null, myAnswer: null }}
            view="admin"
          >
            <AdminConsole questions={deck.questions} />
          </LiveStateProvider>

          {/* ブランド設定はライブ状態と無関係なので LiveStateProvider の外に
              置く（下の PhonePreview と同じ判断）。ただし表示位置は
              AdminConsole の直下・同じ幅で構わないのでここに並べる。 */}
          <BrandSettings hasLogo={logoMeta !== null} preview={<BrandMark size="md" />} />
        </div>

        {/* 参加者プレビュー。LiveStateProvider の外に置くことで、admin 用に
            投影された state がここに渡る経路を構造的に無くしている。実体は
            "/" を iframe で埋め込んだもの（components/phone-preview.tsx）。 */}
        <aside className="hidden self-start lg:sticky lg:top-10 lg:block">
          <PhonePreview />
        </aside>
      </div>
    </div>
  );
}
