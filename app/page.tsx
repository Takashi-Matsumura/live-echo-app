import type { Metadata } from "next";
import { BrandMark } from "@/components/brand-mark";
import { ConnectionPill } from "@/components/connection-pill";
import { LiveStateProvider } from "@/components/live-state-provider";
import { ParticipantScreen } from "@/components/participant-screen";
import { peekParticipantId } from "@/lib/auth/participant";
import { personalFor, snapshotFor } from "@/lib/session/service";

export const metadata: Metadata = {
  // ルートレイアウト（app/layout.tsx）の title.template はここには効かない
  // — layout.js の template は「子」route segment にしか適用されず、
  // 同じ "/" セグメントの page.js には適用されないという Next.js の仕様
  // （node_modules/next/dist/docs/.../generate-metadata.md に明記）。
  // なので他の画面と違い、ここだけ完全な文字列を直接書く。
  title: "参加者画面 | ライブアンケート",
};

export default async function Home() {
  // Server Component は Cookie を発行できないので読むだけ。初回訪問者は
  // null のまま「未回答」として描画し、実際の発行は GET /api/stream が行う。
  const participantId = await peekParticipantId();
  const state = await snapshotFor("participant");
  const you = participantId
    ? await personalFor(participantId)
    : { questionId: state.question?.id ?? null, myAnswer: null };

  return (
    <LiveStateProvider initialState={state} initialYou={you} view="participant">
      <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-black">
        {/* 未登録なら BrandMark が null を返すので分岐は不要。ParticipantScreen
            と同じ max-w-md に揃えて中央寄せする。 */}
        <div className="mx-auto flex w-full max-w-md items-center px-6 pt-6">
          <BrandMark size="sm" />
        </div>
        <ParticipantScreen />
      </div>
      <ConnectionPill />
    </LiveStateProvider>
  );
}
