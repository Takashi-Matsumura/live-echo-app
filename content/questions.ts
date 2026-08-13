import type { Deck } from "@/lib/types";

/**
 * ★当日いじる唯一のファイル。
 * セミナー本番の設問はここを書き換えるだけでよい（管理画面からの CRUD は無い）。
 * id は questions 全体でユニークにすること（重複は lib/questions.ts の起動時検証で弾かれる）。
 */
export const deck: Deck = {
  title: "サンプルアンケート",
  questions: [
    {
      kind: "choice",
      id: "experience",
      prompt: "ふだん Next.js をどのくらい使っていますか？",
      choices: [
        { id: "daily", label: "ほぼ毎日" },
        { id: "weekly", label: "週に数回" },
        { id: "rarely", label: "たまに" },
        { id: "never", label: "使ったことがない" },
      ],
    },
    {
      kind: "choice",
      id: "topic",
      prompt: "今日いちばん聞きたいトピックはどれですか？",
      choices: [
        { id: "routing", label: "ルーティング" },
        { id: "rendering", label: "レンダリング戦略" },
        { id: "caching", label: "キャッシュ" },
        { id: "deploy", label: "デプロイ" },
      ],
    },
    {
      kind: "text",
      id: "feedback",
      prompt: "セミナーへの質問・感想を自由にどうぞ",
      placeholder: "気になったこと、聞いてみたいことなど",
      maxLength: 140,
    },
  ],
};
