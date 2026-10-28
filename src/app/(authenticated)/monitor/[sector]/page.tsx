'use client';

import type { CallType, SectorId } from '@/shared/constants';
import type { NewsListBody } from '@/shared/types/api';
import type { NewsItem } from '@/shared/types/domain';

import { Clock3 } from 'lucide-react';
import {
  memo,
  use,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  forceAnnounce,
  monitorSpeak,
  registerMonitorSpeaker,
  speakText,
  unlockSpeech,
} from '@/client/audio/speech';
import { subscribeNewsChanged } from '@/client/news/news-events';
import {
  callNextNumber,
  cleanHistory,
  getQueueSnapshot,
  normalizeQueue,
  type QueueState,
  reconcileQueueFromCalls,
  saveQueueState,
  subscribeQueue,
} from '@/client/queue/queue';
import { useQueueEvents } from '@/hooks/use-queue-events';
import { useServerClock } from '@/hooks/use-server-clock';
import {
  CALL_TYPES,
  DEFAULT_SECTOR,
  getSector,
  HISTORY_LIMITS,
  isSectorId,
  NEWS_CAROUSEL_INTERVAL,
  NO_PASSWORD,
  SECTORS,
  TYPE_FIELDS,
} from '@/shared/constants';
import { readJson } from '@/shared/json';
import { formatClock } from '@/shared/time';

/* ─── notícias ─── */
let newsSnapshot: NewsItem[] = [];
const serverNewsSnapshot: NewsItem[] = [];
// Mesmo molde de `serverQueueSnapshot` (queue.ts): estado vazio inicial, com
// `historyDate: ""` para o reset de dia tratar como "nada de hoje".
const monitorServerSnapshot: QueueState = Object.fromEntries(
  Object.keys(SECTORS).map((key) => [
    key,
    {
      history: [],
      historyDate: '',
      normalCurrent: NO_PASSWORD,
      priorityCurrent: NO_PASSWORD,
    },
  ]),
);
let lastSpokenCallId: null | string = null;

function formatMonitorNumber(number: null | undefined | number | string) {
  if (number === null || number === undefined) return '---';
  return String(Number(number)).padStart(3, '0');
}
function getNewsSnapshot() {
  if (typeof window === 'undefined') return serverNewsSnapshot;
  return newsSnapshot;
}

/**
 * Busca a lista de ativas e publica o snapshot.
 *
 * Chamado no mount e quando o admin avisa (outra aba) que publicou/arquivou
 * algo — sem isso, o carrossel só mudava ao recarregar a página.
 */
function refreshNews() {
  fetch('/api/news')
    .then((response) => (response.ok ? readJson<NewsListBody>(response) : null))
    .then((data) => {
      if (!data?.news) return;
      newsSnapshot = data.news;
      window.dispatchEvent(new Event('news-updated'));
    })
    .catch(() => {});
}

function subscribeNews(cb: () => void) {
  window.addEventListener('news-updated', cb);
  return () => {
    window.removeEventListener('news-updated', cb);
  };
}

/* ─── carrossel de notícias isolado (evita re-render da voz) ─── */
const NewsCarousel = memo(() => {
  const news = useSyncExternalStore(
    subscribeNews,
    getNewsSnapshot,
    () => serverNewsSnapshot,
  );
  const [newsIndex, setNewsIndex] = useState(0);

  useEffect(() => {
    refreshNews();
    return subscribeNewsChanged(refreshNews);
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
      <div className="relative z-1 flex h-full flex-col items-center justify-center p-[4vw] text-[#173b51]">
        <strong className="mt-2 block max-w-[850px] text-[clamp(20px,3vw,48px)] leading-[1.1] text-[#173b51]">
          INFORMAÇÕES DA UNIDADE
        </strong>
      </div>
    );
  }

  // A lista pode encolher (inativação em outra aba) antes do próximo tick do
  // intervalo; o módulo evita índice fora do array.
  const safeIndex = newsIndex % news.length;
  const item = news[safeIndex];
  return (
    <>
      {item?.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image}
          alt={item.title || ''}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      <div className="relative z-1 w-full p-6 text-white">
        <div className="flex gap-[7px]">
          {news.map((_, i) => (
            <i
              key={i}
              className={
                i === safeIndex
                  ? 'h-2 w-6 rounded-[5px] bg-[#8fe2d2]'
                  : 'size-2 rounded-[50%] bg-[#ffffff66]'
              }
            />
          ))}
        </div>
      </div>
    </>
  );
});

