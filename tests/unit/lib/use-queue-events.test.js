import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const hookPath = resolve(__dirname, "../../../src/lib/hooks/useQueueEvents.js");
const hookCode = readFileSync(hookPath, "utf-8");

/**
 * Não há `@testing-library/react` no projeto, então o comportamento do hook é
 * coberto por leitura do fonte — mesmo procedimento de `use-server-clock.test.js`.
 * A lógica de estado que o hook expõe é testada de verdade em
 * `queue-events.test.js` e `queue.test.js`.
 */
describe("useQueueEvents — contrato", () => {
  it("é um módulo de cliente", () => {
    expect(hookCode).toContain('"use client"');
  });

  it("lê o singleton via useSyncExternalStore", () => {
    expect(hookCode).toContain("useSyncExternalStore(");
    expect(hookCode).toContain("getQueueEventsSnapshot");
    expect(hookCode).toContain("subscribeQueueEvents");
  });

  it("assina o setor via useEffect, com cleanup no return", () => {
    expect(hookCode).toMatch(/useEffect\(\(\) => \{[\s\S]*?subscribeQueueSector\(sector\)/);
    expect(hookCode).toMatch(/return subscribeQueueSector\(sector\)/);
  });

  it("não assina quando não há setor", () => {
    expect(hookCode).toContain("if (!sector) return;");
    expect(hookCode).toMatch(/\[sector\]/);
  });
});

describe("useQueueEvents — retorno", () => {
  it("expõe os três canais", () => {
    expect(hookCode).toMatch(/connected:\s*snapshot\.connected/);
    expect(hookCode).toMatch(/calls:\s*sector\s*\?/);
    expect(hookCode).toMatch(/lastCall:\s*sector\s*\?/);
  });

  it("normaliza canal ausente com ?? null (o snapshot deixa undefined)", () => {
    expect(hookCode).toMatch(/snapshot\.calls\[sector\]\s*\?\?\s*null/);
    expect(hookCode).toMatch(/snapshot\.lastCall\[sector\]\s*\?\?\s*null/);
  });
});
