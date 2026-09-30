import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const monitorPath = resolve(__dirname, "../../../src/app/monitor/[sector]/page.js");
const monitorCode = readFileSync(monitorPath, "utf-8");

describe("Monitor page — audio on SSE events", () => {
  it("chama monitorSpeak ao receber lastCall sem condicionar a audioEnabled", () => {
    const lastCallEffect = monitorCode.match(
      /useEffect\(\(\) => \{[\s\S]*?lastCall[\s\S]*?\}, \[lastCall/,
    );
    expect(lastCallEffect).toBeTruthy();

    expect(lastCallEffect[0]).toMatch(/monitorSpeak\(lastCall\.number/);
    expect(lastCallEffect[0]).not.toMatch(/audioEnabled.*monitorSpeak|monitorSpeak.*audioEnabled/);
  });

  it("não possui gate audioEnabledRef antes de monitorSpeak", () => {
    expect(monitorCode).not.toMatch(/if\s*\(\s*audioEnabledRef\.current\s*\)\s*\{?\s*\n?\s*monitorSpeak/);
  });

  it("ainda possui mecanismo de unlock para beep (AudioContext)", () => {
    expect(monitorCode).toMatch(/unlockSpeech/);
    expect(monitorCode).toMatch(/audioEnabled/);
  });

  it("importa monitorSpeak de speech.js", () => {
    expect(monitorCode).toMatch(/monitorSpeak/);
    expect(monitorCode).toMatch(/from.*speech/);
  });

  it("pula dedup de lastSpokenCallId quando isRecall é true", () => {
    expect(monitorCode).toMatch(/isRecall/);
    expect(monitorCode).toMatch(/!isRecall\s*&&\s*lastSpokenCallId\s*===\s*callKey/);
  });

  it("chamadas normais são deduplicadas por lastSpokenCallId", () => {
    expect(monitorCode).toMatch(/lastSpokenCallId\s*===\s*callKey/);
  });

  it("callNext do monitor usa forceAnnounce", () => {
    const callNextSection = monitorCode.substring(
      monitorCode.indexOf("const callNext"),
      monitorCode.indexOf("/* ─── repetir"),
    );
    expect(callNextSection).toMatch(/forceAnnounce/);
  });

  it("reCall do monitor usa forceAnnounce", () => {
    const reCallSection = monitorCode.substring(
      monitorCode.indexOf("const reCall"),
      monitorCode.indexOf("/* ─── atalhos de teclado"),
    );
    expect(reCallSection).toMatch(/forceAnnounce/);
  });

  it("importa forceAnnounce de speech.js", () => {
    expect(monitorCode).toMatch(/forceAnnounce/);
  });
});

describe("Monitor page — retrato x evento", () => {
  /**
   * Delimita o effect que chama `reconcileQueueFromCalls`, em vez de partir do
   * primeiro `useEffect` do arquivo — o span atravessaria o effect ao vivo e
   * encontraria `monitorSpeak` fora do escopo.
   */
  function reconcileEffect() {
    const callAt = monitorCode.indexOf("reconcileQueueFromCalls(");
    if (callAt === -1) return null;
    const start = monitorCode.lastIndexOf("useEffect(", callAt);
    const end = monitorCode.indexOf("]);", callAt);
    if (start === -1 || end === -1) return null;
    return monitorCode.slice(start, end + "]);".length);
  }

  it("possui um effect de reconciliação sobre o retrato (calls)", () => {
    const effect = reconcileEffect();
    expect(effect).toBeTruthy();
    expect(effect).toMatch(/HISTORY_LIMITS\.monitor/);
    expect(effect).toMatch(/\[calls, sector\]/);
  });

  it("o effect de reconciliação NÃO fala — recarregar não anuncia senha antiga", () => {
    const effect = reconcileEffect();
    expect(effect).toBeTruthy();
    expect(effect).not.toMatch(/monitorSpeak/);
    expect(effect).not.toMatch(/forceAnnounce/);
  });

  it("monitorSpeak é chamado uma única vez, no effect de lastCall", () => {
    // O import não termina em `(`, então só a chamada conta.
    expect(monitorCode.match(/monitorSpeak\(/g)).toHaveLength(1);
    expect(monitorCode).toMatch(/monitorSpeak\(lastCall\.number/);
  });

  it("declara o effect de reconciliação depois do de lastCall", () => {
    // Mantém estável o match do teste "chama monitorSpeak ao receber lastCall",
    // que parte do primeiro useEffect do arquivo.
    const liveEnd = monitorCode.indexOf("}, [lastCall, sector, audioEnabled]");
    const reconcileStart = monitorCode.indexOf("reconcileQueueFromCalls(");

    expect(liveEnd).toBeGreaterThan(-1);
    expect(reconcileStart).toBeGreaterThan(liveEnd);
  });

  it("não busca o histórico por conta própria — vem do singleton", () => {
    expect(monitorCode).not.toMatch(/fetch\([^)]*QUEUE_RECENT/);
    expect(monitorCode).not.toMatch(/\/api\/queue\/recent/);
  });
});