NewsCarousel.displayName = 'NewsCarousel';

export default function MonitorPage({ params }: MonitorPageProps) {
  // `[sector]` é segmento não validado da URL: um valor fora de SECTORS cai no
  // setor padrão (em vez de derrubar `state[sector]`) e é isso que entrega ao
  // TS o `SectorId` que `useQueueEvents` exige.
  const resolvedParams = use(params);
  const sector: SectorId = isSectorId(resolvedParams.sector)
    ? resolvedParams.sector
    : DEFAULT_SECTOR;

  const state = useSyncExternalStore(
    subscribeQueue,
    getQueueSnapshot,
    () => monitorServerSnapshot,
  );

  // Realtime events via SSE with polling fallback
  const { calls, lastCall } = useQueueEvents(sector);

  const { dateString, timeString } = useServerClock();
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [calling, setCalling] = useState(false);

  /* desbloqueia áudio no primeiro clique/tecla */
  useEffect(() => {
    const unlock = () => {
      unlockSpeech();
      speakText('Som ativado.');
      setAudioEnabled(true);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
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

    const callType =
      lastCall.type === CALL_TYPES.PREFERENCIAL
        ? CALL_TYPES.PREFERENCIAL
        : CALL_TYPES.NORMAL;
    const field =
      callType === CALL_TYPES.PREFERENCIAL
        ? TYPE_FIELDS.preferencial
        : TYPE_FIELDS.normal;

    const currentHistory = queue.history || [];
    const newEntry = {
      id: lastCall.id,
      number: lastCall.number,
      time: formatClock(lastCall.createdAt),
      type: callType,
      createdAt: lastCall.createdAt,
    };

    saveQueueState({
      ...prev,
      [sector]: {
        ...queue,
        [field]: lastCall.number,
        history: cleanHistory([newEntry, ...currentHistory]).slice(
          0,
          HISTORY_LIMITS.monitor,
        ),
      },
    });

    monitorSpeak(lastCall.number, callType);
  }, [lastCall, sector, audioEnabled]);

  /*
   * Reconcile against the server's portrait — the monitor has no fetch of its
   * own, so this is how it restores history after a reload.
   *
   * Deliberately declared *after* the live effect and deliberately silent: it
   * must never reach `monitorSpeak`, or a monitor reboot would announce an old
   * password. Idempotent, so re-running it on every snapshot change is safe.
   */
  useEffect(() => {
    if (!sector || calls == null) return;
    reconcileQueueFromCalls(sector, calls, {
      historyLimit: HISTORY_LIMITS.monitor,
    });
  }, [calls, sector]);

  /* ─── chamar próxima senha (via teclado / passador) ─── */
  const callNext = useCallback(
    async (type: CallType) => {
      if (calling) return;
      setCalling(true);

      const result = await callNextNumber({ sector, type });

      if (result.ok) {
        forceAnnounce(result.next, result.type);
      }

      setCalling(false);
    },
    [calling, sector],
  );

  /* ─── repetir última senha ─── */
  const reCall = useCallback(() => {
    const q = normalizeQueue(
      (getQueueSnapshot() || monitorServerSnapshot)[sector],
    );
    const last = q.history[0];
    if (!last) return;
    forceAnnounce(last.number, last.type);
  }, [sector]);

  /* ─── atalhos de teclado ─── */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // `e.target` é `EventTarget | null` — sem o `instanceof` não há `tagName`.
      if (
        e.target instanceof HTMLElement &&
        ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)
      )
        return;

      const k = e.key;
      if ([' ', 'ArrowRight', 'Enter', 'PageDown'].includes(k)) {
        e.preventDefault();
        void callNext(CALL_TYPES.NORMAL);
      } else if (['ArrowLeft', 'PageUp'].includes(k)) {
        e.preventDefault();
        void callNext(CALL_TYPES.PREFERENCIAL);
      } else if (['ArrowUp', 'Home'].includes(k)) {
        e.preventDefault();
        reCall();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [callNext, reCall]);

  /* ─── atalhos de mouse ─── */
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      e.preventDefault();
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
    }

    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
    }

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('contextmenu', onContextMenu);

    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, [callNext, reCall]);

  /* ─── render ─── */
  const info = getSector(sector) || SECTORS[DEFAULT_SECTOR];
  const current = state[sector] || monitorServerSnapshot[sector];

  // A exibição sai do INSTANTE, em BRT. As entradas legadas do
  // `localStorage` (sem `createdAt`) usam o `time` já gravado.
  const validHistory = cleanHistory(current.history || []).map((h) => ({
    ...h,
    time: h.createdAt ? formatClock(h.createdAt) : (h.time ?? '—'),
  }));

  const latest = validHistory[0] || {
    number: current.normalCurrent ?? NO_PASSWORD,
    type: CALL_TYPES.NORMAL,
  };
  const recentCalls = validHistory.slice(1, 5);
  const isPriority = latest.type === CALL_TYPES.PREFERENCIAL;
  const hasNoPassword = latest.number === null || latest.number === undefined;

  return (
    <main className="grid h-dvh w-screen grid-rows-[88px_1fr] overflow-hidden bg-[#f5f8f9] text-[#173b51] max-[900px]:block max-[900px]:h-auto max-[900px]:min-h-screen max-[900px]:overflow-auto">
      {/* `grid-cols-2` do Tailwind é `minmax(0,1fr)` e corta o header nos
          220/220; o `1fr 1fr` antigo expandia a coluna do relógio com o
          conteúdo nowrap (260px) e encolhia a do setor. */}
      <header className="grid h-[88px] w-full grid-cols-[1fr_2fr_1fr] items-center bg-[#004066] px-[3vw] text-white max-[900px]:h-[72px] max-[900px]:grid-cols-[1fr_1fr] max-[900px]:px-5">
        <div className="text-[clamp(16px,2vw,28px)] font-extrabold tracking-[1.5px] max-[500px]:text-[14px]">
          {info.name.toUpperCase()}
        </div>
        <div className="text-center max-[900px]:hidden">
          <strong className="text-[clamp(22px,3.1vw,44px)] tracking-[3px] whitespace-nowrap">
            CENTRAL DE ATENDIMENTO
          </strong>
        </div>
        <div className="justify-self-end text-right">
          {/* O `@media (max-width: 500px)` antigo reduzia o .clock para 13px,
              mas perdia em especificidade para `.headerMeta .clock` (18px) —
              o efeito real nunca foi o de 13px. */}
          <div className="flex items-center gap-2 justify-self-end text-[18px]">
            <Clock3 size={18} />
            {timeString || '--:--:--'}
          </div>
          <div className="mt-1 text-[10px] font-bold tracking-[1px] whitespace-nowrap text-[#c5dce5] max-[420px]:text-[9px] max-[420px]:leading-tight max-[420px]:whitespace-normal">
            {dateString}
          </div>
        </div>
      </header>

      <div className="grid size-full min-h-0 grid-cols-[40%_60%] max-[900px]:flex max-[900px]:h-auto max-[900px]:flex-col">
        <section className="grid h-full min-h-0 grid-rows-[62%_38%] max-[900px]:flex max-[900px]:h-auto max-[900px]:flex-col">
          <section
            className={`box-border flex h-full min-h-0 flex-col items-center justify-center border-r border-current border-r-[#cadde2] p-3 ${
              isPriority ? 'bg-[#fff7f7]' : 'bg-white'
            } max-[900px]:h-auto max-[900px]:min-h-[320px]`}
          >
            <p className="mb-[5px] text-[13px] tracking-[5px] text-[#78909c]">
              SENHA
            </p>
            <strong
              className={`text-[clamp(110px,12vw,240px)] leading-none tracking-[5px] ${(() => {
                if (hasNoPassword) return 'text-[#b0bec5]';
                if (isPriority) return 'text-[#d63838]';
                return 'text-[#1972a0]';
              })()} max-[500px]:text-[88px]`}
            >
              {formatMonitorNumber(latest?.number ?? NO_PASSWORD)}
            </strong>
            {(() => {
              if (hasNoPassword)
                return (
                  <span className="mt-3 text-[14px] font-extrabold tracking-[1.5px] text-[#1972a0]">
                    NENHUMA SENHA CHAMADA
                  </span>
                );
              if (isPriority)
                return (
                  <span className="mt-2 inline-block rounded-[12px] bg-[#ef4444] px-6 py-[10px] text-[1.2rem] font-extrabold tracking-[1.5px] text-white shadow-[0_4px_10px_rgba(239,68,68,0.3)]">
                    ATENDIMENTO PREFERENCIAL
                  </span>
                );
              return (
                <span className="mt-3 text-[14px] font-extrabold tracking-[1.5px] text-[#1972a0]">
                  ATENDIMENTO
                </span>
              );
            })()}
            <small className="mt-2 text-[11px] text-[#8aa0ab]">
              {hasNoPassword
                ? 'Aguardando primeiras chamadas'
                : 'Dirija-se ao balcão de atendimento'}
            </small>
          </section>

          <section className="box-border h-full min-h-0 overflow-hidden border-r border-current border-r-[#cadde2] bg-[#f8fbfc] px-[3vw] pt-4 pb-3 max-[900px]:h-auto max-[900px]:min-h-[280px]">
            <p className="mb-2 text-[10px] font-extrabold tracking-[2px] text-[#178c7c]">
              ÚLTIMAS SENHAS
            </p>
            {recentCalls.length > 0 ? (
              // O JS já fatia em 4 itens (`slice(1, 5)`) — o CSS antigo escondia o 5º+.
              recentCalls.map((item, i) => (
                <div
                  className="grid grid-cols-[1fr_1.5fr_0.6fr] items-center border-b border-b-[#dce8eb] py-2 text-[#668390]"
                  key={`${item.id || item.number}-${item.type}-${i}`}
                >
                  <strong
                    className={`text-[clamp(25px,2.6vw,42px)] tracking-[2px] ${
                      item.type === CALL_TYPES.PREFERENCIAL
                        ? 'text-[#d63838]'
                        : 'text-[#1972a0]'
                    }`}
                  >
                    {formatMonitorNumber(item?.number ?? NO_PASSWORD)}
                  </strong>
                  {item.type === 'preferencial' ? (
                    <span className="inline-block rounded-[8px] bg-[#ef4444] px-3 py-1 text-center text-[10px] font-extrabold tracking-[1px] text-white">
                      PREFERENCIAL
                    </span>
                  ) : (
                    <span className="text-[10px] font-extrabold tracking-[1px] text-[#1972a0]">
                      ATENDIMENTO
                    </span>
                  )}
                  <time className="text-right text-[11px]">{item.time}</time>
                </div>
              ))
            ) : (
              <p className="mt-3 text-[14px] text-[#888]">
                Nenhuma senha chamada ainda neste setor.
              </p>
            )}
          </section>
        </section>

        <section className="relative flex size-full min-h-0 items-end overflow-hidden border-current bg-[#dce9eb] after:absolute after:inset-[40%_0_0] after:bg-[linear-gradient(transparent,#092f43dc)] after:content-[''] max-[900px]:order-first max-[900px]:h-[420px]">
          <NewsCarousel />
        </section>
      </div>
    </main>
  );
}

/* ══════════════════════════════════════════════
   MONITOR — tela pública de senhas
   Controle via atalhos de teclado / passador
══════════════════════════════════════════════ */
interface MonitorPageProps {
  /** App Router entrega `params` como `Promise` (Next 15+). */
  readonly params: Promise<{ readonly sector: string }>;
}
