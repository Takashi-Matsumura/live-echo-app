import type { MaterialsConfig } from "@/lib/types";

const MATERIALS_STORAGE_KEY = "materials";

/** DO ストレージから読んだ生データの型を検証する。lib/session/sanitize.ts
 *  と同じ考え方（想定外の形なら例外にせず null にして「無し」扱いにする）。
 *  https のみという制約も、永続データが何らかの経緯で書き換わっていた
 *  場合に備えてここで再検証する（唯一の入力経路は lib/materials/validate.ts
 *  だが、ストレージ層は自分自身でも不変条件を保証する）。 */
function isMaterialsConfig(value: unknown): value is MaterialsConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.url !== "string") return false;
  try {
    if (new URL(v.url).protocol !== "https:") return false;
  } catch {
    return false;
  }
  if (v.label !== null && typeof v.label !== "string") return false;
  if (v.gateQuestionId !== null && typeof v.gateQuestionId !== "string") return false;
  return true;
}

/**
 * 研修資料（Canva URL 等）の永続化。SessionState（"state" キー）とは独立
 * したストレージキーに保存する ── state は投票のたびに publish() で全接続
 * へ SSE 配信されるため、低頻度の設定値をそこに混ぜてはいけない
 * （lib/session/brand-storage.ts の BrandLogoStore と同じ判断）。
 * 読み書きの頻度も低いのでホットパス外に置く（lib/session/session-do.ts の
 * SessionDO から使う。DO 1インスタンスにつき1つ生成する）。
 */
export class MaterialsStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  async get(): Promise<MaterialsConfig | null> {
    const raw = await this.storage.get<unknown>(MATERIALS_STORAGE_KEY);
    return isMaterialsConfig(raw) ? raw : null;
  }

  async set(config: MaterialsConfig): Promise<void> {
    await this.storage.put(MATERIALS_STORAGE_KEY, config);
  }

  async clear(): Promise<void> {
    await this.storage.delete(MATERIALS_STORAGE_KEY);
  }
}
