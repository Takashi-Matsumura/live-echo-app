"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveState } from "@/components/live-state-provider";

export type Materials = {
  readonly url: string;
  readonly label: string | null;
  readonly qrSvg: string;
};

async function fetchMaterials(view: "participant" | "admin"): Promise<Materials | null> {
  try {
    // view の明示は必須 ── components/participant-screen.tsx の
    // fetchPastResult と同じ理由。le_admin Cookie を持つ端末（講師の
    // スマホ、components/phone-preview.tsx の iframe）が参加者用の "/" を
    // 開いたときも、参加者と同じゲートを通す。
    const res = await fetch(`/api/materials?view=${view}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Materials;
  } catch {
    return null;
  }
}

/**
 * 研修資料の取得。実際のアクセス制御はサーバー側
 * （lib/session/projection.ts の materialsFor）にあり、ここは「いつ
 * 取得し直すか」だけを判断する。
 *
 * エフェクトを2本持つ:
 * 1. 権威エフェクト ── マウント時と state.materialsRevealed の変化時に
 *    取得し、結果をそのまま採用する（404 なら null に戻す）。講師が
 *    公開すると全員に即座に出て、取り消すと未回答者からは消える。
 * 2. 日和見エフェクト ── まだ資料が無い間だけ、you.myAnswer が非 null に
 *    なった瞬間（＝今の設問に回答した直後）に取得し、非 null のときだけ
 *    採用する（404 では既存表示を消さない）。これが「回答直後にリロード
 *    なしで出る」の本体 ── ゲート設問がどれかをクライアントに教える
 *    必要が無く、投票フォーム側は無変更で済む。
 *
 * 既知の制限: 一度 URL を受け取った端末のメモリからは、講師が公開を
 * 取り消してもこの関数だけでは消せない（次に権威エフェクトが走るまで
 * 残る）。「URL を一度配ったら取り消せない」という現実そのものなので
 * 受け入れる。
 */
export function useMaterials(view: "participant" | "admin"): Materials | null {
  const { state, you } = useLiveState();
  const [materials, setMaterials] = useState<Materials | null>(null);
  // 取得中に状態が変わった／アンマウントされた場合に、古い fetch の結果で
  // 上書きしないための採番ガード（components/participant-screen.tsx の
  // pastRequestIdRef と同じパターン）。
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = (requestIdRef.current += 1);
    void fetchMaterials(view).then((result) => {
      if (requestIdRef.current !== requestId) return;
      setMaterials(result);
    });
    // state.materialsRevealed は boolean なので、依存配列に含めるだけで
    // 「公開された／取り消された」の変化のたびに再取得される。
  }, [view, state.materialsRevealed]);

  useEffect(() => {
    if (materials !== null) return; // 既に資料を持っていれば空振りしない
    if (you.myAnswer === null) return;
    const requestId = (requestIdRef.current += 1);
    void fetchMaterials(view).then((result) => {
      if (requestIdRef.current !== requestId) return;
      if (result === null) return; // 404: このエフェクトは表示を消さない
      setMaterials(result);
    });
  }, [view, materials, you.myAnswer]);

  return materials;
}
