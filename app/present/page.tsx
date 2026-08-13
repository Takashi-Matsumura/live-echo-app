import { LiveStateProvider } from "@/components/live-state-provider";
import { PresentScreen } from "@/components/present-screen";
import { QrPanel } from "@/components/qr-panel";
import { requireAdmin } from "@/lib/auth/admin";
import { snapshotFor } from "@/lib/session/service";

export default async function PresentPage() {
  // プロジェクタに映す画面。参加者と同じ結果開示ゲートを通すが、締切前の
  // 生集計を講師が確認できるよう role は admin 扱いにする（/admin と同様）。
  await requireAdmin();
  const state = snapshotFor("admin");

  return (
    <LiveStateProvider
      initialState={state}
      initialYou={{ questionId: null, myAnswer: null }}
      view="admin"
    >
      <PresentScreen qrPanel={<QrPanel />} />
    </LiveStateProvider>
  );
}
