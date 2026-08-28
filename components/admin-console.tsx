"use client";

import { useEffect, useRef, useState, useTransition, type Ref } from "react";
import {
  deleteQuestion,
  hideAnswer,
  resetQuestion,
  selectQuestion,
  setPhase,
  setRevealed,
  unhideAnswer,
} from "@/app/admin/actions";
import { useAdminMode } from "@/components/admin-mode";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DownloadIcon, PencilIcon, TrashIcon, UploadIcon, WarningIcon } from "@/components/icons";
import { QuestionForm } from "@/components/question-form";
import { QuestionImportForm } from "@/components/question-import-form";
import { ResetAllDialog } from "@/components/reset-all-dialog";
import { ResultBars } from "@/components/result-bars";
import { RevokeSessionsButton } from "@/components/revoke-sessions-button";
import { useLiveState } from "@/components/live-state-provider";
import { isChoiceLike, QUESTION_KIND_LABELS } from "@/lib/questions";
import type { Deck, Phase, PublicResults, Question } from "@/lib/types";

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

/** エクスポート用のダウンロードリンク。Next の <Link> ではなく素の <a>:
 *  クライアント遷移させず、レスポンスの Content-Disposition をブラウザに
 *  そのまま解釈させ、ダウンロードとして処理させる。 */
function ExportLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm dark:border-white/15"
    >
      <DownloadIcon />
      {label}
    </a>
  );
}

function QuestionRow({
  itemRef,
  index,
  question,
  isActive,
  pending,
  answeredCount,
  phase,
  revealed,
  results,
  run,
  onEdit,
  editable,
}: {
  itemRef?: Ref<HTMLLIElement>;
  index: number;
  question: Question;
  isActive: boolean;
  pending: boolean;
  answeredCount: number;
  phase: Phase;
  revealed: boolean;
  results: PublicResults | null;
  run: (fn: () => Promise<void>) => void;
  onEdit: (question: Question) => void;
  /** 準備中モードのときだけ true。編集・削除・この設問のリセットは
   *  破壊的操作なので、進行中モードでは画面から隠す
   *  （components/admin-mode.tsx 参照）。 */
  editable: boolean;
}) {
  const resetDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);

  return (
    <li
      ref={itemRef}
      className={`rounded-lg border ${
        isActive ? "border-[var(--accent)]" : "border-black/10 dark:border-white/15"
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {/* 設問番号を丸バッジにして視認性を上げる（旧「設問1」というテキストより
            大きく目立つ）。種別ラベルはバッジと重複しないよう「選択式」等のみ残す。 */}
        <span
          aria-hidden
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            isActive
              ? "bg-[var(--accent)] text-white"
              : "bg-black/5 text-black/60 dark:bg-white/10 dark:text-white/60"
          }`}
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-black/40 dark:text-white/40">
            {QUESTION_KIND_LABELS[question.kind]}
          </p>
          <p className="font-medium">{question.prompt}</p>
        </div>

        {/* 編集・削除は出題中かどうかに関係なく常設（出題中でない設問の
            方が編集・削除する機会は多い）。出題中の受付/結果公開の操作は
            下の展開部分に残す。★準備中モード限定 — 進行中は「この設問を
            出す」の隣に破壊的な削除ボタンが常設される導線を構造的に消す。 */}
        {editable && (
          <>
            <button
              type="button"
              aria-label="この設問を編集"
              onClick={() => onEdit(question)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/10 text-black/60 dark:border-white/15 dark:text-white/60"
            >
              <PencilIcon />
            </button>
            <button
              type="button"
              aria-label="この設問を削除"
              disabled={pending}
              onClick={() => deleteDialogRef.current?.showModal()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-300 text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-400"
            >
              <TrashIcon />
            </button>
          </>
        )}

        {isActive ? (
          // ★出題中の行はボタンではなく非活性の pill にする。以前は出題中でも
          // 同じ selectQuestion 呼び出しが残っていて、押すと
          // applySelectQuestion（lib/session/mutations.ts）が phase/revealed
          // を無条件でリセットしてしまっていた（受付締切後や結果公開後に
          // 誤って押すと状態が巻き戻る実害のあるバグ）。ここで併せて直す。
          <span className="shrink-0 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">
            出題中
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => selectQuestion(question.id))}
            className="shrink-0 rounded-full border border-black/10 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-white/15"
          >
            この設問を出す
          </button>
        )}
      </div>

      {/* 展開部分。出題中の行だけ描画される＝アコーディオンの「開」状態。
          非出題中の設問には安全なプレビューが無い（selectQuestion は必ず
          phase/revealed をリセットする本番の状態変更で、結果も
          projection.ts が出題中の設問ぶんしかクライアントに配らない）ため、
          他の行は要約のままにしてある。 */}
      {isActive && (
        <div className="flex flex-col gap-4 border-t border-black/10 px-4 py-4 dark:border-white/15">
          <span className="text-sm text-black/50 dark:text-white/50">
            回答済み: {answeredCount}人
          </span>

          <div className="flex flex-wrap items-center gap-2">
            <ToggleButton
              checked={phase === "open"}
              disabled={pending}
              onClick={() => run(() => setPhase(phase === "open" ? "closed" : "open"))}
              onLabel="受付中"
              offLabel="受付停止"
            />
            <ToggleButton
              checked={revealed}
              disabled={pending}
              onClick={() => run(() => setRevealed(!revealed))}
              onLabel="結果公開中"
              offLabel="結果非公開"
            />
            {editable && (
              <button
                type="button"
                disabled={pending}
                aria-label="この設問をリセット"
                onClick={() => resetDialogRef.current?.showModal()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-300 text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-400"
              >
                <TrashIcon />
              </button>
            )}
          </div>

          {results && (
            <AdminResults
              question={question}
              results={results}
              closed={phase === "closed"}
              pending={pending}
              run={run}
            />
          )}

          <ConfirmDialog
            dialogRef={resetDialogRef}
            title="この設問をリセットしますか？"
            description="集まった回答と結果公開の状態が消え、この設問は最初の状態に戻ります。"
            confirmLabel="リセットする"
            pending={pending}
            onConfirm={() => run(() => resetQuestion(question.id))}
          />
        </div>
      )}

      <ConfirmDialog
        dialogRef={deleteDialogRef}
        title="この設問を削除しますか？"
        description="回答も含めて完全に削除されます。この操作は取り消せません。"
        confirmLabel="削除する"
        pending={pending}
        onConfirm={() => run(() => deleteQuestion(question.id))}
      />
    </li>
  );
}

