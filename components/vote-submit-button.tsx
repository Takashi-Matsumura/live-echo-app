/** 投票フォーム共通の送信ボタン（choice/multi/text-vote-form.tsx から使う）。
 *  ラベルは「未回答なら回答する、回答済みなら回答し直す」で統一する。 */
export function VoteSubmitButton({
  pending,
  disabled,
  alreadyAnswered,
}: {
  pending: boolean;
  /** フォームごとのバリデーション（未選択・未入力）。true の間は無効化する。 */
  disabled: boolean;
  alreadyAnswered: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="self-start rounded-full bg-[var(--accent)] px-6 py-3 font-medium text-white disabled:opacity-50"
    >
      {alreadyAnswered ? "回答し直す" : "回答する"}
    </button>
  );
}
