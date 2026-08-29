/** 投票フォーム共通のエラー表示（choice/multi/text-vote-form.tsx から使う）。 */
export function VoteError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {error}
    </p>
  );
}
