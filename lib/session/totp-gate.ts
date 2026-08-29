// TOTP は6桁（100万通り）なのでパスワードよりブルートフォース耐性が低い。
// lib/session/session-do.ts の loginBuckets と違いインスタンスフィールドの
// in-memory カウンタにはしない ── DO は購読者ゼロで短時間退避するため、
// in-memory だと「数回試す→退避を待つ→また数回」というペーシング攻撃で
// カウンタが初期化されてしまい、6桁コードの防御として実質機能しない。
// ctx.storage（SQLite）に永続化する。
const TOTP_FAIL_LIMIT = 10;
const TOTP_FAIL_WINDOW_MS = 15 * 60_000;
const TOTP_STORAGE_KEY = "totp";

/** TOTP の登録・照合状態。1レコードのみ持つ（管理者は1人の前提）。 */
type TotpRecord = {
  /** 直近で登録/照合に成功したシークレットの指紋。現在の env.TOTP_SECRET の
   *  指紋と一致していれば「登録済み」とみなす（不一致ならシークレットが
   *  ローテーションされた、または未登録）。 */
  readonly secretFingerprint: string;
  /** リプレイ防止（RFC 6238 §5.2）。成功のたびに更新し、同じか過去の
   *  ステップの再送を拒否する。 */
  readonly lastUsedStep: number;
  readonly failCount: number;
  readonly failWindowResetAt: number;
};

function isTotpRecord(value: unknown): value is TotpRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.secretFingerprint === "string" &&
    typeof v.lastUsedStep === "number" &&
    typeof v.failCount === "number" &&
    typeof v.failWindowResetAt === "number"
  );
}

/**
 * 管理画面ログインの第2要素（TOTP、RFC 6238）の登録状態・レート制限を
 * ctx.storage に永続化する（lib/session/session-do.ts の SessionDO から
 * 使う。DO 1インスタンスにつき1つ生成する）。管理者は1人の前提なので、
 * レコードは currentFingerprint に対するグローバルな1件だけを持つ
 * （IPごとの枠は設けない。第2要素の総当り対策としてはグローバル1枠の方が
 * 「攻撃元を分散されると意味がなくなる」問題が無く、シンプルで頑健）。
 */
export class TotpGate {
  constructor(private readonly storage: DurableObjectStorage) {}

  private async read(): Promise<TotpRecord | null> {
    const raw = await this.storage.get<unknown>(TOTP_STORAGE_KEY);
    return isTotpRecord(raw) ? raw : null;
  }

  /** ログイン画面に「未登録（QR表示）」か「登録済み（コード入力のみ）」の
   *  どちらを見せるか、および現在ロックアウト中かを判定する。 */
  async getGate(
    currentFingerprint: string,
  ): Promise<{ registered: boolean; lockedOut: boolean }> {
    const record = await this.read();
    if (!record) return { registered: false, lockedOut: false };
    const lockedOut =
      record.failWindowResetAt > Date.now() && record.failCount >= TOTP_FAIL_LIMIT;
    return { registered: record.secretFingerprint === currentFingerprint, lockedOut };
  }

  /**
   * 1回のTOTP照合結果を記録する。成功時はこのメソッドが唯一の書き込み
   * 経路になる（登録の確定＝通常ログインの成功、どちらもここで扱う）。
   * ★ await を挟まないので、同時に飛んできた2リクエストでも判定と書き込みが
   * アトミックになる（SessionDO の castVote 等と同じDOの不変条件 ──
   * この呼び出し自体は Durable Object のシングルスレッド実行の中でのみ
   * この保証が成り立つ。呼び出し元は SessionDO のメソッドに限る）。
   */
  async recordAttempt(
    currentFingerprint: string,
    outcome: { ok: true; step: number } | { ok: false },
  ): Promise<{ accepted: boolean }> {
    const now = Date.now();
    const existing = await this.read();
    const windowActive = !!existing && existing.failWindowResetAt > now;
    const failCount = windowActive ? existing!.failCount : 0;
    const failWindowResetAt = windowActive ? existing!.failWindowResetAt : now + TOTP_FAIL_WINDOW_MS;

    if (failCount >= TOTP_FAIL_LIMIT) {
      // ロックアウト中。getGate 側で弾かれているはずだが、念のため
      // ここでも二重にガードする。
      return { accepted: false };
    }

    const isReplay =
      outcome.ok &&
      existing?.secretFingerprint === currentFingerprint &&
      outcome.step <= existing.lastUsedStep;

    if (!outcome.ok || isReplay) {
      const next: TotpRecord = {
        secretFingerprint: existing?.secretFingerprint ?? "",
        lastUsedStep: existing?.lastUsedStep ?? -1,
        failCount: failCount + 1,
        failWindowResetAt,
      };
      await this.storage.put(TOTP_STORAGE_KEY, next);
      return { accepted: false };
    }

    // 成功（登録の確定 or 通常ログイン）。失敗カウンタはリセットする。
    const next: TotpRecord = {
      secretFingerprint: currentFingerprint,
      lastUsedStep: outcome.step,
      failCount: 0,
      failWindowResetAt: now + TOTP_FAIL_WINDOW_MS,
    };
    await this.storage.put(TOTP_STORAGE_KEY, next);
    return { accepted: true };
  }
}
