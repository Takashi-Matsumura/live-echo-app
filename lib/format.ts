/** `YYYYMMDD`（UTC基準）。エクスポートファイル名に日付を入れて、複数回
 *  エクスポートしたファイルの取り違えを防ぐために使う
 *  （app/api/admin/questions/export/route.ts, app/api/admin/results/export/route.ts）。 */
export function formatDateStamp(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
