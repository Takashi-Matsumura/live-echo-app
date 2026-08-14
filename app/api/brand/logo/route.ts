import { getBrandLogo } from "@/lib/session/service";

/**
 * 会社ロゴの画像本体を配信する。参加者・管理・投影のいずれの画面ヘッダーも
 * ここを <img src> で参照する（公開情報のため認証は不要）。
 * QR コード中央への埋め込みはこれとは別経路 —
 * components/qr-panel.tsx がサーバー側で data URI 化して SVG に直接
 * 焼き込む（投影中に外部リクエストの遅延でロゴ抜けの一瞬が出ないため）。
 */
export async function GET(request: Request) {
  const logo = await getBrandLogo();
  if (!logo) {
    return new Response(null, { status: 404 });
  }

  const etag = `"${logo.updatedAt}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  // Uint8Array をそのまま Response / Blob に渡すと、DOM の型定義が
  // ArrayBuffer 限定である一方 @types/node は ArrayBufferLike（＝
  // SharedArrayBuffer も含みうる）を返すため型がずれる。このアプリでは
  // SharedArrayBuffer を扱う経路が無い（DO storage からの構造化クローンと
  // File.arrayBuffer() の結果のみ）ので、ここでの型アサーションは安全。
  return new Response(new Blob([logo.bytes as BlobPart], { type: logo.mime }), {
    headers: {
      "Content-Type": logo.mime,
      "Content-Length": String(logo.bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      ETag: etag,
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
