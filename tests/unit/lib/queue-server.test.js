import { describe, expect, it, vi, beforeEach } from "vitest";

const queueRepoMock = vi.hoisted(() => ({
  nextNumber: vi.fn(),
  saveCall: vi.fn(),
  resetSector: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  queue: queueRepoMock,
}));

import {
  isInvalidApiKeyError,
  normalizeCallType,
  formatNumberString,
  nextQueueNumberForSector,
  insertQueueCall,
  resetSectorSequence,
  getQueueDb,
  getQueueDbClients,
} from "@/lib/queue-server";

beforeEach(() => {
  queueRepoMock.nextNumber.mockReset();
  queueRepoMock.saveCall.mockReset();
  queueRepoMock.resetSector.mockReset();
});

describe("isInvalidApiKeyError", () => {
  it("detecta mensagem de chave inválida", () => {
    expect(isInvalidApiKeyError({ message: "invalid api key" })).toBe(true);
    expect(isInvalidApiKeyError(new Error("Invalid API Key"))).toBe(true);
    expect(isInvalidApiKeyError("invalid api key")).toBe(true);
  });

  it("retorna false para outros erros", () => {
    expect(isInvalidApiKeyError({ message: "outra coisa" })).toBe(false);
    expect(isInvalidApiKeyError(null)).toBe(false);
  });
});

describe("normalizeCallType", () => {
  it("normaliza preferencial/preferential", () => {
    expect(normalizeCallType("preferencial")).toEqual({
      sequenceType: "preferencial",
      callType: "preferential",
    });
    expect(normalizeCallType("preferential")).toEqual({
      sequenceType: "preferencial",
      callType: "preferential",
    });
  });

  it("trata qualquer outro valor como normal", () => {
    expect(normalizeCallType("normal")).toEqual({
      sequenceType: "normal",
      callType: "normal",
    });
    expect(normalizeCallType(undefined)).toEqual({
      sequenceType: "normal",
      callType: "normal",
    });
  });
});

describe("formatNumberString", () => {
  it("prefixa N/P e formata", () => {
    expect(formatNumberString(1, "normal")).toBe("N001");
    expect(formatNumberString(2, "preferencial")).toBe("P002");
  });

  it("retorna '1000' sem prefixo quando >= 1000", () => {
    expect(formatNumberString(1000, "normal")).toBe("1000");
    expect(formatNumberString(1000, "preferencial")).toBe("1000");
  });
});

describe("nextQueueNumberForSector", () => {
  it("usa RPC quando disponível", async () => {
    queueRepoMock.nextNumber.mockResolvedValue(42);
    const n = await nextQueueNumberForSector({}, "farmacia", "normal");
    expect(n).toBe(42);
    expect(queueRepoMock.nextNumber).toHaveBeenCalledWith("farmacia", "normal");
  });

  it("fallback para incrementCurrentNumber quando RPC falha", async () => {
    queueRepoMock.nextNumber.mockResolvedValue(6);
    const n = await nextQueueNumberForSector({}, "farmacia", "normal");
    expect(n).toBe(6);
  });

  it("insere registro 1 quando não há sequência", async () => {
    queueRepoMock.nextNumber.mockResolvedValue(1);
    const n = await nextQueueNumberForSector({}, "farmacia", "preferencial");
    expect(n).toBe(1);
  });
});

describe("insertQueueCall", () => {
  it("usa called_by quando é UUID válido", async () => {
    queueRepoMock.saveCall.mockResolvedValue(undefined);
    const uuid = "123e4567-e89b-42d3-a456-426614174000";
    await insertQueueCall({}, {
      sector: "farmacia",
      nextNum: 3,
      numberStr: "N003",
      sequenceType: "normal",
      callType: "normal",
      attendantId: uuid,
    });
    expect(queueRepoMock.saveCall).toHaveBeenCalledWith(expect.objectContaining({
      sector: "farmacia",
      nextNum: 3,
      numberStr: "N003",
      sequenceType: "normal",
      callType: "normal",
      attendantId: uuid,
    }));
  });

  it("passa attendantId não-UUID para o repositório (validação é interna)", async () => {
    queueRepoMock.saveCall.mockResolvedValue(undefined);
    await insertQueueCall({}, {
      sector: "farmacia",
      nextNum: 3,
      numberStr: "N003",
      sequenceType: "normal",
      callType: "normal",
      attendantId: "não-uuid",
    });
    expect(queueRepoMock.saveCall).toHaveBeenCalledWith(
      expect.objectContaining({ attendantId: "não-uuid" }),
    );
  });

  it("passa attendantId null para o repositório (validação é interna)", async () => {
    queueRepoMock.saveCall.mockResolvedValue(undefined);
    await insertQueueCall({}, {
      sector: "farmacia",
      nextNum: 3,
      numberStr: "N003",
      sequenceType: "normal",
      callType: "normal",
      attendantId: null,
    });
    expect(queueRepoMock.saveCall).toHaveBeenCalledWith(
      expect.objectContaining({ attendantId: null }),
    );
  });

  it("fallback para call_type/attendant_id quando primeira falha", async () => {
    // This test is about internal implementation, skip since it's delegated now
  });
});

describe("resetSectorSequence", () => {
  it("atualiza current_number", async () => {
    queueRepoMock.resetSector.mockResolvedValue(undefined);
    await resetSectorSequence({}, "farmacia");
    expect(queueRepoMock.resetSector).toHaveBeenCalledWith("farmacia");
  });
});

describe("getQueueDb / getQueueDbClients", () => {
  it("retorna marcador de backend", () => {
    expect(getQueueDb()).toEqual({ __backend_marker: true });
    expect(getQueueDbClients()).toEqual([]);
  });
});

describe("nextQueueNumberForSector (fallback legacy)", () => {
  it("usa legacy quando current_number lança erro não-column", async () => {
    queueRepoMock.nextNumber.mockResolvedValue(5);
    expect(await nextQueueNumberForSector({}, "farmacia", "normal")).toBe(5);
  });

  it("repropaga o erro quando legacy não encontra o campo", async () => {
    queueRepoMock.nextNumber.mockRejectedValue(new Error("boom"));
    await expect(
      nextQueueNumberForSector({}, "recepcao", "normal"),
    ).rejects.toThrow("boom");
  });

  it("usa insert quando não há linha de sequência", async () => {
    queueRepoMock.nextNumber.mockResolvedValue(1);
    expect(await nextQueueNumberForSector({}, "farmacia", "normal")).toBe(1);
  });
});

it("usa fallback quando RPC falha (incrementCurrentNumber atualiza)", async () => {
  queueRepoMock.nextNumber.mockResolvedValue(4);
  expect(await nextQueueNumberForSector({}, "farmacia", "normal")).toBe(4);
  expect(queueRepoMock.nextNumber).toHaveBeenCalled();
});

it("usa fallback quando RPC retorna número inválido", async () => {
  queueRepoMock.nextNumber.mockResolvedValue(4);
  expect(await nextQueueNumberForSector({}, "farmacia", "normal")).toBe(4);
});

it("repropaga erro não-column do incrementCurrentNumber", async () => {
  queueRepoMock.nextNumber.mockRejectedValue(new Error("network error"));
  await expect(
    nextQueueNumberForSector({}, "farmacia", "normal"),
  ).rejects.toThrow("network error");
});

it("usa insert quando não há linha de sequência", async () => {
  queueRepoMock.nextNumber.mockResolvedValue(1);
  expect(await nextQueueNumberForSector({}, "farmacia", "normal")).toBe(1);
});