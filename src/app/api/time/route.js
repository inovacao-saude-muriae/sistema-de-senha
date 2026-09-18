/* ─────────────────────────────────────────────────
   GET /api/time
   Retorna o horário atual do servidor em formato ISO 8601 (UTC).
   Usado pelo client para sincronizar relógios e exibir horários
   consistentes independentemente do fuso horário do dispositivo.

   Fluxo de horário:
   1. Servidor retorna UTC ISO via este endpoint
   2. Client sincroniza a cada ~60s (useServerClock hook)
   3. Display formata em America/Sao_Paulo (via Intl.DateTimeFormat)
   4. DB armazena em TIMESTAMPTZ(6) — UTC interno do PostgreSQL
───────────────────────────────────────────────── */
export async function GET() {
  return Response.json({ serverTime: new Date().toISOString() });
}
