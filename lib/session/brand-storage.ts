import type { BrandLogo, BrandLogoMeta, BrandLogoMime } from "@/lib/types";

const BRAND_LOGO_STORAGE_KEY = "brandLogo";
const VALID_LOGO_MIMES: readonly BrandLogoMime[] = ["image/png", "image/jpeg", "image/webp"];

/** DO ストレージから読んだ生データの型を検証する。lib/session/sanitize.ts
 *  と同じ考え方（想定外の形なら例外にせず null にして「無し」扱いにする）。 */
function isBrandLogo(value: unknown): value is BrandLogo {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.bytes instanceof Uint8Array &&
    typeof v.mime === "string" &&
    (VALID_LOGO_MIMES as readonly string[]).includes(v.mime) &&
    typeof v.updatedAt === "number"
  );
}

/**
 * ブランド設定（ロゴ）の永続化。SessionState（"state" キー）とは独立した
 * ストレージキーに保存する ── state は投票のたびに publish() で全接続へ
 * SSE 配信されるため、画像バイト列をそこに混ぜてはいけない。読み書きの
 * 頻度も低いのでホットパス外に置く（lib/session/session-do.ts の
 * SessionDO から使う。DO 1インスタンスにつき1つ生成する）。
 */
export class BrandLogoStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  async get(): Promise<BrandLogo | null> {
    const raw = await this.storage.get<unknown>(BRAND_LOGO_STORAGE_KEY);
    return isBrandLogo(raw) ? raw : null;
  }

  /** ヘッダー表示側は画像バイト列そのものは要らないので、軽量版を用意する。 */
  async getMeta(): Promise<BrandLogoMeta | null> {
    const logo = await this.get();
    if (!logo) return null;
    return { mime: logo.mime, updatedAt: logo.updatedAt };
  }

  async set(bytes: Uint8Array, mime: BrandLogoMime): Promise<void> {
    const logo: BrandLogo = { bytes, mime, updatedAt: Date.now() };
    await this.storage.put(BRAND_LOGO_STORAGE_KEY, logo);
  }

  async clear(): Promise<void> {
    await this.storage.delete(BRAND_LOGO_STORAGE_KEY);
  }
}
