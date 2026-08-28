/**
 * 管理画面で使うインラインSVGアイコンの集約先。アイコンライブラリは
 * 追加しない（依存を増やさない・Workers のバンドルサイズに影響しない）。
 *
 * 規約（新規追加時も踏襲すること）:
 * - viewBox="0 0 20 20"（Heroicons small 相当のグリッド）
 * - fill="none" stroke="currentColor" strokeWidth="1.5"
 *   strokeLinecap="round" strokeLinejoin="round"（塗りではなくストローク。
 *   色は親の text-* から currentColor で継承する）
 * - className="h-4 w-4"（16px 固定。width/height 属性は付けない）
 * - aria-hidden="true"（ラベルは包む要素側の aria-label / 可視テキストで与える）
 */

export function TrashIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m-6.5 0 .6 9.4A1.5 1.5 0 0 0 7.6 17h4.8a1.5 1.5 0 0 0 1.5-1.6L14.5 6M8.5 9.5v4m3-4v4" />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M13.4 3.4a1.5 1.5 0 0 1 2.12 0l1.08 1.08a1.5 1.5 0 0 1 0 2.12L7.2 15 3 16l1-4.2 9.4-9.4Z" />
      <path d="M11.6 5.2 14.8 8.4" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 15.5h12" />
    </svg>
  );
}

export function UploadIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5M4 15.5h12" />
    </svg>
  );
}

export function QrIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M3.5 3.5h4v4h-4zM12.5 3.5h4v4h-4zM3.5 12.5h4v4h-4z" />
      <path d="M11 11h2M11 14h.5M13.5 14h3M11 16.5h5.5" />
    </svg>
  );
}

export function LogoutIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M12.5 6.5V4.5A1.5 1.5 0 0 0 11 3H5.5A1.5 1.5 0 0 0 4 4.5v11A1.5 1.5 0 0 0 5.5 17H11a1.5 1.5 0 0 0 1.5-1.5v-2" />
      <path d="M8 10h9m0 0-2.5-2.5M17 10l-2.5 2.5" />
    </svg>
  );
}

export function WarningIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M10 3.5 2.5 16.5h15L10 3.5Z" />
      <path d="M10 8v3.5M10 14v.01" />
    </svg>
  );
}

export function ChevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M12.5 4.5 7 10l5.5 5.5" />
    </svg>
  );
}

export function ChevronRightIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M7.5 4.5 13 10l-5.5 5.5" />
    </svg>
  );
}

