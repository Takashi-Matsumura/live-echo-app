import { deck as rawDeck } from "@/content/questions";
import type { Deck, Question } from "@/lib/types";

export const DEFAULT_TEXT_MAX_LENGTH = 140;

/**
 * content/questions.ts をロードし、起動時に整合性を検証する。
 * - id の重複
 * - choice 設問の選択肢が空、choice id の重複
 * - text 設問の maxLength 未指定時は既定値を補完
 *
 * ここで例外を投げるのは意図的。設問定義が壊れたまま起動してしまう方が
 * 当日の事故として遥かに重い。
 */
function buildDeck(source: Deck): Deck {
  const seenQuestionIds = new Set<string>();
  const questions: Question[] = source.questions.map((q) => {
    if (seenQuestionIds.has(q.id)) {
      throw new Error(`questions.ts: 設問 id が重複しています: "${q.id}"`);
    }
    seenQuestionIds.add(q.id);

    if (q.kind === "choice") {
      if (q.choices.length === 0) {
        throw new Error(`questions.ts: 設問 "${q.id}" の choices が空です`);
      }
      const seenChoiceIds = new Set<string>();
      for (const c of q.choices) {
        if (seenChoiceIds.has(c.id)) {
          throw new Error(
            `questions.ts: 設問 "${q.id}" 内で選択肢 id が重複しています: "${c.id}"`,
          );
        }
        seenChoiceIds.add(c.id);
      }
      return q;
    }

    // text
    return {
      ...q,
      maxLength: q.maxLength ?? DEFAULT_TEXT_MAX_LENGTH,
    };
  });

  if (questions.length === 0) {
    throw new Error("questions.ts: 設問が1つもありません");
  }

  return { title: source.title, questions };
}

export const deck: Deck = buildDeck(rawDeck);

const byId = new Map<string, Question>(deck.questions.map((q) => [q.id, q]));

export function getQuestionById(id: string): Question | undefined {
  return byId.get(id);
}

export function getQuestionIndex(id: string): number {
  return deck.questions.findIndex((q) => q.id === id);
}

export function getFirstQuestionId(): string {
  return deck.questions[0].id;
}

export function getAdjacentQuestionId(
  currentId: string | null,
  dir: -1 | 1,
): string | null {
  if (currentId === null) {
    return dir === 1 ? deck.questions[0].id : null;
  }
  const idx = getQuestionIndex(currentId);
  if (idx === -1) return deck.questions[0].id;
  const nextIdx = idx + dir;
  if (nextIdx < 0 || nextIdx >= deck.questions.length) return null;
  return deck.questions[nextIdx].id;
}

/** choice 設問で choiceId が実在するか */
export function isValidChoiceId(question: Question, choiceId: string): boolean {
  return question.kind === "choice" && question.choices.some((c) => c.id === choiceId);
}
