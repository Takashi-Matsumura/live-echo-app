"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useAdminMode } from "@/components/admin-mode";
import { ExportLink } from "@/components/export-link";
import { UploadIcon, WarningIcon } from "@/components/icons";
import { QuestionForm } from "@/components/question-form";
import { QuestionImportForm } from "@/components/question-import-form";
import { QuestionRow } from "@/components/question-row";
import { ResetAllDialog } from "@/components/reset-all-dialog";
import { RevokeSessionsButton } from "@/components/revoke-sessions-button";
import { useLiveState } from "@/components/live-state-provider";
import type { Deck, Question } from "@/lib/types";

export function AdminConsole({ questions }: { questions: Deck["questions"] }) {
  const { state } = useLiveState();
  const { mode } = useAdminMode();
  const [pending, startTransition] = useTransition();
  const activeItemRef = useRef<HTMLLIElement>(null);
  const formDialogRef = useRef<HTMLDialogElement>(null);
  // null = ダイアログを閉じている。"new" = 新規作成。Question = その設問を編集中。
  const [editing, setEditing] = useState<Question | "new" | null>(null);
  const importDialogRef = useRef<HTMLDialogElement>(null);
  // インポートフォームは作成/編集フォームと違い編集対象を持たないので、
  // 開閉は真偽値だけで足りる。閉じたらアンマウントし、file input や
  // 選択モードの内部 state を毎回まっさらにする。
  const [importOpen, setImportOpen] = useState(false);
  const resetAllDialogRef = useRef<HTMLDialogElement>(null);
  // 全体リセットはステップアップ認証（TOTP再入力）が要るため、他の破壊的
  // 操作と違い ConfirmDialog ではなく専用の ResetAllDialog を使う。
  // 開閉は真偽値だけで足り、閉じたら内部の入力コード state をまっさらにする
  // （QuestionImportForm と同じアンマウント方式）。
  const [resetAllOpen, setResetAllOpen] = useState(false);

  function run(fn: () => Promise<void>) {
    startTransition(async () => {
      await fn();
    });
  }

  // 出題中の設問が切り替わったら、パネルがスクロールしていても見える位置まで
  // 自動でスクロールする（スクロール領域は components/admin-tabs.tsx 側。
  // scrollIntoView は最も近いスクロール可能な祖先を自動で探すので、
  // 領域がどちらにあっても書き換え不要）。
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [state.question?.id]);

  function openCreateForm() {
    setEditing("new");
    formDialogRef.current?.showModal();
  }
  function openEditForm(question: Question) {
    setEditing(question);
    formDialogRef.current?.showModal();
  }
  function closeForm() {
    formDialogRef.current?.close();
    setEditing(null);
  }

  function openImportForm() {
    setImportOpen(true);
    importDialogRef.current?.showModal();
  }
  function closeImportForm() {
    importDialogRef.current?.close();
    setImportOpen(false);
  }

  function openResetAllDialog() {
    setResetAllOpen(true);
    resetAllDialogRef.current?.showModal();
  }
  function closeResetAllDialog() {
    resetAllDialogRef.current?.close();
    setResetAllOpen(false);
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-8">
      <section className="flex flex-col gap-3">
        {/* 見出しはタブボタン（「設問一覧」）自体が兼ねるため、ここでは重複させない
            （components/brand-settings.tsx と同じ判断）。
            設問一覧と「出題中の設問の詳細」はかつて別セクションだったが、
            1つのアコーディオンに統合した: 出題中の行だけが自動的に展開して
            操作ボタン・結果を表示し、他の行は要約のみの最小高さで並ぶ。
            スクロールはこのパネル全体（この「新しい設問を追加」ボタンから
            下）を包む components/admin-tabs.tsx 側の領域が担うため、ここでは
            高さを制限しない。 */}
        {mode === "setup" && (
          <button
            type="button"
            onClick={openCreateForm}
            className="self-start rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          >
            新しい設問を追加
          </button>
        )}

        {questions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-black/10 px-4 py-8 text-center text-sm text-black/50 dark:border-white/15 dark:text-white/50">
            {mode === "setup"
              ? "設問がまだ登録されていません。「新しい設問を追加」から作成してください。"
              : "設問がまだ登録されていません。「準備中」に切り替えて作成してください。"}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {questions.map((q, i) => {
              const isActive = state.question?.id === q.id;
              return (
                <QuestionRow
                  key={q.id}
                  itemRef={isActive ? activeItemRef : undefined}
                  index={i}
                  question={q}
                  isActive={isActive}
                  pending={pending}
                  answeredCount={state.answeredCount}
                  phase={state.phase}
                  revealed={state.revealed}
                  results={state.results}
                  run={run}
                  onEdit={openEditForm}
                  editable={mode === "setup"}
                />
              );
            })}
          </ul>
        )}
      </section>

      {/* 設問データの入出力＋全体リセット。どれも一覧全体を動かす操作
          なので、行単位の操作（各設問のリセット・削除）とは別に、
          パネル最下部にまとめて置く。
          ★進行中モードでは結果CSVエクスポート（read-only・全体リセット前の
          保険）だけを残し、他はすべて隠す。準備中モードでのみ、
          データ入出力（青系）と危険な操作（赤枠で囲って隔離）を分けて出す。 */}
      {mode === "live" ? (
        questions.length > 0 && (
          <div className="flex flex-wrap items-center gap-4">
            <ExportLink href="/api/admin/results/export" label="アンケート結果（CSV）" />
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Next の <Link> ではなく素の <a>: クライアント遷移させず、
                レスポンスの Content-Disposition をブラウザにそのまま
                解釈させ、ダウンロードとして処理させる。 */}
            {questions.length > 0 && (
              <>
                <ExportLink href="/api/admin/questions/export" label="設問（JSON）" />
                <ExportLink href="/api/admin/results/export" label="アンケート結果（CSV）" />
              </>
            )}
            <button
              type="button"
              onClick={openImportForm}
              className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm dark:border-white/15"
            >
              <UploadIcon />
              設問をインポート
            </button>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-red-300 p-4 dark:border-red-900">
            <p className="flex items-center gap-2 text-xs font-medium text-red-600 dark:text-red-400">
              <WarningIcon />
              危険な操作 — 元に戻せません
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={pending}
                onClick={openResetAllDialog}
                className="inline-flex items-center gap-2 rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-400"
              >
                <WarningIcon />
                全体をリセット
              </button>
              <RevokeSessionsButton />
            </div>
          </div>
        </div>
      )}

      {/* 作成・編集共用フォーム。1つのダイアログを使い回し、editing の値で
          中身（QuestionForm）を作り直す。key を切り替えることで、対象が
          変わるたびに内部 state（選択肢の行など）をまっさらにする。 */}
      <dialog
        ref={formDialogRef}
        onClose={() => setEditing(null)}
        className="m-auto rounded-xl border border-black/10 bg-[var(--background)] p-0 text-[var(--foreground)] backdrop:bg-black/40 dark:border-white/15"
      >
        {editing === "new" ? (
          <QuestionForm key="new" mode="create" onDone={closeForm} />
        ) : editing ? (
          <QuestionForm key={editing.id} mode="edit" question={editing} onDone={closeForm} />
        ) : null}
      </dialog>

      {/* インポート用ダイアログ。作成/編集用（formDialogRef）とは別に持つ。
          importOpen が false のときは中身をアンマウントし、file input と
          選択モードを次に開いたときまっさらに戻す。 */}
      <dialog
        ref={importDialogRef}
        onClose={() => setImportOpen(false)}
        className="m-auto rounded-xl border border-black/10 bg-[var(--background)] p-0 text-[var(--foreground)] backdrop:bg-black/40 dark:border-white/15"
      >
        {importOpen ? <QuestionImportForm onDone={closeImportForm} /> : null}
      </dialog>

      {/* 全体リセット用ダイアログ。作成/編集・インポートと同じく、外側の
          <dialog> は常設し、開閉のたびに中身だけ着脱して内部 state
          （入力途中のTOTPコード）をまっさらに戻す。 */}
      <dialog
        ref={resetAllDialogRef}
        onClose={() => setResetAllOpen(false)}
        className="m-auto rounded-xl border border-black/10 bg-[var(--background)] p-0 text-[var(--foreground)] backdrop:bg-black/40 dark:border-white/15"
      >
        {resetAllOpen ? <ResetAllDialog onDone={closeResetAllDialog} /> : null}
      </dialog>
    </div>
  );
}
