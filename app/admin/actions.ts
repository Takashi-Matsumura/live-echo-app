"use server";

import { redirect } from "next/navigation";
import {
  assertAdmin,
  clearAdminSession,
  issueAdminSession,
  verifyPassword,
} from "@/lib/auth/admin";
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
  service.selectQuestion(questionId);
}

export async function goToAdjacentQuestion(dir: -1 | 1): Promise<void> {
  await assertAdmin();
  service.goToAdjacentQuestion(dir);
}

export async function setPhase(phase: "open" | "closed"): Promise<void> {
  await assertAdmin();
  service.setPhase(phase);
}

export async function setRevealed(revealed: boolean): Promise<void> {
  await assertAdmin();
  service.setRevealed(revealed);
}

export async function hideAnswer(
  questionId: string,
  participantId: string,
): Promise<void> {
  await assertAdmin();
  service.hideAnswer(questionId, participantId);
}

export async function unhideAnswer(
  questionId: string,
  participantId: string,
): Promise<void> {
  await assertAdmin();
  service.unhideAnswer(questionId, participantId);
}

export async function resetQuestion(questionId: string): Promise<void> {
  await assertAdmin();
  service.resetQuestion(questionId);
}

export async function resetAll(): Promise<void> {
  await assertAdmin();
  service.resetAll();
}
