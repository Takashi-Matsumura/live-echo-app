import { requireAdminApi } from "@/lib/auth/admin";
import { formatDateStamp } from "@/lib/format";
import { toExportPayload } from "@/lib/questions/transfer";
import { getQuestions } from "@/lib/session/service";

/**
 * 設問定義（回答・出題中の状態・ブランドロゴは含まない）を JSON で
 * ダウンロードさせる。このリポジトリで初の「管理者専用 API route」。
 * Server Component の requireAdmin（redirect）も Server Action の
 * assertAdmin（throw）もファイルダウンロードの応答形には合わないため、
 * ここは requireAdminApi() で 401 を返す自前チェックにする。
 *
 * Content-Disposition を使いたいので Server Action（JSON 文字列を返して
 * クライアント側で Blob 化する方式）ではなく Route Handler にした。
 * app/api/brand/logo/route.ts と同じ「Response を直接組み立てる」パターン。
 */
export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const questions = await getQuestions();
  const now = new Date();
  const payload = toExportPayload(questions, now.toISOString());
  const body = JSON.stringify(payload, null, 2);

  const filename = `live-echo-questions-${formatDateStamp(now)}.json`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // ファイル名は ASCII に寄せ、RFC 5987 の filename* エンコードを
      // 持ち込まずに済ませる。日付を入れておくことで、複数回エクスポート
      // したファイルの取り違えを防ぐ。
      "Content-Disposition": `attachment; filename="${filename}"`,
      // 管理者だけが見られる内容なので、共有キャッシュに残さない。
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
