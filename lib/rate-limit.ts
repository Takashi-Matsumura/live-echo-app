/**
 * ごく単純な in-memory 固定窓レートリミッタ。単一プロセス前提（next start）。
 * ログイン試行と投票の両方から使う。
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** limit 回/windowMs を超えたら false を返す */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
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

// 期限切れバケットを間引く（50人規模では無視できる量だが、長時間稼働に備えて）
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000);
sweepTimer.unref?.();
