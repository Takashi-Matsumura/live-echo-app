#!/usr/bin/env node
// 管理者ログインの TOTP（二要素認証）用シークレットを1つ生成して標準出力する。
// 20バイト（160bit）の乱数を Base32 エンコードする — 20は5の倍数なので
// Base32 が32文字ちょうどで割り切れ、パディング "=" が発生しない
// （otpauth:// URI のクエリでパーセントエンコードが必要になる事故を避ける）。
//
// lib/auth/totp.ts は Base32 の「デコード」しか持たないため、ここでは
// エンコード側をこのスクリプト内に閉じて持つ（.mjs から .ts は import
// できないので、TypeScript側との重複ではなく方向違いの実装）。
//
// 使い方:
//   node scripts/generate-totp-secret.mjs
//
// 出力された値は秘密情報。.env.local の TOTP_SECRET に貼るか、本番では
//   npx wrangler secret put TOTP_SECRET
// に貼り付ける。コミットしないこと。

import { randomBytes } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

const secret = base32Encode(randomBytes(20));

console.log(secret);
console.error("");
console.error("↑ これは秘密情報です。コミットしないでください。");
console.error("  ローカル: .env.local に TOTP_SECRET=<上の値> を追記");
console.error("  本番    : npx wrangler secret put TOTP_SECRET");
