import {
  MAX_PAGE_SIZE,
  NEWS_ALLOWED_TYPES,
  NEWS_MAX_FILE_SIZE,
  NEWS_TITLE_MAX,
  PAGE_SIZES,
  USERNAME_REGEX,
} from './constants';

/**
 * Validações e normalizações puras de entrada — usadas tanto na borda HTTP
 * (rotas e repositórios) quanto na UI, sem dependência de runtime.
 */

/** Extensão canônica por MIME — a chave do S3 não usa o nome do arquivo. */
const IMAGE_EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Confere a assinatura (magic bytes) dos formatos aceitos.
 *
 * O `type` do `File` vem do cliente e é trivial de falsificar; a assinatura
 * é a única prova de que os bytes são mesmo uma imagem.
 */
export function hasValidImageSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;

  const startsWith = (signature: readonly number[]): boolean =>
    signature.every((byte, index) => bytes[index] === byte);
  const ascii = (start: number, length: number): string =>
    String.fromCharCode(...bytes.slice(start, start + length));

  // JPEG: FF D8 FF
  if (startsWith([0xff, 0xd8, 0xff])) return true;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return true;
  // GIF: "GIF8"
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return true;
  // WEBP: "RIFF" .... "WEBP"
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return true;
  // AVIF: box "ftyp" com brand "avif"/"avis"
  if (
    ascii(4, 4) === 'ftyp' &&
    (ascii(8, 4) === 'avif' || ascii(8, 4) === 'avis')
  ) {
    return true;
  }

  return false;
}

/**
 * Extensão a usar no objeto do S3.
 *
 * Derivar do MIME (e não de `file.name`) impede que um arquivo chamado
 * `x.html` com `type: image/jpeg` vire uma chave `.html` num bucket público.
 *
 * @returns `null` quando o MIME não é permitido.
 */
export function imageExtensionFor(type: string): null | string {
  return IMAGE_EXTENSION_BY_TYPE[type] ?? null;
}

/** Valida se o MIME type da imagem está entre os aceitos para notícias. */
export function isAllowedImageType(type: string): boolean {
  return NEWS_ALLOWED_TYPES.includes(type);
}

/** Valida o tamanho da imagem contra o limite de upload. */
export function isValidFileSize(size: number): boolean {
  return size <= NEWS_MAX_FILE_SIZE;
}

/** Título de notícia: não vazio depois do trim e dentro do limite. */
export function isValidNewsTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.length > 0 && trimmed.length <= NEWS_TITLE_MAX;
}

export function isValidUsername(username: string): boolean {
  return USERNAME_REGEX.test(username);
}

/**
 * Normaliza `page` para um inteiro >= 1.
 *
 * O clamp superior (`totalPages`) depende do total e fica com quem
 * conhece a contagem — `getStats` clampa antes de montar o `skip`.
 */
export function normalizePage(value: undefined | number): number {
  const page = Math.floor(Number(value));
  return Number.isFinite(page) && page >= 1 ? page : 1;
}

/**
 * Normaliza `pageSize` para um inteiro em `1..MAX_PAGE_SIZE`.
 *
 * Ausente/inválido vira `fallback` (default: o do histórico,
 * `PAGE_SIZES.historico`). O teto importa: `?pageSize=999999` traria a janela
 * inteira de volta e anularia a paginação no servidor.
 */
export function normalizePageSize(
  value: undefined | number,
  fallback: number = PAGE_SIZES.historico,
): number {
  const size = Math.floor(Number(value));
  if (!Number.isFinite(size) || size < 1) return fallback;
  return Math.min(MAX_PAGE_SIZE, size);
}
