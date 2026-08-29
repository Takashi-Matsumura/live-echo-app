import type { BrandLogoMime } from "@/lib/types";

/**
 * 管理画面からのロゴアップロードに許可する最大サイズ。
 * Durable Object storage の1値あたり上限（KV バックエンドで 128 KiB）を
 * 踏まえ、SQLite バックエンドであっても安全な値として余裕を持たせてある。
 * ロゴ用途にも十分（256〜512px の PNG は通常 20〜60KB 程度）。
 */
export const MAX_LOGO_BYTES = 96 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, i) => bytes[i] === byte);
}

function isWebp(bytes: Uint8Array): boolean {
  // RIFF <4バイトのチャンクサイズ> WEBP という構造。
  if (bytes.length < 12) return false;
  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  const webp = String.fromCharCode(...bytes.subarray(8, 12));
  return riff === "RIFF" && webp === "WEBP";
}

/**
 * バイト列の先頭（マジックバイト）から MIME を判定する。
 * File.type やファイル名の拡張子はクライアントが自由に偽装できるため
 * 信用しない — 中身を見て判定する。
 * SVG はここでは判定しない（スクリプトを含みうるため意図的に非対応）。
 */
function sniffImageMime(bytes: Uint8Array): BrandLogoMime | null {
  if (startsWith(bytes, PNG_MAGIC)) return "image/png";
  if (startsWith(bytes, JPEG_MAGIC)) return "image/jpeg";
  if (isWebp(bytes)) return "image/webp";
  return null;
}

export type LogoValidationResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly mime: BrandLogoMime }
  | { readonly ok: false; readonly error: string };

/** アップロードされた File をサイズ・中身の両面から検証する。 */
export async function validateLogoFile(file: File): Promise<LogoValidationResult> {
  if (file.size === 0) {
    return { ok: false, error: "ファイルが選択されていません。" };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return {
      ok: false,
      error: `ファイルサイズが大きすぎます（最大 ${Math.floor(MAX_LOGO_BYTES / 1024)}KB）。`,
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImageMime(bytes);
  if (!mime) {
    return {
      ok: false,
      error: "PNG / JPEG / WebP のいずれかの画像ファイルを選択してください。",
    };
  }
  return { ok: true, bytes, mime };
}
