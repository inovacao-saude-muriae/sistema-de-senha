// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { deleteFromS3, extractKeyFromUrl, getPublicUrl, uploadToS3 } from "@/lib/s3-client.js";

const TEST_PREFIX = "integration-test/";
let createdKeys = [];

function makeBuffer(content = "test-binary-data", size = 256) {
  return Buffer.alloc(size, content);
}

afterAll(async () => {
  const validKeys = createdKeys.filter(Boolean);

  for (const key of validKeys) {
    await deleteFromS3(key);
  }

  createdKeys = [];
});

describe("S3 storage — integration", () => {
  describe("upload", () => {
    it("faz upload e objeto fica acessível via URL pública", async () => {
      const key = `${TEST_PREFIX}upload-test-${Date.now()}.bin`;
      createdKeys.push(key);

      const buffer = makeBuffer();
      await uploadToS3(key, buffer, "application/octet-stream");

      const url = getPublicUrl(key);
      const res = await fetch(url);
      expect(res.ok).toBe(true);

      const body = await res.arrayBuffer();
      expect(body.byteLength).toBe(buffer.length);
    });

    it("preserva o Content-Type correto", async () => {
      const key = `${TEST_PREFIX}content-type-${Date.now()}.png`;
      createdKeys.push(key);

      const buffer = makeBuffer();
      await uploadToS3(key, buffer, "image/png");

      const url = getPublicUrl(key);
      const res = await fetch(url, { method: "HEAD" });
      expect(res.ok).toBe(true);
      expect(res.headers.get("content-type")).toMatch(/image\/png/);
    });

    it("gera chaves únicas para uploads diferentes", async () => {
      const ts = Date.now();
      const key1 = `${TEST_PREFIX}unique-1-${ts}.bin`;
      const key2 = `${TEST_PREFIX}unique-2-${ts}.bin`;
      createdKeys.push(key1, key2);

      await uploadToS3(key1, makeBuffer("a"), "application/octet-stream");
      await uploadToS3(key2, makeBuffer("b"), "application/octet-stream");

      const url1 = getPublicUrl(key1);
      const url2 = getPublicUrl(key2);
      expect(url1).not.toBe(url2);

      const [res1, res2] = await Promise.all([
        fetch(url1),
        fetch(url2),
      ]);
      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);
    });
  });

  describe("delete", () => {
    it("remove objeto e URL retorna 404", async () => {
      const key = `${TEST_PREFIX}delete-test-${Date.now()}.bin`;
      const buffer = makeBuffer();
      await uploadToS3(key, buffer, "application/octet-stream");

      const urlBefore = getPublicUrl(key);
      const resBefore = await fetch(urlBefore, { method: "HEAD" });
      expect(resBefore.ok).toBe(true);

      await deleteFromS3(key);

      const resAfter = await fetch(urlBefore, { method: "HEAD" });
      expect(resAfter.ok).toBe(false);
    });

    it("delete é best-effort (não lança erro para key inexistente)", async () => {
      await expect(
        deleteFromS3(`${TEST_PREFIX}nonexistent-${Date.now()}.bin`)
      ).resolves.toBeUndefined();
    });
  });

  describe("URL helpers", () => {
    it("getPublicUrl retorna URL correta", () => {
      const key = "photo.jpg";
      const url = getPublicUrl(key);
      expect(url).toMatch(new RegExp(`${process.env.S3_PUBLIC_URL}/photo\\.jpg$`));
    });

    it("extractKeyFromUrl extrai key de URL completa", () => {
      const key = "2024-test-photo.jpg";
      const url = getPublicUrl(key);
      const extracted = extractKeyFromUrl(url);
      expect(extracted).toBe(key);
    });

    it("extractKeyFromUrl retorna null para URL externa", () => {
      const extracted = extractKeyFromUrl("https://example.com/img.jpg");
      expect(extracted).toBeNull();
    });

    it("extractKeyFromUrl retorna null para input inválido", () => {
      expect(extractKeyFromUrl(null)).toBeNull();
      expect(extractKeyFromUrl(undefined)).toBeNull();
      expect(extractKeyFromUrl("")).toBeNull();
    });
  });

  describe("content types", () => {
    it("armazena JPEG corretamente", async () => {
      const key = `${TEST_PREFIX}jpeg-${Date.now()}.jpg`;
      createdKeys.push(key);

      await uploadToS3(key, makeBuffer(), "image/jpeg");

      const url = getPublicUrl(key);
      const res = await fetch(url, { method: "HEAD" });
      expect(res.ok).toBe(true);
      expect(res.headers.get("content-type")).toMatch(/image\/jpeg/);
    });

    it("armazena PNG corretamente", async () => {
      const key = `${TEST_PREFIX}png-${Date.now()}.png`;
      createdKeys.push(key);

      await uploadToS3(key, makeBuffer(), "image/png");

      const url = getPublicUrl(key);
      const res = await fetch(url, { method: "HEAD" });
      expect(res.ok).toBe(true);
      expect(res.headers.get("content-type")).toMatch(/image\/png/);
    });

    it("armazena WebP corretamente", async () => {
      const key = `${TEST_PREFIX}webp-${Date.now()}.webp`;
      createdKeys.push(key);

      await uploadToS3(key, makeBuffer(), "image/webp");

      const url = getPublicUrl(key);
      const res = await fetch(url, { method: "HEAD" });
      expect(res.ok).toBe(true);
      expect(res.headers.get("content-type")).toMatch(/image\/webp/);
    });
  });
});
