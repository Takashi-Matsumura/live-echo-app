"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertAdmin, attemptAdminLogin, clearAdminSession } from "@/lib/auth/admin";
import { validateLogoFile } from "@/lib/brand/validate";
import { renderQrSvg } from "@/lib/qr";
import { DEFAULT_TEXT_MAX_LENGTH, validateQuestionDraft } from "@/lib/questions";
import { MAX_IMPORT_BYTES, parseQuestionsImport } from "@/lib/questions/transfer";
import * as service from "@/lib/session/service";
import type { ChoiceDraft, QuestionDraft } from "@/lib/types";

export type LoginState = { error?: string; qrSvg?: string; manualSecret?: string };

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  const code = String(formData.get("code") ?? "");
  const result = await attemptAdminLogin(password, code);

  if (result.kind === "ok") {
    redirect("/admin");
  }
  if (result.kind === "totp-setup") {
    return {
      error: result.message ?? undefined,
      qrSvg: renderQrSvg(result.otpauthUri, null),
      manualSecret: result.manualSecret,
    };
  }
  return { error: result.message };
}

export async function logout(): Promise<void> {
  await clearAdminSession();
  redirect("/admin/login");
}

// ── 進行制御。すべて先頭で assertAdmin() を呼ぶ ─────────────────
// Proxy の matcher で保護しても Server Function は別ルート扱いになりうる
// ため、Proxy に頼らずここで直接チェックする。

export async function selectQuestion(questionId: string): Promise<void> {
  await assertAdmin();
  await service.selectQuestion(questionId);
}

export async function setPhase(phase: "open" | "closed"): Promise<void> {
  await assertAdmin();
  await service.setPhase(phase);
}

export async function setRevealed(revealed: boolean): Promise<void> {
  await assertAdmin();
  await service.setRevealed(revealed);
}

export async function hideAnswer(
  questionId: string,
  participantId: string,
): Promise<void> {
  await assertAdmin();
  await service.hideAnswer(questionId, participantId);
}

export async function unhideAnswer(
  questionId: string,
  participantId: string,
): Promise<void> {
  await assertAdmin();
  await service.unhideAnswer(questionId, participantId);
}

export async function resetQuestion(questionId: string): Promise<void> {
  await assertAdmin();
  await service.resetQuestion(questionId);
}

export async function resetAll(): Promise<void> {
  await assertAdmin();
  await service.resetAll();
}

// ── 設問の登録・編集・削除 ───────────────────────────────────

export type QuestionFormState = { error?: string };

/**
 * components/question-form.tsx が送る FormData を下書き（QuestionDraft）に
 * 組み立てる。ここでは型を揃えるだけで、内容の妥当性チェックは
 * lib/questions.ts の validateQuestionDraft() に委ねる。
 *
 * 選択肢は choiceId / choiceLabel を同じ順序で繰り返し送ってもらう
 * （FormData.getAll は DOM 順を保つ）。choiceId が空文字列の行は
 * 新規に追加された選択肢（フォーム側で id をまだ持たない）とみなす。
 */
function parseQuestionKind(formData: FormData): QuestionDraft["kind"] {
  const raw = formData.get("kind");
  if (raw === "multi") return "multi";
  if (raw === "text") return "text";
  return "choice";
}

function parseQuestionFormData(formData: FormData): QuestionDraft {
  const kind = parseQuestionKind(formData);
  const prompt = String(formData.get("prompt") ?? "");
  const note = String(formData.get("note") ?? "");

  const choiceIds = formData.getAll("choiceId").map((v) => String(v));
  const choiceLabels = formData.getAll("choiceLabel").map((v) => String(v));
  const choices: ChoiceDraft[] = choiceLabels.map((label, i) => ({
    id: choiceIds[i] && choiceIds[i].length > 0 ? choiceIds[i] : null,
    label,
  }));

  const placeholder = String(formData.get("placeholder") ?? "");
  const maxLengthRaw = formData.get("maxLength");
  const maxLength =
    typeof maxLengthRaw === "string" && maxLengthRaw.trim().length > 0
      ? Number(maxLengthRaw)
      : DEFAULT_TEXT_MAX_LENGTH;

  return { kind, prompt, note, choices, placeholder, maxLength };
}

export async function createQuestion(
  _prevState: QuestionFormState,
  formData: FormData,
): Promise<QuestionFormState> {
  await assertAdmin();
  const validated = validateQuestionDraft(parseQuestionFormData(formData));
  if (!validated.ok) return { error: validated.error };
  await service.createQuestion(validated.data);
  revalidatePath("/admin");
  return {};
}

/**
 * useActionState(updateQuestion.bind(null, questionId), {}) の形で使う
 * （Next.js 公式ドキュメント「Passing additional arguments」の標準パターン。
 * bind で束縛した残りの引数が (prevState, formData) になる）。
 */
export async function updateQuestion(
  questionId: string,
  _prevState: QuestionFormState,
  formData: FormData,
): Promise<QuestionFormState> {
  await assertAdmin();
  const validated = validateQuestionDraft(parseQuestionFormData(formData));
  if (!validated.ok) return { error: validated.error };
  const result = await service.updateQuestion(questionId, validated.data);
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin");
  return {};
}

export async function deleteQuestion(questionId: string): Promise<void> {
  await assertAdmin();
  await service.deleteQuestion(questionId);
  revalidatePath("/admin");
}

// ── 設問のインポート ─────────────────────────────────────────

export type QuestionImportState = { error?: string; imported?: number };

export async function importQuestions(
  _prevState: QuestionImportState,
  formData: FormData,
): Promise<QuestionImportState> {
  await assertAdmin();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "ファイルが選択されていません。" };
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return { error: "ファイルが大きすぎます。" };
  }

  const mode = formData.get("mode") === "replace" ? "replace" : "append";
  // クライアント側のチェックボックスだけに頼らず、置き換えの意思を
  // サーバー側でも確認する（フォームを直接組み立てて送られても安全に）。
  if (mode === "replace" && formData.get("confirmReplace") !== "1") {
    return { error: "置き換えの確認が取れませんでした。" };
  }

  const text = await file.text();
  const parsed = parseQuestionsImport(text);
  if (!parsed.ok) return { error: parsed.error };

  const result = await service.importQuestions(parsed.data, mode);
  if (!result.ok) return { error: result.error };

  revalidatePath("/admin");
  return { imported: result.imported };
}

// ── ブランド設定 ─────────────────────────────────────────────

export type BrandLogoState = { error?: string };

/** ロゴが出る全画面を再検証する */
function revalidateBrandSurfaces(): void {
  revalidatePath("/admin");
  revalidatePath("/present");
  revalidatePath("/");
}

export async function uploadBrandLogo(
  _prevState: BrandLogoState,
  formData: FormData,
): Promise<BrandLogoState> {
  await assertAdmin();

  const file = formData.get("logo");
  if (!(file instanceof File)) {
    return { error: "ファイルが選択されていません。" };
  }

  const validated = await validateLogoFile(file);
  if (!validated.ok) {
    return { error: validated.error };
  }

  await service.setBrandLogo(validated.bytes, validated.mime);
  revalidateBrandSurfaces();
  return {};
}

export async function removeBrandLogo(): Promise<void> {
  await assertAdmin();
  await service.clearBrandLogo();
  revalidateBrandSurfaces();
}
