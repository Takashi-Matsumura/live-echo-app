import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionState } from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "session.json");
const TMP_FILE = path.join(DATA_DIR, "session.json.tmp");

/**
 * 起動時に一度だけ呼ぶ想定の同期読み込み。globalThis シングルトンの
 * bootstrap() は同期関数なので（`g[KEY] ??= bootstrap()`）、ここも同期で
 * 揃える。起動シーケンス中の一瞬のブロッキングは許容する。
 * 未作成・壊れている場合は null を返す（呼び出し側で初期状態にフォールバック）。
 */
export function loadPersistedStateRaw(): unknown | null {
  try {
    const raw = readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** tmp に書いてから rename する。クラッシュ時に壊れた JSON を残さないため */
export async function persistState(state: SessionState): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(TMP_FILE, JSON.stringify(state), "utf-8");
  await rename(TMP_FILE, DATA_FILE);
}

/** SIGINT/SIGTERM ハンドラ用。プロセスを終了させる前に同期でフラッシュする */
export function persistStateSync(state: SessionState): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TMP_FILE, JSON.stringify(state), "utf-8");
  renameSync(TMP_FILE, DATA_FILE);
}
