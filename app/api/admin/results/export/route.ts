import { isAdmin, refreshAdminSession } from "@/lib/auth/admin";
import { toResultsCsv } from "@/lib/questions/results-export";
import { getQuestions, getRawState } from "@/lib/session/service";

/**
 * アンケート結果（生の回答データ）を CSV でダウンロードさせる。
 * app/api/admin/questions/export/route.ts（設問定義のエクスポート）と
 * 同じ「Server Action ではなく Route Handler」「isAdmin() での自前チェック」
 * パターン。あちらと違いこちらは回答という利用者データを含むため、CSV の
 * 先頭に UTF-8 BOM を付けて Excel（日本語ロケール）でも文字化けしないよう
 * にする。
 */
export async function GET() {
  if (!(await isAdmin())) {
    return new Response(null, { status: 401 });
  }
  await refreshAdminSession();

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

function formatDateStamp(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
