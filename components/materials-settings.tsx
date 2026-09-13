"use client";

import { useActionState } from "react";
import { removeMaterials, saveMaterials, type MaterialsFormState } from "@/app/admin/actions";
import type { MaterialsConfig, Question } from "@/lib/types";

const initialState: MaterialsFormState = {};

/**
 * 管理画面の「資料設定」セクション。研修資料（Canva URL 等）の登録・
 * 差し替え・削除と、解放のきっかけになる設問の指定。
 *
 * components/brand-settings.tsx と同じ構造（"use client" +
 * useActionState）。config・questions はどちらもシリアライズ可能な素の値
 * なので、qr-panel.tsx のような server-in-client の受け渡しは要らない
 * （app/admin/page.tsx から通常の prop として渡す）。
 */
export function MaterialsSettings({
  config,
  questions,
}: {
  config: MaterialsConfig | null;
  questions: readonly Question[];
}) {
  const [state, formAction, pending] = useActionState(saveMaterials, initialState);

  // 設定済みの gateQuestionId が現在の設問リストに存在しない
  // （管理画面でその設問を削除した）場合は、フォームの <select> には
  // 出さず、代わりに警告を出す。lib/session/projection.ts の materialsFor
  // が ballots の不在で自動的に fail-closed にする挙動を、ここでそのまま
  // 説明する。
  const gateQuestionMissing =
    config?.gateQuestionId != null && !questions.some((q) => q.id === config.gateQuestionId);

  return (
    // 見出しはタブボタン（「資料設定」）自体が兼ねるため、ここでは重複させない。
    <section className="flex flex-col gap-4 rounded-2xl border border-black/10 p-5 dark:border-white/15">
      <p className="text-xs text-black/50 dark:text-white/50">
        Canva 等で共有した研修資料の URL を登録します。指定した設問に回答した参加者には
        自動で表示され、講師は進行中モードからいつでも全員に公開できます。
      </p>

      <form action={formAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          資料の URL
          <input
            type="url"
            name="url"
            inputMode="url"
            defaultValue={config?.url ?? ""}
            placeholder="https://www.canva.com/design/..."
            required
            className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          見出し（任意）
          <input
            type="text"
            name="label"
            defaultValue={config?.label ?? ""}
            placeholder="研修資料"
            maxLength={60}
            className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          解放するきっかけとなる設問
          <select
            name="gateQuestionId"
            defaultValue={gateQuestionMissing ? "" : (config?.gateQuestionId ?? "")}
            className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15"
          >
            <option value="">指定しない（講師の公開操作のみ）</option>
            {questions.map((q) => (
              <option key={q.id} value={q.id}>
                {q.prompt}
              </option>
            ))}
          </select>
        </label>

        {gateQuestionMissing && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            指定していた設問は削除されています。資料は講師の公開操作でのみ表示されます。
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-full border border-black/10 px-4 py-1.5 text-sm disabled:opacity-50 dark:border-white/15"
        >
          {pending ? "保存中…" : config ? "更新" : "登録"}
        </button>
      </form>

      {config && (
        <form action={removeMaterials}>
          <button
            type="submit"
            className="self-start text-sm text-black/50 underline dark:text-white/50"
          >
            削除
          </button>
        </form>
      )}

      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </section>
  );
}
