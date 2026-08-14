"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { createQuestion, updateQuestion, type QuestionFormState } from "@/app/admin/actions";
import type { Question } from "@/lib/types";

const initialState: QuestionFormState = {};

type ChoiceRow = {
  /** React の key。行の並び替え・削除をぶれさせないためクライアント側で
   *  発行する。フォーム送信そのものには使わない。 */
  readonly key: string;
  /** 既存の選択肢を編集している行なら元の choice id、新規に追加した行
   *  なら null（サーバー側で新しい id を発行する）。 */
  readonly id: string | null;
  readonly defaultLabel: string;
};

function initialChoiceRows(question?: Question): ChoiceRow[] {
  if (question?.kind === "choice") {
    return question.choices.map((c) => ({ key: c.id, id: c.id, defaultLabel: c.label }));
  }
  // 新規作成、または元が自由記述だった場合は空の2行から始める（最小件数）。
  return [
    { key: crypto.randomUUID(), id: null, defaultLabel: "" },
    { key: crypto.randomUUID(), id: null, defaultLabel: "" },
  ];
}

/**
 * 設問の作成・編集フォーム。components/admin-console.tsx から
 * <dialog> の中身として使う（作成・編集どちらも1つのコンポーネントで
 * 賄う。呼び出し側が `key` を切り替えて作成/編集対象ごとに作り直す）。
 */
export function QuestionForm(
  props:
    | { mode: "create"; onDone: () => void }
    | { mode: "edit"; question: Question; onDone: () => void },
) {
  const { mode, onDone } = props;
  // mode === "edit" のときだけ編集対象が渡る。判別可能なユニオンにして
  // おくことで、create のときに question を渡し忘れる／edit のときに
  // question が undefined かもしれない、という取り違えを型で防いでいる。
  const question = props.mode === "edit" ? props.question : undefined;
  const action = props.mode === "create" ? createQuestion : updateQuestion.bind(null, props.question.id);
  const [state, formAction, pending] = useActionState(action, initialState);

  const [kind, setKind] = useState<"choice" | "text">(question?.kind ?? "choice");
  const [choiceRows, setChoiceRows] = useState<ChoiceRow[]>(() => initialChoiceRows(question));

  // 送信中 → 送信完了 かつ エラー無し、の遷移だけを検知してダイアログを
  // 閉じる。useActionState の初期状態もエラー無しなので、pending の
  // 立ち下がりで判定しないと、マウント直後に誤って閉じてしまう。
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      onDone();
    }
    wasPending.current = pending;
  }, [pending, state, onDone]);

  function addChoiceRow() {
    setChoiceRows((rows) => [...rows, { key: crypto.randomUUID(), id: null, defaultLabel: "" }]);
  }
  function removeChoiceRow(key: string) {
    setChoiceRows((rows) => rows.filter((r) => r.key !== key));
  }

  return (
    <form action={formAction} className="flex w-[28rem] max-w-[calc(100vw-2rem)] flex-col gap-4 p-5">
      <p className="font-medium">{mode === "create" ? "新しい設問を追加" : "設問を編集"}</p>

      <div className="flex gap-2" role="radiogroup" aria-label="設問の種類">
        <KindButton active={kind === "choice"} onClick={() => setKind("choice")}>
          選択式
        </KindButton>
        <KindButton active={kind === "text"} onClick={() => setKind("text")}>
          自由記述
        </KindButton>
        <input type="hidden" name="kind" value={kind} />
      </div>
      {mode === "edit" && question && question.kind !== kind && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          種別を変更すると、この設問の回答はリセットされます。
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        設問文
        <textarea
          name="prompt"
          required
          maxLength={200}
          rows={2}
          defaultValue={question?.prompt}
          className="resize-none rounded-lg border border-black/10 bg-white px-4 py-3 outline-none focus:border-[var(--accent)] dark:border-white/15 dark:bg-white/5"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        補足（任意）
        <input
          name="note"
          maxLength={200}
          defaultValue={question?.note}
          className="rounded-lg border border-black/10 bg-white px-4 py-2 outline-none focus:border-[var(--accent)] dark:border-white/15 dark:bg-white/5"
        />
      </label>

      {kind === "choice" ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm">選択肢（2〜6個）</span>
          <div className="flex flex-col gap-2">
            {choiceRows.map((row) => (
              <div key={row.key} className="flex items-center gap-2">
                <input type="hidden" name="choiceId" value={row.id ?? ""} />
                <input
                  name="choiceLabel"
                  required
                  maxLength={60}
                  defaultValue={row.defaultLabel}
                  className="flex-1 rounded-lg border border-black/10 bg-white px-4 py-2 text-sm outline-none focus:border-[var(--accent)] dark:border-white/15 dark:bg-white/5"
                />
                <button
                  type="button"
                  disabled={choiceRows.length <= 2}
                  onClick={() => removeChoiceRow(row.key)}
                  className="shrink-0 text-xs text-black/40 underline disabled:opacity-30 dark:text-white/40"
                >
                  削除
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={choiceRows.length >= 6}
            onClick={addChoiceRow}
            className="self-start rounded-full border border-black/10 px-4 py-1.5 text-sm disabled:opacity-50 dark:border-white/15"
          >
            選択肢を追加
          </button>
          {mode === "edit" && (
            <p className="text-xs text-black/40 dark:text-white/40">
              選択肢を削除すると、その選択肢への回答は失われます。ラベルの変更や新しい選択肢の追加は既存の回答に影響しません。
            </p>
          )}
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm">
            プレースホルダー（任意）
            <input
              name="placeholder"
              maxLength={60}
              defaultValue={question?.kind === "text" ? question.placeholder : undefined}
              className="rounded-lg border border-black/10 bg-white px-4 py-2 outline-none focus:border-[var(--accent)] dark:border-white/15 dark:bg-white/5"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            回答の最大文字数
            <input
              type="number"
              name="maxLength"
              min={10}
              max={1000}
              defaultValue={question?.kind === "text" ? (question.maxLength ?? 140) : 140}
              className="rounded-lg border border-black/10 bg-white px-4 py-2 outline-none focus:border-[var(--accent)] dark:border-white/15 dark:bg-white/5"
            />
          </label>
        </>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-full border border-black/10 px-4 py-2 text-sm dark:border-white/15"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "保存中…" : mode === "create" ? "追加する" : "保存する"}
        </button>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}

function KindButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm font-medium ${
        active
          ? "bg-[var(--accent)] text-white"
          : "border border-black/10 dark:border-white/15"
      }`}
    >
      {children}
    </button>
  );
}
