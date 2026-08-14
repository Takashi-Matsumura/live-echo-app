"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  assertAdmin,
  clearAdminSession,
  issueAdminSession,
  verifyPassword,
} from "@/lib/auth/admin";
import { validateLogoFile } from "@/lib/brand/validate";
import * as service from "@/lib/session/service";

export type LoginState = { error?: string };

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  const ok = await verifyPassword(password);
  if (!ok) {
    return {
      error: "パスワードが違うか、試行回数の上限に達しました。しばらくしてから再度お試しください。",
    };
  }
  await issueAdminSession();
  redirect("/admin");
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
