"use client";

import {
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  memo,
} from "react";
import { Clock3 } from "lucide-react";
import {
  callNextNumber,
  getQueueSnapshot,
  normalizeQueue,
  saveQueueState,
  subscribeQueue,
} from "../../../lib/queue";
import {
  SECTORS, DEFAULT_SECTOR, CALL_TYPES, TYPE_FIELDS, NEWS_CAROUSEL_INTERVAL, HISTORY_LIMITS,
  NO_PASSWORD
} from "../../../lib/constants.js";
import { useQueueEvents } from "../../../lib/hooks/useQueueEvents";
import { useServerClock } from "../../../lib/hooks/useServerClock.js";
import {
  forceAnnounce,
  monitorSpeak,
  registerMonitorSpeaker,
  speakText,
  unlockSpeech,
} from "../../../lib/speech";
import styles from "./Monitor.module.css";

/* ─── notícias ─── */
let newsSnapshot = [];
const serverNewsSnapshot = [];
const monitorServerSnapshot = Object.fromEntries(
  Object.keys(SECTORS).map((key) => [key, { normalCurrent: NO_PASSWORD, priorityCurrent: NO_PASSWORD, history: [] }]),
);
let lastSpokenCallId = null;

function getNewsSnapshot() {
  if (typeof window === "undefined") return serverNewsSnapshot;
  return newsSnapshot;
}
function subscribeNews(cb) {
  window.addEventListener("storage", cb);
  window.addEventListener("news-updated", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("news-updated", cb);
  };
}

function formatMonitorNumber(number) {
  if (number === null || number === undefined) return "---";
  return String(Number(number)).padStart(3, "0");
}

