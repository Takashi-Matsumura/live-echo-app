import { DownloadIcon } from "@/components/icons";

/** エクスポート用のダウンロードリンク。Next の <Link> ではなく素の <a>:
 *  クライアント遷移させず、レスポンスの Content-Disposition をブラウザに
 *  そのまま解釈させ、ダウンロードとして処理させる。 */
export function ExportLink({ href, label }: { href: string; label: string }) {
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
