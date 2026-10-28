/**
 * Imagens de teste com assinatura (magic bytes) válida.
 *
 * O repositório confere a assinatura do arquivo — não só o `type` —, então
 * `new Uint8Array(size)` zerado seria rejeitado como imagem inválida.
 */
const HEADERS: Record<string, readonly number[]> = {
  'image/avif': [
    0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
  ],
  'image/gif': [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/webp': [
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ],
};

export interface TestImageOptions {
  readonly name?: string;
  readonly size?: number;
  readonly type?: string;
}

export function makeTestImage({
  name = 'test.jpg',
  size = 1024,
  type = 'image/jpeg',
}: TestImageOptions = {}): File {
  const header = HEADERS[type] ?? [];
  const bytes = new Uint8Array(Math.max(size, header.length, 16));
  bytes.set(header);
  return new File([bytes], name, { type });
}
