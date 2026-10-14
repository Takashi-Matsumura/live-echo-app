/**
 * ごく単純な固定窓レートリミッタ。純粋関数として実装し、バケットの Map は
 * 呼び出し側が持つ（Workers はモジュールスコープの状態を複数 isolate 間で
 * 共有できないため、状態を持つ場所は呼び出し側に委ねる設計にしてある。
 * 将来 Durable Object に移す際は、この Map を DO のインスタンスフィールドに
 * すればそのまま使える）。
 */
type RateLimitBucket = { count: number; resetAt: number };
export type RateLimitBuckets = Map<string, RateLimitBucket>;

/** limit 回/windowMs を超えたら false を返す */
export function checkRateLimit(
  buckets: RateLimitBuckets,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** 期限切れのバケットを取り除く（Map が際限なく伸びないようにする）。 */
export function pruneExpired(buckets: RateLimitBuckets, now = Date.now()): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** ストレージから読んだバケット一覧（[key, bucket] の配列）を検証して Map に戻す。 */
export function parsePersistedBuckets(raw: unknown): RateLimitBuckets {
  const buckets: RateLimitBuckets = new Map();
  if (!Array.isArray(raw)) return buckets;
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [key, bucket] = entry as [unknown, unknown];
    if (typeof key !== "string" || typeof bucket !== "object" || bucket === null) continue;
    const { count, resetAt } = bucket as Record<string, unknown>;
    if (typeof count !== "number" || typeof resetAt !== "number") continue;
    buckets.set(key, { count, resetAt });
  }
  return buckets;
}
