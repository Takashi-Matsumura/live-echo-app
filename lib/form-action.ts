/**
 * <form action> は戻り値を void として扱う型になっている（戻り値を読みたい
 * 場合は useActionState 経由が前提）。ここでは JS 無効時のネイティブ送信
 * フォールバック用に action を渡すだけなので、戻り値を捨てる薄いラッパーで
 * 型を合わせる。JS 有効時は元の action を直接 await して戻り値を使う。
 */
export function asFormAction<T>(
  action: (formData: FormData) => Promise<T>,
): (formData: FormData) => Promise<void> {
  return async (formData: FormData) => {
    await action(formData);
  };
}
