"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  POLLING_INTERVAL,
  SSE_BACKOFF_BASE,
  SSE_BACKOFF_MAX,
  SSE_EVENT_TYPES,
  API_ROUTES,
  DEFAULT_RECENT_LIMIT,
} from "../constants.js";

/**
 * Hook for realtime queue events with SSE and automatic polling fallback.
 * Handles initial sync, auto-reconnection, and stays synchronized.
 *
 * @param {'farmacia'|'recepcao'|null} sector
 * @returns {{ connected: boolean, lastCall: { id:string, number:number, type:string, time:string } | null }}
 */
export function useQueueEvents(sector) {
  const [connected, setConnected] = useState(false);
  const [lastCall, setLastCall] = useState(null);

  const eventSourceRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const retryCountRef = useRef(0);
  const lastCallIdRef = useRef(null);
  const mountedRef = useRef(true);
  const sectorRef = useRef(sector);
  const connectSSERef = useRef(null);

  // Keep sectorRef in sync via effect
  useEffect(() => {
    sectorRef.current = sector;
  }, [sector]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Start polling fallback
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;

    pollIntervalRef.current = setInterval(async () => {
      if (!mountedRef.current || !sectorRef.current) return;

      try {
        const res = await fetch(
          `${API_ROUTES.QUEUE_RECENT}?sector=${sectorRef.current}&limit=5`,
        );
        if (!res.ok) return;

        const data = await res.json();
        if (data.calls?.[0] && data.calls[0].id !== lastCallIdRef.current) {
          lastCallIdRef.current = data.calls[0].id;
          if (mountedRef.current) {
            setLastCall(data.calls[0]);
          }
        }
      } catch {
        // Silently ignore polling errors
      }
    }, POLLING_INTERVAL);
  }, []);

  // Connect to SSE with auto-reconnect
  const connectSSE = useCallback(() => {
    if (!mountedRef.current || !sectorRef.current) return;

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      const es = new EventSource(
        `${API_ROUTES.QUEUE_EVENTS}?sector=${sectorRef.current}`,
      );
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!mountedRef.current) return;
        setConnected(true);
        retryCountRef.current = 0; // Reset backoff
        stopPolling(); // Stop polling if SSE connects
      };

      es.onmessage = (e) => {
        if (!mountedRef.current) return;

        try {
          const data = JSON.parse(e.data);
          if (data.type === SSE_EVENT_TYPES.CALL && data.call) {
            lastCallIdRef.current = data.call.id;
            setLastCall(data.call);
          } else if (data.type === SSE_EVENT_TYPES.RECALL && data.call) {
            lastCallIdRef.current = data.call.id;
            setLastCall({ ...data.call, isRecall: true });
          }
        } catch {
          // Ignore parse errors
        }
      };

      es.onerror = () => {
        if (!mountedRef.current) return;

        es.close();
        setConnected(false);

        // Start polling as fallback
        startPolling();

        // Schedule reconnection with exponential backoff
        const delay = Math.min(
          SSE_BACKOFF_BASE * Math.pow(2, retryCountRef.current),
          SSE_BACKOFF_MAX,
        );
        retryCountRef.current++;

        setTimeout(() => {
          if (
            mountedRef.current &&
            (!eventSourceRef.current ||
              eventSourceRef.current.readyState === EventSource.CLOSED)
          ) {
            connectSSERef.current?.();
          }
        }, delay);
      };
    } catch {
      // EventSource not supported or other error
      startPolling();
    }
  }, [stopPolling, startPolling]);

  // Keep connectSSERef in sync
  useEffect(() => {
    connectSSERef.current = connectSSE;
  }, [connectSSE]);

  // Initial sync on mount
  useEffect(() => {
    if (!sector) return;

    async function fetchInitial() {
      try {
        const res = await fetch(`${API_ROUTES.QUEUE_RECENT}?sector=${sector}&limit=${DEFAULT_RECENT_LIMIT}`);
        if (!res.ok) return;

        const data = await res.json();
        if (data.calls?.length && mountedRef.current) {
          lastCallIdRef.current = data.calls[0].id;
          setLastCall({ ...data.calls[0], _source: "initial" });
        }
      } catch {
        // Ignore initial sync errors
      }
    }

    fetchInitial();
  }, [sector]);

  // SSE connection management
  useEffect(() => {
    if (!sector) return;

    mountedRef.current = true;
    connectSSE();

    return () => {
      mountedRef.current = false;

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      stopPolling();
    };
  }, [sector, connectSSE, stopPolling]);

  return { connected, lastCall };
}
