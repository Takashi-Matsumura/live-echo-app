"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PersonalState, PublicState, ServerEvent } from "@/lib/types";

type LiveStateValue = {
  state: PublicState;
  you: PersonalState;
  /** SSE 接続が生きているか。false の間は直前の描画を保持しつつ再接続中ピルを出す */
  live: boolean;
  /** 投票 Server Action が成功した直後にクライアント側だけで楽観更新する */
  markAnswered: (questionId: string, answer: string) => void;
};

const LiveStateContext = createContext<LiveStateValue | null>(null);

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 10_000;

async function fetchSnapshot(
  view: "participant" | "admin",
): Promise<{ state: PublicState; you: PersonalState } | null> {
  try {
    const res = await fetch(`/api/state?view=${view}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as ServerEvent;
    if (data.kind !== "snapshot") return null;
    return { state: data.state, you: data.you };
  } catch {
    return null;
  }
}

export function LiveStateProvider({
  initialState,
  initialYou,
  view,
  children,
}: {
  initialState: PublicState;
  initialYou: PersonalState;
  /**
   * "/api/stream" 等に渡す view クエリ。le_admin Cookie は path: "/" なので、
   * 講師の端末が参加者用の "/" を開くと isAdmin() は true になる。それだけを
   * role 決定の根拠にすると、参加者ページなのに非公開集計や伏せた回答まで
   * 見えてしまう（実測で確認済みのバグ）。"/" では必ず "participant"、
   * "/admin" と "/present" では "admin" を渡す。
   */
  view: "participant" | "admin";
  children: ReactNode;
}) {
  const [state, setState] = useState(initialState);
  const [you, setYou] = useState(initialYou);
  const [live, setLive] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_MIN_MS);
  const revRef = useRef(initialState.rev);
  const questionIdRef = useRef(initialState.question?.id ?? null);
  // connect() が自分自身（再接続時）を参照するための「常に最新版を指す」ref。
  // useCallback の中で connect を直接自己参照すると、クロージャが古い版を
  // 掴んだまま更新されない問題が起きるため、このパターンで回避する。
  const connectRef = useRef<() => void>(() => {});

  // state は rev の逆行を弾く。you は SSE broadcast に一切乗らない（参加者を
  // 特定する情報を全員に配らないための意図的な設計）ので、フェッチできた
  // ものをそのまま採用する。
  const applySnapshot = useCallback(
    (data: { state: PublicState; you: PersonalState }) => {
      setYou(data.you);
      if (data.state.rev >= revRef.current) {
        revRef.current = data.state.rev;
        questionIdRef.current = data.state.question?.id ?? null;
        setState(data.state);
      }
    },
    [],
  );

  const applyState = useCallback((next: PublicState) => {
    if (next.rev <= revRef.current) return; // 古いフレームは破棄
    revRef.current = next.rev;
    setState(next);

    const nextQuestionId = next.question?.id ?? null;
    if (nextQuestionId !== questionIdRef.current) {
      questionIdRef.current = nextQuestionId;
      // 設問が切り替わった: この接続の "you"（自分の回答状況）は SSE に
      // 乗らないので、新しい設問向けの値を取り直す。
      void fetchSnapshot(view).then((snap) => {
        if (snap) applySnapshot(snap);
      });
    }
  }, [applySnapshot, view]);

  const scheduleReconnect = useCallback((connectFn: () => void) => {
    if (reconnectTimerRef.current) return;
    const delay = reconnectDelayRef.current;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      reconnectDelayRef.current = Math.min(delay * 2, RECONNECT_MAX_MS);
      connectFn();
    }, delay);
  }, []);

  const connect = useCallback(() => {
    esRef.current?.close();

    const es = new EventSource(`/api/stream?view=${view}`);
    esRef.current = es;

    es.addEventListener("snapshot", (event) => {
      try {
        applySnapshot(JSON.parse((event as MessageEvent).data));
      } catch {
        // 壊れたフレームは無視
      }
    });
    es.addEventListener("state", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as { state: PublicState };
        applyState(data.state);
      } catch {
        // 壊れたフレームは無視
      }
    });
    es.addEventListener("open", () => {
      setLive(true);
      reconnectDelayRef.current = RECONNECT_MIN_MS;
    });
    es.onerror = () => {
      setLive(false);
      // EventSource はネットワークエラーなら自前で再接続を試みる。CLOSED
      // （4xx/5xx で開けなかった等）のときだけ手動で張り直す。無条件に
      // new EventSource すると自動再接続と競合して接続が増殖する。
      if (es.readyState === EventSource.CLOSED) {
        scheduleReconnect(() => connectRef.current());
      }
    };
  }, [applySnapshot, applyState, scheduleReconnect, view]);

  useEffect(() => {
    connectRef.current = connect;
    connect();

    const healFromVisibility = () => {
      if (document.visibilityState !== "visible") return;
      // 画面ロック解除など復帰時は、再接続を待たずに即座に画面を治す
      void fetchSnapshot(view).then((snap) => {
        if (snap) applySnapshot(snap);
      });
      if (esRef.current?.readyState === EventSource.CLOSED) {
        connect();
      }
    };
    document.addEventListener("visibilitychange", healFromVisibility);

    return () => {
      document.removeEventListener("visibilitychange", healFromVisibility);
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connect, applySnapshot, view]);

  const markAnswered = useCallback((questionId: string, answer: string) => {
    setYou({ questionId, myAnswer: answer });
  }, []);

  // you は非同期フェッチで届くため、設問切替の直後は一瞬「前の設問の
  // you」が残ったままになりうる。questionId が現在の設問と一致しないうちは
  // 未回答として扱い、前の設問の回答値（選択肢 id が偶然一致するケースを
  // 含む）が新しい設問に漏れないようにする。
  const currentQuestionId = state.question?.id ?? null;
  const effectiveYou: PersonalState =
    you.questionId === currentQuestionId
      ? you
      : { questionId: currentQuestionId, myAnswer: null };

  return (
    <LiveStateContext.Provider
      value={{ state, you: effectiveYou, live, markAnswered }}
    >
      {children}
    </LiveStateContext.Provider>
  );
}

export function useLiveState(): LiveStateValue {
  const ctx = useContext(LiveStateContext);
  if (!ctx) {
    throw new Error("useLiveState は LiveStateProvider の内側でのみ使用できます");
  }
  return ctx;
}
