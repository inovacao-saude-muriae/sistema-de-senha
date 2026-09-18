"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  LOCALE,
  APP_TIMEZONE,
  CLOCK_INTERVAL,
  SERVER_TIME_SYNC_INTERVAL,
  API_ROUTES,
} from "../constants.js";

/* ─────────────────────────────────────────────────
   useServerClock — relógio sincronizado com o servidor

   Fluxo de horário:
   1. Na montagem, busca GET /api/time para obter UTC do servidor
   2. Calcula offset = serverTime - Date.now() (diferença entre servidor e device)
   3. A cada SERVER_TIME_SYNC_INTERVAL (60s), recalcula o offset
   4. A cada CLOCK_INTERVAL (1s), exibe horário interpolado usando offset
   5. Formata em America/Sao_Paulo via Intl.DateTimeFormat
   6. Se servidor indisponível, fallback para horário local (offset = 0)

   Isso garante que:
   - O horário exibido é sempre o horário do servidor (consistente entre dispositivos)
   - O display mostra America/Sao_Paulo independente do fuso do device
   - Não há chamadas excessivas ao servidor (apenas a cada 60s)
   - O relógio continua fluido entre sincronizações (interpolação local)
───────────────────────────────────────────────── */

function formatInTimezone(date, options) {
  return new Intl.DateTimeFormat(LOCALE, {
    ...options,
    timeZone: APP_TIMEZONE,
  }).format(date);
}

function formatTime(date) {
  return formatInTimezone(date, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDate(date) {
  return formatInTimezone(date, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).toUpperCase();
}

function formatTimeShort(date) {
  return formatInTimezone(date, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function fetchServerTime() {
  const res = await fetch(API_ROUTES.TIME, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch server time");
  const data = await res.json();
  return new Date(data.serverTime).getTime();
}

export function useServerClock() {
  const offsetRef = useRef(0);
  const syncedRef = useRef(false);
  const [now, setNow] = useState(() => new Date());
  const [synced, setSynced] = useState(false);

  const syncWithServer = useCallback(async () => {
    try {
      const serverMs = await fetchServerTime();
      const localMs = Date.now();
      offsetRef.current = serverMs - localMs;
      syncedRef.current = true;
      setSynced(true);
    } catch {
      offsetRef.current = 0;
      syncedRef.current = false;
      setSynced(false);
    }
  }, []);

  useEffect(() => {
    // Sync inicial via microtask para evitar setState síncrono no effect
    Promise.resolve().then(syncWithServer);

    const syncTimer = setInterval(syncWithServer, SERVER_TIME_SYNC_INTERVAL);
    const displayTimer = setInterval(() => {
      setNow(new Date(Date.now() + offsetRef.current));
    }, CLOCK_INTERVAL);

    return () => {
      clearInterval(syncTimer);
      clearInterval(displayTimer);
    };
  }, [syncWithServer]);

  return {
    now,
    synced,
    timeString: formatTime(now),
    dateString: formatDate(now),
    timeShort: formatTimeShort(now),
    formatTime: formatTimeShort,
  };
}
