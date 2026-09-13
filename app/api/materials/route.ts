import { isAdmin, resolveRole } from "@/lib/auth/admin";
import { getOrCreateParticipantId } from "@/lib/auth/participant";
import { renderQrSvg } from "@/lib/qr";
import { resolveQrLogo } from "@/lib/qr-logo";
import { getMaterialsFor } from "@/lib/session/service";

/**
 * 研修資料（Canva URL 等）の取得専用（components/use-materials.ts）。
 * PublicState.materialsRevealed は「講師が全員に公開したか」という
 * boolean だけを配り、実際の URL はここでしか渡さない。
 *
 * ★アクセス制御はここではなく lib/session/projection.ts の
 * materialsFor 側にある ── 講師が全体公開しておらず、かつ本人が
 * gateQuestionId の設問に回答していなければ null を返し、この route は
 * 404 にする（app/api/results/route.ts と同じ構図）。
 */
export async function GET(request: Request) {
  const participantId = await getOrCreateParticipantId();
  const actuallyAdmin = await isAdmin();
  const role = resolveRole(request, actuallyAdmin);

  const config = await getMaterialsFor(participantId, role);
  if (!config) {
    return new Response(null, { status: 404 });
  }

  const qrSvg = renderQrSvg(config.url, await resolveQrLogo());

  return Response.json(
    { url: config.url, label: config.label, qrSvg },
    { headers: { "Cache-Control": "no-store" } },
  );
}
