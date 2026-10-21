#!/usr/bin/env node
// `opennextjs-cloudflare build` が書き出す .open-next/cloudflare/next-env.mjs を
// 空にする。OpenNext は .env / .env.production / .env.local などの中身を
// このファイルへそのまま書き出し、deploy 時に wrangler が Worker スクリプトへ
// 同梱する。無効化するオプションは無い。結果として .env.local のローカル用
// ADMIN_PASSWORD などが本番の Worker に平文で載り、ダッシュボードでコードを
// 見られる人に読めてしまう。
//
// 本番の値は `wrangler secret put` で設定した secret が使われ、next-env.mjs の
// 値は未設定のキーを埋めるだけ（init.js の `process.env[key] ??= ...`）。
// 空にしても本番の挙動は変わらない。逆に secret が欠けた場合は、ローカルの値で
// 黙って動くのではなく /api/health が ok: false になり、そこで気づける。
//
// 使い方（npm run deploy から build と deploy の間で呼ばれる）:
//   node scripts/strip-bundled-env.mjs
//
// preview はローカル確認用なので .env.local の値をそのまま使う（このスクリプトは
// 通さない）。

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ENV_FILE = resolve(".open-next/cloudflare/next-env.mjs");
const MODES = ["production", "development", "test"];

// ファイルが無い = OpenNext の出力構成が変わった可能性がある。黙って通すと
// 値が別の場所に同梱されたままデプロイされかねないので、止めて確認を促す。
if (!existsSync(ENV_FILE)) {
  console.error(
    `${ENV_FILE} が見つかりません。先に opennextjs-cloudflare build を実行したか、` +
      "OpenNext の出力構成が変わっていないかを確認してください。",
  );
  process.exit(1);
}

writeFileSync(ENV_FILE, MODES.map((mode) => `export const ${mode} = {};\n`).join(""));

// 書き換え後に読み戻して、どのモードにもキーが残っていないことを確かめる。
const stripped = await import(`${pathToFileURL(ENV_FILE).href}?t=${Date.now()}`);
const leftover = MODES.filter((mode) => Object.keys(stripped[mode] ?? {}).length > 0);
if (leftover.length > 0) {
  console.error(`next-env.mjs にまだ値が残っています: ${leftover.join(", ")}`);
  process.exit(1);
}

console.log("next-env.mjs を空にしました（.env* の値は Worker に同梱されません）。");
