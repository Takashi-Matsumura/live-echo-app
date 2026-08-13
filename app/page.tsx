import { ConnectionPill } from "@/components/connection-pill";
import { LiveStateProvider } from "@/components/live-state-provider";
import { ParticipantScreen } from "@/components/participant-screen";
import { peekParticipantId } from "@/lib/auth/participant";
import { personalFor, snapshotFor } from "@/lib/session/service";

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
        <ParticipantScreen />
      </div>
      <ConnectionPill />
    </LiveStateProvider>
  );
}
