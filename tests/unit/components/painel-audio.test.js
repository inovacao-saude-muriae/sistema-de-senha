import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const painelPath = resolve(__dirname, "../../../src/app/painel/page.js");
const painelCode = readFileSync(painelPath, "utf-8");

describe("Painel page — audio isolation", () => {
  it("não importa funções de áudio de speech.js", () => {
    expect(painelCode).not.toMatch(/from.*speech/);
    expect(painelCode).not.toMatch(/import.*\b(forceAnnounce|monitorSpeak|speakText|unlockSpeech|initSpeechClient)\b/);
  });

  it("não chama forceAnnounce", () => {
    expect(painelCode).not.toMatch(/forceAnnounce\s*\(/);
  });

  it("não inicializa speechSynthesis", () => {
    expect(painelCode).not.toMatch(/initSpeechClient\s*\(/);
    expect(painelCode).not.toMatch(/unlockSpeech\s*\(/);
  });

  it("não possui estado audioEnabled", () => {
    expect(painelCode).not.toMatch(/audioEnabled/);
  });

  it("reCall chama endpoint /api/queue/recall em vez de tocar áudio local", () => {
    expect(painelCode).toMatch(/API_ROUTES\.QUEUE_RECALL|\/api\/queue\/recall/);
    expect(painelCode).not.toMatch(/forceAnnounce.*reCall|reCall.*forceAnnounce/);
  });

  it("reCall usa POST com sector correto no body", () => {
    expect(painelCode).toMatch(/method:\s*["']POST["']/);
    expect(painelCode).toMatch(/body:\s*JSON\.stringify\(\{[^}]*sector[^}]*\}\)/);
  });

  it("callNext não referencia forceAnnounce", () => {
    const callNextSection = painelCode.substring(
      painelCode.indexOf("const callNext"),
      painelCode.indexOf("const reCall"),
    );
    expect(callNextSection).not.toMatch(/forceAnnounce/);
  });

  it("reCall trata erro de fetch", () => {
    expect(painelCode).toMatch(/catch[\s\S]*?Erro ao repetir/);
  });
});

describe("Painel page — retrato x evento", () => {
  /**
   * Delimita o effect que chama `reconcileQueueFromCalls`, em vez de partir do
   * primeiro `useEffect` do arquivo — o span alcançaria a declaração de
   * `lastCallIdRef` e o effect ao vivo.
   */
  function reconcileEffect() {
    const callAt = painelCode.indexOf("reconcileQueueFromCalls(");
    if (callAt === -1) return null;
    const start = painelCode.lastIndexOf("useEffect(", callAt);
    const end = painelCode.indexOf("]);", callAt);
    if (start === -1 || end === -1) return null;
    return painelCode.slice(start, end + "]);".length);
  }

  it("não busca o histórico por conta própria — vem do singleton", () => {
    // Era a pendência "fetch duplicado" (TODO removido): o retrato agora é
    // compartilhado com `useQueueEvents`.
    expect(painelCode).not.toMatch(/fetch\([^)]*QUEUE_RECENT/);
    expect(painelCode).not.toMatch(/\/api\/queue\/recent/);
  });

  it("possui um effect de reconciliação sobre o retrato (calls)", () => {
    const effect = reconcileEffect();
    expect(effect).toBeTruthy();
    expect(effect).toMatch(/HISTORY_LIMIT/);
    expect(effect).toMatch(/activeSector/);
    expect(effect).toMatch(/\[calls, activeSector\]/);
  });

  it("o effect de reconciliação não mexe na dedupe do effect ao vivo", () => {
    expect(reconcileEffect()).not.toMatch(/lastCallIdRef/);
  });

  it("o effect ao vivo segue deduplicando por lastCallIdRef", () => {
    expect(painelCode).toMatch(/lastCallIdRef\.current === callKey/);
  });
});
