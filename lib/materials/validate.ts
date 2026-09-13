import type { MaterialsConfig, Question } from "@/lib/types";

/** QR の密度が上がりすぎると投影距離から読み取れなくなる実利上の理由も
 *  兼ねた上限。Canva の共有 URL は通常 100 文字程度に収まる。 */
const MAX_URL_LENGTH = 2048;
const MAX_LABEL_LENGTH = 60;

export type MaterialsValidationResult =
  | { readonly ok: true; readonly data: MaterialsConfig }
  | { readonly ok: false; readonly error: string };

/**
 * 管理画面「資料設定」フォームの入力を検証する。
 * ・URL は https のみ許可する ── javascript: / data: を <a href> と
 *   QR コードの両方から構造的に排除するため（表示側は検証済みの値しか
 *   扱わない前提で dangerouslySetInnerHTML や href に直接使う）。
 * ・Canva ドメインへの限定はあえてしない ── 将来 Google Drive 等の別サービスに
 *   差し替わる可能性があるため。ドメインを絞りたくなったら、ここに
 *   allowlist を足せばよい。
 */
export function validateMaterialsInput(
  rawUrl: string,
  rawLabel: string,
  rawGateQuestionId: string,
  questions: readonly Question[],
): MaterialsValidationResult {
  const url = rawUrl.trim();
  if (url.length === 0) {
    return { ok: false, error: "URLを入力してください。" };
  }
  if (url.length > MAX_URL_LENGTH) {
    return { ok: false, error: "URLが長すぎます。" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "URLの形式が正しくありません。" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "URLは https:// で始まる必要があります。" };
  }

  const labelTrimmed = rawLabel.trim().replace(/[\r\n]+/g, " ");
  if (labelTrimmed.length > MAX_LABEL_LENGTH) {
    return {
      ok: false,
      error: `見出しが長すぎます（最大 ${MAX_LABEL_LENGTH} 文字）。`,
    };
  }
  const label = labelTrimmed.length > 0 ? labelTrimmed : null;

  const gateQuestionId = rawGateQuestionId.trim();
  if (gateQuestionId.length > 0 && !questions.some((q) => q.id === gateQuestionId)) {
    return { ok: false, error: "指定された設問が見つかりません。" };
  }

  return {
    ok: true,
    data: {
      url,
      label,
      gateQuestionId: gateQuestionId.length > 0 ? gateQuestionId : null,
    },
  };
}