function ToggleButton({
  checked,
  disabled,
  onClick,
  onLabel,
  offLabel,
}: {
  checked: boolean;
  disabled: boolean;
  onClick: () => void;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
        checked
          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
          : "border-black/10 text-black/60 dark:border-white/15 dark:text-white/60"
      }`}
    >
      <span
        aria-hidden
        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full ${
          checked ? "bg-[var(--accent)]" : "bg-black/20 dark:bg-white/20"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </span>
      {checked ? onLabel : offLabel}
    </button>
  );
}

function AdminResults({
  question,
  results,
  closed,
  pending,
  run,
}: {
  question: Question;
  results: PublicResults;
  closed: boolean;
  pending: boolean;
  run: (fn: () => Promise<void>) => void;
}) {
  if (results.kind === "choice" && isChoiceLike(question)) {
    return (
      <ResultBars
        question={question}
        counts={results.counts}
        closed={closed}
        respondents={results.respondents}
      />
    );
  }

  if (results.kind === "text") {
    if (results.answers.length === 0) {
      return (
        <p className="text-sm text-black/50 dark:text-white/50">
          まだ回答がありません
        </p>
      );
    }
    return (
      // 回答は参加者数ぶん増えうる。上の進行ボタン群が常に画面内に留まるよう
      // ここだけ高さ上限つきでスクロールさせる（外側の <ul> とは独立した領域）。
      <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
        {results.answers.map((answer) => (
          <li
            key={answer.id}
            className={`flex items-start justify-between gap-3 rounded-lg px-4 py-3 text-sm ${
              answer.hidden
                ? "bg-black/5 text-black/40 dark:bg-white/5 dark:text-white/40"
                : "bg-black/5 dark:bg-white/10"
            }`}
          >
            <span className="flex-1">
              {answer.hidden && <span className="mr-1">（伏せ中）</span>}
              {answer.text}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() =>
                  answer.hidden
                    ? unhideAnswer(question.id, answer.id)
                    : hideAnswer(question.id, answer.id),
                )
              }
              className="shrink-0 text-xs text-black/40 underline disabled:opacity-50 dark:text-white/40"
            >
              {answer.hidden ? "表示する" : "伏せる"}
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return null;
}
