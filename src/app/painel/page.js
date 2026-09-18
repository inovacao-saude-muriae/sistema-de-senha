"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  CheckCircle2,
  Monitor,
  RotateCcw,
} from "lucide-react";
import {
  callNextNumber,
  formatQueueNumber,
  getQueueSnapshot,
  getServerQueueSnapshot,
  getServerSessionSnapshot,
  getSessionSnapshot, nextQueueNumber,
  normalizeQueue,
  readQueueState,
  saveQueueState,
  subscribeQueue,
  subscribeSession,
} from "../../lib/queue";
import { SECTORS, ROLES, CALL_TYPES, TYPE_FIELDS, TYPE_LABELS, HISTORY_LIMITS, PAGE_SIZES, DEFAULT_SECTOR, DEFAULT_NAME, KEYBOARD_SHORTCUTS, API_ROUTES } from "../../lib/constants.js";
import { useQueueEvents } from "../../lib/hooks/useQueueEvents";
import { SidebarLayout, sidebarStyles } from "../../components/SidebarLayout/SidebarLayout";
import styles from "./Painel.module.css";

const HISTORY_LIMIT = HISTORY_LIMITS.painel;
const ITEMS_PER_PAGE = PAGE_SIZES.painel;

const emptySubscribe = () => () => {};
function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export default function PainelPage() {
  const router    = useRouter();
  const isClient  = useIsClient();

  const session = useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getServerSessionSnapshot
  );
  const state = useSyncExternalStore(
    subscribeQueue,
    getQueueSnapshot,
    getServerQueueSnapshot
  );

  const [notice, setNotice]       = useState("Pronto para o próximo atendimento");
  const [calling, setCalling]     = useState(false);
  const [activeSector, setActiveSector] = useState(DEFAULT_SECTOR);
  const [historyPage, setHistoryPage] = useState(1);


  useEffect(() => {
    if (session?.role !== ROLES.ADMIN && session?.sector) {
      setActiveSector(session.sector);
    }
  }, [session?.role, session?.sector]);

  useEffect(() => { setHistoryPage(1); }, [activeSector]);

  const current    = normalizeQueue(state[activeSector]);
  const sectorInfo = SECTORS[activeSector] || SECTORS.farmacia;

  const { lastCall } = useQueueEvents(activeSector);
  const lastCallIdRef = useRef(null);

  useEffect(() => {
    const storedSession = getSessionSnapshot();
    if (!storedSession) { router.push("/login"); }
  }, [router]);

  useEffect(() => {
    if (!activeSector) return;
    fetch(`${API_ROUTES.QUEUE_RECENT}?sector=${activeSector}&limit=${HISTORY_LIMIT}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.calls?.length) return;
        const latestState = readQueueState();
        const latest = normalizeQueue(latestState[activeSector]);
        const calls = data.calls.map((c) => ({
          number: c.number,
          type: c.type === CALL_TYPES.PREFERENCIAL || c.type === CALL_TYPES.PREFERENTIAL
            ? CALL_TYPES.PREFERENCIAL : CALL_TYPES.NORMAL,
          time: c.time,
        }));
        const field = calls[0]?.type === CALL_TYPES.PREFERENCIAL
          ? TYPE_FIELDS.preferencial : TYPE_FIELDS.normal;
        saveQueueState({
          ...latestState,
          [activeSector]: {
            ...latest,
            [field]: calls[0]?.number ?? latest[field],
            history: calls.slice(0, HISTORY_LIMIT),
          },
        });
      })
      .catch(() => {});
  }, [activeSector]);

  useEffect(() => {
    if (!lastCall || !activeSector) return;
    const callKey = `${lastCall.id || lastCall.number}-${lastCall.type}`;
    if (lastCallIdRef.current === callKey) return;
    lastCallIdRef.current = callKey;

    const latestState = readQueueState();
    const latest = normalizeQueue(latestState[activeSector]);
    const callType = lastCall.type === CALL_TYPES.PREFERENCIAL ? CALL_TYPES.PREFERENCIAL : CALL_TYPES.NORMAL;
    const field = callType === CALL_TYPES.PREFERENCIAL ? TYPE_FIELDS.preferencial : TYPE_FIELDS.normal;

    if (
      latest.history.length > 0 &&
      latest.history[0].number === lastCall.number &&
      latest.history[0].type === callType
    ) return;

    saveQueueState({
      ...latestState,
      [activeSector]: {
        ...latest,
        [field]: lastCall.number,
        history: [
          { number: lastCall.number, type: callType, time: lastCall.time },
          ...latest.history,
        ].slice(0, HISTORY_LIMIT),
      },
    });
  }, [lastCall, activeSector]);

  const callNext = useCallback(async (type) => {
    if (calling) return;
    setCalling(true);

    const result = await callNextNumber({ sector: activeSector, type });

    if (result.ok) {
      setNotice(type === CALL_TYPES.PREFERENCIAL ? "Senha preferencial chamada" : "Senha normal chamada");
    } else {
      setNotice(result.error);
    }

    setCalling(false);
  }, [calling, activeSector]);

  const reCall = useCallback(async () => {
    const lastItem = current.history[0];
    if (!lastItem) { setNotice("Nenhuma senha anterior para chamar."); return; }
    setNotice("Repetindo chamada...");
    try {
      await fetch(API_ROUTES.QUEUE_RECALL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector: activeSector }),
      });
      setNotice(`Chamando novamente: ${formatQueueNumber(lastItem.number, lastItem.type)}`);
    } catch {
      setNotice("Erro ao repetir chamada.");
    }
  }, [current.history, activeSector]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (KEYBOARD_SHORTCUTS.INPUT_TAGS.includes(event.target.tagName)) return;
      const key          = event.key.toLowerCase();
      const normalCall   = KEYBOARD_SHORTCUTS.NORMAL_CALL.map(k => k.toLowerCase()).includes(key);
      const priorityCall = KEYBOARD_SHORTCUTS.PRIORITY_CALL.map(k => k.toLowerCase()).includes(key);
      const recallCall   = ["b",".",  "f5","escape"].includes(key);
      if (recallCall)   { event.preventDefault(); reCall(); return; }
      if (!normalCall && !priorityCall) return;
      event.preventDefault();
      callNext(priorityCall ? "preferencial" : "normal");
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [callNext, reCall]);

  if (!isClient) return null;

  return (
    <SidebarLayout
      activeRoute="painel"
      session={session}
      sectorInfo={sectorInfo}
      eyebrow="PAINEL DE ATENDIMENTO"
      title={`Olá, ${session?.name || DEFAULT_NAME}`}
      subtitle="Controle as chamadas da sua unidade em tempo real."
      headerActions={
        <>
          {session?.role === ROLES.ADMIN && (
            <select
              className={sidebarStyles.sectorSelect}
              value={activeSector}
              onChange={(e) => setActiveSector(e.target.value)}
            >
              {Object.values(SECTORS).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <Link
            href={`/monitor/${activeSector}`}
            className={sidebarStyles.monitorLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Monitor size={17} /> Abrir monitor
          </Link>
        </>
      }
    >
      <div className={styles.grid} style={{ marginTop: "32px" }}>
        <section className={styles.currentCard}>
          <div className={styles.cardTop}>
            <div>
              <span className={styles.label}>ÚLTIMA SENHA CHAMADA</span>
              <p className={styles.sectorName}>{sectorInfo.name}</p>
            </div>
            <span className={styles.live}><i /> AO VIVO</span>
          </div>
          <div className={styles.queueNumber}>
            {current.history[0]
              ? formatQueueNumber(current.history[0].number, current.history[0].type)
              : formatQueueNumber(null, "normal")}
          </div>
          <p className={styles.callType}>
            {current.history[0]?.type === CALL_TYPES.PREFERENCIAL
              ? "ATENDIMENTO PREFERENCIAL" : "ATENDIMENTO NORMAL"}
          </p>
          <div className={styles.notice}>
            <CheckCircle2 size={18} /> {notice}
          </div>
        </section>

        <section className={styles.actionsCard}>
          <div className={styles.cardTop}>
            <div>
              <span className={styles.label}>PRÓXIMA CHAMADA</span>
              <h2>Escolha o tipo de atendimento</h2>
            </div>
            <span className={styles.counter}>{current.history.length} hoje</span>
          </div>
          <button
            className={styles.normalButton}
            disabled={calling}
            onClick={() => callNext(CALL_TYPES.NORMAL)}
          >
            <span><Bell size={22} /> {calling ? "CHAMANDO..." : "CHAMAR NORMAL"}</span>
            <small>
              Próxima senha: {formatQueueNumber(nextQueueNumber(current.normalCurrent), "normal")}
            </small>
          </button>

          <button
            className={styles.priorityButton}
            disabled={calling}
            onClick={() => callNext(CALL_TYPES.PREFERENCIAL)}
          >
            <span><Bell size={22} /> {calling ? "CHAMANDO..." : "CHAMAR PREFERENCIAL"}</span>
            <small>
              Próxima senha: {formatQueueNumber(nextQueueNumber(current.priorityCurrent), "preferencial")}
            </small>
          </button>

          <button
            className={styles.recallButton}
            disabled={calling}
            onClick={reCall}
          >
            <span><RotateCcw size={22} /> CHAMAR NOVAMENTE</span>
          </button>
        </section>
      </div>

      <section className={styles.recent}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.label}>ÚLTIMAS CHAMADAS</span>
            <h2>Histórico recente</h2>
          </div>
          <Link href="/historico">Ver histórico completo →</Link>
        </div>
        {current.history.length === 0 ? (
          <p className={styles.emptyHistory}>Nenhuma chamada registrada ainda.</p>
        ) : (
          <>
            <div className={styles.table}>
              <div className={styles.tableHead}>
                <span>SENHA</span>
                <span>TIPO</span>
                <span>HORÁRIO</span>
                <span>STATUS</span>
              </div>
              {current.history
                .slice((historyPage - 1) * ITEMS_PER_PAGE, historyPage * ITEMS_PER_PAGE)
                .map((item, index) => (
                  <div
                    className={styles.tableRow}
                    key={`${item.number}-${item.type}-${item.time}-${(historyPage - 1) * ITEMS_PER_PAGE + index}`}
                  >
                    <strong>{formatQueueNumber(item.number, item.type)}</strong>
                    <span className={item.type === CALL_TYPES.PREFERENCIAL ? styles.priorityTag : styles.normalTag}>
                      {item.type === CALL_TYPES.PREFERENCIAL ? TYPE_LABELS.preferencial : TYPE_LABELS.normal}
                    </span>
                    <span>{item.time}</span>
                    <span className={styles.called}><CheckCircle2 size={15} /> Chamada</span>
                  </div>
                ))}
            </div>
            {current.history.length > ITEMS_PER_PAGE && (
              <div className={styles.pagination}>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={historyPage === 1}
                  onClick={() => setHistoryPage((p) => p - 1)}
                >
                  ← Anterior
                </button>
                <span className={styles.pageInfo}>
                  Página {historyPage} de {Math.ceil(current.history.length / ITEMS_PER_PAGE)}
                </span>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={historyPage >= Math.ceil(current.history.length / ITEMS_PER_PAGE)}
                  onClick={() => setHistoryPage((p) => p + 1)}
                >
                  Próxima →
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </SidebarLayout>
  );
}
