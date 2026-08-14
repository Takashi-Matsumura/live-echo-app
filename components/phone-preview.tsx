"use client";

import { useId, useState, type CSSProperties } from "react";

// iPhone 15 相当の CSS ピクセル。実機と折り返し位置・行数を一致させるため
// 固定値のまま iframe に渡し、表示だけ transform: scale() で縮小する
// （幅そのものを縮めると折り返しが実機とズレてしまう）。
const PHONE_W = 393;
const PHONE_H = 852;

export function PhonePreview({
  src = "/",
  title = "参加者画面のプレビュー",
  scale,
  className = "",
}: {
  /** 埋め込む URL。既定は参加者画面。lib/auth/admin.ts の resolveRole() が
   *  ?view=participant を一方向の降格として扱うため、admin の Cookie を
   *  持つブラウザから開いても参加者と同じ投影（未公開集計・伏せた回答は
   *  除去）が届く。サーバ側の変更なしにそのまま「なりすまし」できる。 */
  src?: string;
  /** iframe の a11y 名。必須属性 */
  title?: string;
  /** 省略時は lg/xl/2xl の CSS 変数で段階的に決まる。数値を渡すと固定 */
  scale?: number;
  className?: string;
}) {
  const [interactive, setInteractive] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const statusId = useId();

  const scaleVar =
    scale === undefined ? undefined : ({ "--phone-scale": String(scale) } as CSSProperties);

  return (
    <div
      style={scaleVar}
      className={`flex flex-col gap-3 [--phone-scale:0.58] xl:[--phone-scale:0.68] 2xl:[--phone-scale:0.80] ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-black/50 dark:text-white/50">
          参加者の画面
        </h2>
        <button
          type="button"
          onClick={() => setReloadKey((n) => n + 1)}
          className="text-xs text-black/40 underline dark:text-white/40"
        >
          再読み込み
        </button>
      </div>

      {/* ベゼル */}
      <div className="relative self-start rounded-[calc(56px*var(--phone-scale))] border-[3px] border-black/80 bg-black p-[9px] shadow-xl dark:border-white/20">
        {/* スケールラッパ: transform はレイアウトボックスを変えないため、
            外側で縮小後の実寸を明示して余白が生まれないようにする。 */}
        <div
          className="relative overflow-hidden rounded-[calc(46px*var(--phone-scale))]"
          style={{
            width: `calc(${PHONE_W}px * var(--phone-scale))`,
            height: `calc(${PHONE_H}px * var(--phone-scale))`,
          }}
        >
          <iframe
            key={reloadKey}
            src={src}
            title={title}
            aria-describedby={statusId}
            // pointer-events を切っても Tab フォーカスは止まらないため、
            // 操作不可のときはフォーカス自体をフレーム外に出す。
            tabIndex={interactive ? 0 : -1}
            className="absolute left-0 top-0 block border-0"
            style={{
              width: PHONE_W,
              height: PHONE_H,
              transform: "scale(var(--phone-scale))",
              transformOrigin: "top left",
              pointerEvents: interactive ? "auto" : "none",
              // 講師の OS のダークモード設定に引きずられず、常に「参加者の
              // スマホ」として安定した見た目にする。
              colorScheme: "light",
            }}
          />

          {/* ノッチ（Dynamic Island 風の飾り。装飾のみで実体は無い） */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full bg-black"
            style={{
              top: `calc(8px * var(--phone-scale))`,
              width: `calc(108px * var(--phone-scale))`,
              height: `calc(28px * var(--phone-scale))`,
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <button
          type="button"
          aria-pressed={interactive}
          onClick={() => setInteractive((v) => !v)}
          className={`self-start rounded-full px-4 py-1.5 text-sm font-medium ${
            interactive
              ? "bg-[var(--accent)] text-white"
              : "border border-black/10 dark:border-white/15"
          }`}
        >
          {interactive ? "操作を許可中" : "操作を許可"}
        </button>
        <p
          id={statusId}
          aria-live="polite"
          className={`text-xs ${
            interactive
              ? "text-red-600 dark:text-red-400"
              : "text-black/40 dark:text-white/40"
          }`}
        >
          {interactive
            ? "ここでの投票は本番の集計に加算されます"
            : "表示のみ（クリック・スクロールは無効）"}
        </p>
      </div>
    </div>
  );
}
