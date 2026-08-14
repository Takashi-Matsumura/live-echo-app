import { deck as rawSeedDeck } from "@/content/questions";
import { DEFAULT_TEXT_MAX_LENGTH } from "@/lib/questions";
import type { Question } from "@/lib/types";

/**
 * content/questions.ts の内容を「初回起動時（まだ一度も管理画面で
 * 設問を編集していない Durable Object）の初期設問」として検証する。
 *
 * ★このファイルはサーバー専用。DO のコンストラクタ
 * （lib/session/session-do.ts）からのみ import される。lib/questions.ts
 * 本体は副作用を持たない純粋関数の集まりにしたいので、
 * content/questions.ts への依存はここに閉じ込めてある。
 *
 * 例外を投げるのは意図的（buildDeck の頃と同じ判断）: ここで検証に
 * 失敗するのは「手書きの設定ファイルが壊れている」場合だけで、
 * 管理者の入力ミスではない。壊れた設定のまま起動してしまう方が
 * 当日の事故として遥かに重い。
 */
export function seedQuestions(): readonly Question[] {
  const seenQuestionIds = new Set<string>();
  const questions: Question[] = rawSeedDeck.questions.map((q) => {
    if (seenQuestionIds.has(q.id)) {
      throw new Error(`content/questions.ts: 設問 id が重複しています: "${q.id}"`);
    }
    seenQuestionIds.add(q.id);

    if (q.kind === "choice") {
      if (q.choices.length === 0) {
        throw new Error(`content/questions.ts: 設問 "${q.id}" の choices が空です`);
      }
      const seenChoiceIds = new Set<string>();
      for (const c of q.choices) {
        if (seenChoiceIds.has(c.id)) {
          throw new Error(
            `content/questions.ts: 設問 "${q.id}" 内で選択肢 id が重複しています: "${c.id}"`,
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

  return questions;
}
