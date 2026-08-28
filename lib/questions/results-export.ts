import { QUESTION_KIND_LABELS, answerText, isChoiceLike, selectedChoiceIds } from "@/lib/questions";
import type { Question, SessionState } from "@/lib/types";

/**
 * 管理画面の結果表示（lib/session/projection.ts の buildResults、集計済み）
 * とは別に、「1行=1参加者の1設問への回答」という生データ形式で CSV を作る。
 * 集計は Excel 側で自由にやり直せるほうが用途が広いため、あえて集計しない。
 *
 * choice/multi は選択肢ラベルに変換し（複数選択は「、」区切り）、text は
 * 本文をそのまま出す。非表示（モデレーションで伏せた回答）も列で分かる
 * ようにし、除外はしない — エクスポートは管理者専用の生データなので。
 */
export function toResultsCsv(questions: readonly Question[], state: SessionState): string {
  const header = ["設問番号", "設問", "種別", "参加者ID", "回答内容", "非表示"];
  const rows: string[][] = [header];

  questions.forEach((question, index) => {
    const ballots = state.ballots[question.id] ?? {};
    const hidden = new Set(state.hidden[question.id] ?? []);
    const kindLabel = QUESTION_KIND_LABELS[question.kind];

    for (const [participantId, answer] of Object.entries(ballots)) {
      const content = isChoiceLike(question)
        ? selectedChoiceIds(answer)
            .map((id) => question.choices.find((c) => c.id === id)?.label ?? id)
            .join("、")
        : (answerText(answer) ?? "");

      rows.push([
        String(index + 1),
        question.prompt,
        kindLabel,
        participantId,
        content,
        hidden.has(participantId) ? "はい" : "いいえ",
      ]);
    }
  });

  return rows.map((row) => row.map(csvField).join(",")).join("\r\n");
}

// Excel/Google Sheets は先頭がこれらの文字のセルを数式として解釈する。
// 回答内容（自由記述）は参加者からの未検証入力なので、"=1+1" のような
// 文字列を送られると、管理者がこの CSV を開いた瞬間に数式として実行
// されてしまう（CSV Formula Injection）。OWASP 推奨どおり、先頭にシングル
// クォートを1つ足して文字列として固定する。
const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

function csvField(value: string): string {
  const neutralized = FORMULA_TRIGGER_CHARS.has(value.charAt(0)) ? `'${value}` : value;
  if (/[",\r\n]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}
