import { AdminConsole } from "@/components/admin-console";
import { LiveStateProvider } from "@/components/live-state-provider";
import { PhonePreview } from "@/components/phone-preview";
import { requireAdmin } from "@/lib/auth/admin";
import { deck } from "@/lib/questions";
import { snapshotFor } from "@/lib/session/service";

export default async function AdminPage() {
  await requireAdmin();
  const state = await snapshotFor("admin");

  return (
    <div className="mx-auto grid w-full max-w-[1600px] gap-8 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_auto]">
      <LiveStateProvider
        initialState={state}
        initialYou={{ questionId: null, myAnswer: null }}
        view="admin"
      >
        <AdminConsole questions={deck.questions} />
      </LiveStateProvider>

      {/* 参加者プレビュー。LiveStateProvider の外に置くことで、admin 用に
          投影された state がここに渡る経路を構造的に無くしている。実体は
          "/" を iframe で埋め込んだもの（components/phone-preview.tsx）。 */}
      <aside className="hidden self-start lg:sticky lg:top-10 lg:block">
        <PhonePreview />
      </aside>
    </div>
  );
}
