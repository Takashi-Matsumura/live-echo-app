#!/usr/bin/env node
// 50本程度の SSE 接続を同時に張り、サーバが健全に振る舞うかを確認する簡易
// 負荷テスト。Node には EventSource が無いため、fetch + ReadableStream で
// SSE を自前パースする。
//
// 使い方:
//   node scripts/load-test.mjs [接続数] [ベースURL]
//   node scripts/load-test.mjs 50 http://localhost:3000

const CONNECTIONS = Number(process.argv[2]) || 50;
const BASE_URL = process.argv[3] || "http://localhost:3000";
const HOLD_MS = 20_000; // ハートビート（15秒間隔）を最低1回受信できるだけ保持する

function consumeSseFrames(buffer, onEvent) {
  let rest = buffer;
  let idx;
  while ((idx = rest.indexOf("\n\n")) !== -1) {
    const frame = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    let event = "message";
    let isComment = false;
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) {
        isComment = true;
        continue;
      }
      if (line.startsWith("event:")) event = line.slice(6).trim();
    }
    onEvent(isComment ? "__heartbeat__" : event);
  }
  return rest;
}

async function connect(id) {
  const startedAt = Date.now();
  const result = {
    id,
    connected: false,
    snapshotMs: null,
    stateEvents: 0,
    heartbeats: 0,
    error: null,
  };

  try {
    const res = await fetch(`${BASE_URL}/api/stream`, {
      headers: { Accept: "text/event-stream" },
    });
    if (!res.ok || !res.body) {
      result.error = `HTTP ${res.status}`;
      return result;
    }
    result.connected = true;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const deadline = startedAt + HOLD_MS;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), remaining));
      const chunk = await Promise.race([reader.read(), timeout]);
      if (!chunk || chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = consumeSseFrames(buffer, (event) => {
        if (event === "snapshot" && result.snapshotMs === null) {
          result.snapshotMs = Date.now() - startedAt;
        } else if (event === "state") {
          result.stateEvents += 1;
        } else if (event === "__heartbeat__") {
          result.heartbeats += 1;
        }
      });
    }
    reader.cancel().catch(() => {});
  } catch (err) {
    result.error = String(err);
  }
  return result;
}

async function main() {
  console.log(
    `SSE 負荷テスト: ${CONNECTIONS} 接続 → ${BASE_URL}/api/stream （${HOLD_MS / 1000}秒保持）`,
  );
  const startedAt = Date.now();
  const results = await Promise.all(
    Array.from({ length: CONNECTIONS }, (_, i) => connect(i)),
  );
  const elapsed = Date.now() - startedAt;

  const connected = results.filter((r) => r.connected);
  const failed = results.filter((r) => !r.connected);
  const snapshotTimes = connected.map((r) => r.snapshotMs).filter((v) => v !== null);
  const avg = snapshotTimes.reduce((a, b) => a + b, 0) / (snapshotTimes.length || 1);
  const max = Math.max(0, ...snapshotTimes);
  const withHeartbeat = connected.filter((r) => r.heartbeats > 0).length;

  console.log(`\n=== 結果（総所要 ${elapsed}ms） ===`);
  console.log(`接続成功: ${connected.length}/${CONNECTIONS}`);
  if (failed.length > 0) {
    console.log(`接続失敗: ${failed.length} 件`);
    for (const f of failed.slice(0, 5)) console.log(`  #${f.id}: ${f.error}`);
  }
  console.log(`snapshot 受信までの時間: 平均 ${avg.toFixed(0)}ms / 最大 ${max}ms`);
  console.log(`ハートビートを受信できた接続: ${withHeartbeat}/${connected.length}`);
  console.log(
    "\nNote: サーバプロセスのメモリ使用量は別途 `ps -o rss= -p <PID>` で確認してください。",
  );

  if (failed.length > 0) process.exitCode = 1;
}

main();
