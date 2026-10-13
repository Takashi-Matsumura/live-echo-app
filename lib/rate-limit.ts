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
  // バケットをまとめて捨てる（毎回走査しないための閾値）。
  if (buckets.size >= PURGE_THRESHOLD) {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}
