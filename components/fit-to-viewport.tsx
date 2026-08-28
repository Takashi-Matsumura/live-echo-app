"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * 子要素を「自然な（clamp() 等で決まる本来の）サイズ」でレンダーしたうえで、
 * 親の高さに収まらないときだけ transform: scale() で一様に縮小する。
 *
 * ★なぜこれが要るか: /present は「見せ場をできるだけ大きく」表示したい一方、
 * 選択肢の数や自由記述の件数は設問ごとに変わる。clamp() はビューポート幅
 * だけを見て文字・バーのサイズを決めるため、選択肢が多い設問では縦に
 * 収まりきらずスクロールが発生してしまう（投影画面はスクロール厳禁 —
 * cursor:none の「見せるだけ」画面で、操作してスクロールさせる前提が無い）。
 *
 * 「収まるなら等倍・大きいまま、収まらなければ丸ごと縮小」という一様スケール
 * 戦略にすることで、内容量に関わらず必ず1画面に収まる。
 *
 * 仕組み: 子を包む要素の scrollHeight（自然な高さ）と、親コンテナの
 * clientHeight（使える高さ）を比較し、はみ出す分だけ scale を掛ける。
 * transform はレイアウト（scrollHeight 等）に影響しないため、縮小後に
 * 再計測しても値が変わり続けるフィードバックループにはならない。
 * ResizeObserver で両方の要素を監視し、設問の切り替え・回答数の増減・
 * ウィンドウリサイズのいずれでも追従する。
 */
export function FitToViewport({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const recompute = () => {
      const availableHeight = container.clientHeight;
      const naturalHeight = content.scrollHeight;
      if (availableHeight === 0 || naturalHeight === 0) return;
      const next = Math.min(1, availableHeight / naturalHeight);
      // 誤差程度の変動で毎回 setState するとチラつくので閾値を設ける。
      setScale((prev) => (Math.abs(prev - next) > 0.005 ? next : prev));
    };

    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    observer.observe(content);
    return () => observer.disconnect();
    // ResizeObserver 自体が以後のサイズ変化（設問切替・回答数の増減・
    // ウィンドウリサイズ）をすべて拾うため、mount 時に1度だけ購読すれば
    // 十分（依存配列を空にする）。
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden"
    >
      <div
        ref={contentRef}
        style={{ transform: `scale(${scale})`, transformOrigin: "center" }}
        className="motion-safe:transition-transform motion-safe:duration-300"
      >
        {children}
      </div>
    </div>
  );
}