function cleanHistory(history = []) {
  if (!Array.isArray(history)) return [];
  const seen = new Set();
  return history.filter((item) => {
    if (item?.number == null) return false;
    // Deduplica por número+tipo (ignora id pois itens locais não têm id ainda)
    const key = `${item.number}-${item.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ─── carrossel de notícias isolado (evita re-render da voz) ─── */
const NewsCarousel = memo(function NewsCarousel() {
  const news = useSyncExternalStore(
    subscribeNews,
    getNewsSnapshot,
    () => serverNewsSnapshot,
  );
  const [newsIndex, setNewsIndex] = useState(0);

  useEffect(() => {
    fetch("/api/news")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.news?.length) return;
        newsSnapshot = data.news;
        window.dispatchEvent(new Event("news-updated"));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!news?.length) return;
    const t = setInterval(
      () => setNewsIndex((p) => (p + 1) % news.length),
      NEWS_CAROUSEL_INTERVAL,
    );
    return () => clearInterval(t);
  }, [news]);

  if (!news?.length) {
    return (
      <div className={styles.emptyNews}>
        <strong>INFORMAÇÕES DA UNIDADE</strong>
      </div>
    );
  }

  const item = news[newsIndex];
  return (
    <>
      {item?.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image}
          alt={item.title || ""}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}
      <div className={styles.newsCaption}>
        <div className={styles.dots}>
          {news.map((_, i) => (
            <i key={i} className={i === newsIndex ? styles.activeDot : ""} />
          ))}
        </div>
      </div>
    </>
  );
});

/* ══════════════════════════════════════════════
   MONITOR — tela pública de senhas
   Controle via atalhos de teclado / passador
══════════════════════════════════════════════ */
export default function MonitorPage({ params }) {
  const resolvedParams = params ? (params.then ? use(params) : params) : {};
  const sector = resolvedParams?.sector || DEFAULT_SECTOR;

  const state = useSyncExternalStore(
    subscribeQueue,
    getQueueSnapshot,
    () => monitorServerSnapshot,
  );

  // Realtime events via SSE with polling fallback
  const { connected, lastCall } = useQueueEvents(sector);

  const { timeString, dateString } = useServerClock();
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [calling, setCalling] = useState(false);

  /* desbloqueia áudio no primeiro clique/tecla */
  useEffect(() => {
    const unlock = () => {
      unlockSpeech();
      speakText("Som ativado.");
      setAudioEnabled(true);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  /* registra esta aba como alto-falante após áudio desbloqueado */
  useEffect(() => {
    if (!audioEnabled) return;
    return registerMonitorSpeaker();
  }, [audioEnabled]);

  /* Realtime events from SSE/polling hook */
  useEffect(() => {
    if (!lastCall || !sector) return;

    const isRecall = lastCall.isRecall === true;
    const callKey = `${lastCall.id || lastCall.number}-${lastCall.type}`;
    if (!isRecall && lastSpokenCallId === callKey) return;
    lastSpokenCallId = callKey;

    const prev = getQueueSnapshot() || monitorServerSnapshot;
    const queue = prev[sector] || {};

    // Skip stale initial fetch when queue is in "no password" state (post-reset).
    // Initial calls from the API are old DB rows that were not cleared on reset.
    if (lastCall._source === "initial" && queue.normalCurrent === NO_PASSWORD && queue.priorityCurrent === NO_PASSWORD) {
      return;
    }

    const callType = lastCall.type === CALL_TYPES.PREFERENCIAL ? CALL_TYPES.PREFERENCIAL : CALL_TYPES.NORMAL;
    const field = callType === CALL_TYPES.PREFERENCIAL ? TYPE_FIELDS.preferencial : TYPE_FIELDS.normal;

    const currentHistory = queue.history || [];
    const newEntry = {
      id: lastCall.id,
      number: lastCall.number,
      type: callType,
      time: lastCall.time,
    };

    saveQueueState({
      ...prev,
      [sector]: {
        ...queue,
        [field]: lastCall.number,
        history: cleanHistory([newEntry, ...currentHistory]).slice(0, HISTORY_LIMITS.monitor),
      },
    });

    monitorSpeak(lastCall.number, callType);
  }, [lastCall, sector, audioEnabled]);

  /* ─── chamar próxima senha (via teclado / passador) ─── */
  const callNext = useCallback(async (type) => {
    if (calling) return;
    setCalling(true);

    const result = await callNextNumber({ sector, type });

    if (result.ok) {
      forceAnnounce(result.next, result.type);
    }

    setCalling(false);
  }, [calling, sector]);

  /* ─── repetir última senha ─── */
  const reCall = useCallback(() => {
    const q = normalizeQueue((getQueueSnapshot() || monitorServerSnapshot)[sector]);
    const last = q.history[0];
    if (!last) return;
    forceAnnounce(last.number, last.type);
  }, [sector]);

  /* ─── atalhos de teclado ─── */
  useEffect(() => {
    function onKey(e) {
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(e.target.tagName))
        return;

      const k = e.key;
      if (["ArrowRight", "PageDown", "Enter", " "].includes(k)) {
        e.preventDefault();
        callNext(CALL_TYPES.NORMAL);
      } else if (["ArrowLeft", "PageUp"].includes(k)) {
        e.preventDefault();
        callNext(CALL_TYPES.PREFERENCIAL);
      } else if (["ArrowUp", "Home"].includes(k)) {
        e.preventDefault();
        reCall();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [callNext, reCall]);

  /* ─── atalhos de mouse ─── */
  useEffect(() => {
    function onMouseDown(e) {
      // ignora cliques em botões/links
      if (e.target.closest("a, button, input, select, textarea")) return;
      if (e.button === 0) {
        e.preventDefault();
        callNext(CALL_TYPES.NORMAL);
      } else if (e.button === 2) {
        e.preventDefault();
        callNext(CALL_TYPES.PREFERENCIAL);
      }
    }
    function onWheel(e) {
      if (e.target.closest("a, button, input, select, textarea")) return;
      e.preventDefault();
      reCall();
    }
    function onContextMenu(e) {
      // bloqueia o menu de contexto para o botão direito funcionar
      if (!e.target.closest("a, button, input, select, textarea")) {
        e.preventDefault();
      }
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, [callNext, reCall]);

  /* ─── render ─── */
  const info = SECTORS[sector] || SECTORS[DEFAULT_SECTOR];
  const current = state[sector] || monitorServerSnapshot[sector];
  const validHistory = cleanHistory(current.history || []);
  const latest = validHistory[0] || { number: current.normalCurrent ?? NO_PASSWORD, type: CALL_TYPES.NORMAL };
  const recentCalls = validHistory.slice(1, 5);
  const isPriority = latest.type === CALL_TYPES.PREFERENCIAL;
  const hasNoPassword = latest.number === null || latest.number === undefined;

  return (
    <main className={styles.monitor}>
      <header className={styles.header}>
        <div className={styles.sectorTitle}>{info.name.toUpperCase()}</div>
        <div className={styles.heading}>
          <strong>CENTRAL DE ATENDIMENTO</strong>
        </div>
        <div className={styles.headerMeta}>
          <div className={styles.clock}>
            <Clock3 size={18} />
            {timeString}
          </div>
          <div className={styles.date}>
            {dateString}
          </div>
        </div>
      </header>

      <div className={styles.content}>
        <section className={styles.leftColumn}>
          <section
            className={`${styles.featured} ${isPriority ? styles.featuredPriority : ""}`}
          >
            <p>SENHA</p>
            <strong className={hasNoPassword ? styles.noPassword : ""}>
              {formatMonitorNumber(latest?.number ?? NO_PASSWORD)}
            </strong>
            {hasNoPassword ? (
              <span>NENHUMA SENHA CHAMADA</span>
            ) : isPriority ? (
              <span className={styles.priorityTag}>
                ATENDIMENTO PREFERENCIAL
              </span>
            ) : (
              <span>ATENDIMENTO</span>
            )}
            <small>{hasNoPassword ? "Aguardando primeiras chamadas" : "Dirija-se ao balcão de atendimento"}</small>
          </section>

          <section className={styles.recent}>
            <p className={styles.kicker}>ÚLTIMAS SENHAS</p>
            {recentCalls.length > 0 ? (
              recentCalls.map((item, i) => (
                <div
                  className={styles.historyItem}
                  key={`${item.id || item.number}-${item.type}-${i}`}
                >
                  <strong
                    className={
                      item.type === CALL_TYPES.PREFERENCIAL
                        ? styles.priorityNumber
                        : styles.normalNumber
                    }
                  >
                    {formatMonitorNumber(item?.number ?? NO_PASSWORD)}
                  </strong>
                  {item.type === "preferencial" ? (
                    <span className={styles.priorityTagSmall}>
                      PREFERENCIAL
                    </span>
                  ) : (
                    <span className={styles.normal}>ATENDIMENTO</span>
                  )}
                  <time>{item.time}</time>
                </div>
              ))
            ) : (
              <p style={{ fontSize: "14px", color: "#888", marginTop: "12px" }}>
                Nenhuma senha chamada ainda neste setor.
              </p>
            )}
          </section>
        </section>

        <section className={styles.news}>
          <NewsCarousel />
        </section>
      </div>
    </main>
  );
}
