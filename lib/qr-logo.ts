import { type QrLogo } from "@/lib/qr";
import { getBrandLogo } from "@/lib/session/service";

/**
 * 会社ロゴが登録されていれば、QR に埋め込む用の data URI に変換する。
 * サーバー側で自己完結させる（外部URL参照にすると、投影中に一瞬ロゴ抜けの
 * QR が出てしまうため）。nodejs_compat が有効なので Buffer が使える。
 *
 * components/qr-panel.tsx（参加用 QR）と app/api/materials/route.ts
 * （研修資料 QR）の両方から使う共通ヘルパー。
 */
export async function resolveQrLogo(): Promise<QrLogo | null> {
  const logo = await getBrandLogo();
  if (!logo) return null;
  const base64 = Buffer.from(logo.bytes).toString("base64");
  return { dataUri: `data:${logo.mime};base64,${base64}` };
}
