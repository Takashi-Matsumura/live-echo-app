import { requireAdminApi } from "@/lib/auth/admin";
import { formatDateStamp } from "@/lib/format";
import { toResultsCsv } from "@/lib/questions/results-export";
import { getQuestions, getRawState } from "@/lib/session/service";

/**
 * アンケート結果（生の回答データ）を CSV でダウンロードさせる。
 * app/api/admin/questions/export/route.ts（設問定義のエクスポート）と
 * 同じ「Server Action ではなく Route Handler」「requireAdminApi() での
 * 自前チェック」パターン。あちらと違いこちらは回答という利用者データを
 * 含むため、CSV の先頭に UTF-8 BOM を付けて Excel（日本語ロケール）でも
 * 文字化けしないようにする。
 */
export async function GET() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const [questions, state] = await Promise.all([getQuestions(), getRawState()]);
  const csv = toResultsCsv(questions, state);
  const now = new Date();

  const filename = `live-echo-results-${formatDateStamp(now)}.csv`;

  return new Response("\uFEFF" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
