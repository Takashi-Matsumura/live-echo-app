import { getSessionStub } from "@/lib/session/stub";
import type {
  BrandLogo,
  BrandLogoMeta,
  BrandLogoMime,
  Phase,
  PersonalState,
  PublicResults,
  PublicState,
  Question,
  Role,
  SessionState,
  ValidatedQuestionData,
  VoteResult,
} from "@/lib/types";

/**
 * ★状態変更ロジック・購読者管理はすべて lib/session/session-do.ts
 * （Durable Object）に移した。このファイルは Next.js の Server
 * Actions / Route Handler / Server Component から見た薄い RPC
 * クライアントに過ぎない。
 */

export async function snapshotFor(role: Role): Promise<PublicState> {
  const stub = await getSessionStub();
  return stub.snapshot(role);
}

export async function personalFor(participantId: string): Promise<PersonalState> {
  const stub = await getSessionStub();
  return stub.personal(participantId);
}

export async function getResultsFor(
  questionId: string,
  role: Role,
): Promise<{ readonly question: Question; readonly results: PublicResults } | null> {
  const stub = await getSessionStub();
  return stub.getResultsFor(questionId, role);
}

export async function getRawState(): Promise<SessionState> {
  const stub = await getSessionStub();
  return stub.getRawState();
}

export async function getAdminConnectionCount(): Promise<number> {
  const stub = await getSessionStub();
  return stub.getAdminConnectionCount();
}

export async function openEventStream(
  role: Role,
  participantId: string,
): Promise<ReadableStream<Uint8Array>> {
  const stub = await getSessionStub();
  return stub.openEventStream(role, participantId);
}

export async function castVote(
  participantId: string,
  questionId: string,
  rawAnswers: readonly string[],
): Promise<VoteResult> {
  const stub = await getSessionStub();
  return stub.castVote(participantId, questionId, rawAnswers);
}

export async function selectQuestion(questionId: string): Promise<void> {
  const stub = await getSessionStub();
  return stub.selectQuestion(questionId);
}

export async function setPhase(phase: Phase): Promise<void> {
  const stub = await getSessionStub();
  return stub.setPhase(phase);
}

export async function setRevealed(revealed: boolean): Promise<void> {
  const stub = await getSessionStub();
  return stub.setRevealed(revealed);
}

export async function setPresentQuestion(questionId: string | null): Promise<void> {
  const stub = await getSessionStub();
  return stub.setPresentQuestion(questionId);
}

export async function hideAnswer(questionId: string, participantId: string): Promise<void> {
  const stub = await getSessionStub();
  return stub.hideAnswer(questionId, participantId);
}

export async function unhideAnswer(questionId: string, participantId: string): Promise<void> {
  const stub = await getSessionStub();
  return stub.unhideAnswer(questionId, participantId);
}

export async function resetQuestion(questionId: string): Promise<void> {
  const stub = await getSessionStub();
  return stub.resetQuestion(questionId);
}

export async function resetAll(): Promise<void> {
  const stub = await getSessionStub();
  return stub.resetAll();
}

export async function getQuestions(): Promise<readonly Question[]> {
  const stub = await getSessionStub();
  return stub.getQuestions();
}

export async function createQuestion(data: ValidatedQuestionData): Promise<Question> {
  const stub = await getSessionStub();
  return stub.createQuestion(data);
}

export async function updateQuestion(
  questionId: string,
  data: ValidatedQuestionData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const stub = await getSessionStub();
  return stub.updateQuestion(questionId, data);
}

export async function deleteQuestion(questionId: string): Promise<void> {
  const stub = await getSessionStub();
  return stub.deleteQuestion(questionId);
}

export async function importQuestions(
  items: readonly ValidatedQuestionData[],
  mode: "append" | "replace",
): Promise<{ ok: true; imported: number } | { ok: false; error: string }> {
  const stub = await getSessionStub();
  return stub.importQuestions(items, mode);
}

export async function getBrandLogo(): Promise<BrandLogo | null> {
  const stub = await getSessionStub();
  return stub.getBrandLogo();
}

export async function getBrandLogoMeta(): Promise<BrandLogoMeta | null> {
  const stub = await getSessionStub();
  return stub.getBrandLogoMeta();
}

export async function setBrandLogo(bytes: Uint8Array, mime: BrandLogoMime): Promise<void> {
  const stub = await getSessionStub();
  return stub.setBrandLogo(bytes, mime);
}

export async function clearBrandLogo(): Promise<void> {
  const stub = await getSessionStub();
  return stub.clearBrandLogo();
}
