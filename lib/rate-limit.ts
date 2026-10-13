/**
 * ごく単純な固定窓レートリミッタ。純粋関数として実装し、バケットの Map は
 * 呼び出し側が持つ（Workers はモジュールスコープの状態を複数 isolate 間で
 * 共有できないため、状態を持つ場所は呼び出し側に委ねる設計にしてある。
 * 将来 Durable Object に移す際は、この Map を DO のインスタンスフィールドに
 * すればそのまま使える）。
 */
type RateLimitBucket = { count: number; resetAt: number };
export type RateLimitBuckets = Map<string, RateLimitBucket>;

const PURGE_THRESHOLD = 5000;
const PURGE_INTERVAL_MS = 10_000;
const MAX_BUCKETS = 50_000;
const nextPurgeAt = new WeakMap<RateLimitBuckets, number>();

/** limit 回/windowMs を超えたら false を返す */
export function checkRateLimit(
  buckets: RateLimitBuckets,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  // キー（participantId / IP）は外部から幾らでも増やせるので、放置すると
  // DO が退避されるまで Map が単調増加する。一定数を超えたら期限切れの
  // バケットをまとめて捨てる。★走査は PURGE_INTERVAL_MS に1回まで ──
  // 期限切れが1つも無いまま閾値を超え続けた場合（短時間に大量のキーを
  // 作られた場合）に、呼び出しのたびに全件走査して何も消せない、という
  // CPU の浪費を避ける。
  if (buckets.size >= PURGE_THRESHOLD && (nextPurgeAt.get(buckets) ?? 0) <= now) {
    nextPurgeAt.set(buckets, now + PURGE_INTERVAL_MS);
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    // ハード上限。掃除しても減らない（全部がまだ有効な）ときは、いちばん
    // 古いバケットを1つ捨てて場所を空ける（Map は挿入順に列挙される）。
    // 捨てられたキーの制限は緩むが、新しいキーを拒否する方式だと、キーを
    // 大量に作るだけで全員（ログインを含む）を締め出せてしまう。
    if (!bucket && buckets.size >= MAX_BUCKETS) {
      const oldest = buckets.keys().next();
      if (!oldest.done) buckets.delete(oldest.value);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}
