import { AdminConsole } from "@/components/admin-console";
import { LiveStateProvider } from "@/components/live-state-provider";
import { requireAdmin } from "@/lib/auth/admin";
import { deck } from "@/lib/questions";
import { snapshotFor } from "@/lib/session/service";

export default async function AdminPage() {
  await requireAdmin();
  const state = snapshotFor("admin");

  return (
    <LiveStateProvider
      initialState={state}
      initialYou={{ questionId: null, myAnswer: null }}
      view="admin"
    >
      <AdminConsole questions={deck.questions} />
    </LiveStateProvider>
  );
}
