import type { SequenceType } from '@/shared/constants';
import type { PermissionOverride } from '@/shared/permissions';

/**
 * Tipos de domínio compartilhados entre a API e a UI.
 *
 * Aqui ficam apenas os formatos que atravessam a fronteira (records e
 * payloads de entrada/saída da API). Contratos internos de persistência —
 * interfaces de repositório e inputs que carregam `File`, por exemplo — ficam
 * em `@/server/repositories/types`.
 */

/* ── Registros de fila ──────────────────────────────────────────── */

/** Saída de `QueueRepository.getRecentCalls`. */
export type RecentCall = QueueCallRecord;

export interface CreateRoleInput {
  readonly name: string;
  readonly key: string;
  readonly description?: null | string;
  readonly permissions?: readonly string[];
}

export interface CreateUserInput {
  readonly full_name: string;
  readonly password: string;
  readonly username: string;
  readonly active?: boolean;
  readonly permissions?: readonly PermissionOverride[];
  readonly role?: string;
  readonly role_id?: string;
  readonly sector_id?: null | string;
}

/** Saída de `ReadRepository.getStats` — carrega o setor de origem. */
export interface HistoryCall extends QueueCallRecord {
  readonly sector_id: string;
}

/* ── Notícias ──────────────────────────────────────────────────── */

export interface NewsCounts {
  readonly active: number;
  readonly inactive: number;
}

export interface NewsItem {
  readonly id: string;
  readonly title: string;
  /** `false` = arquivada (fora do monitor), mas ainda reativável. */
  readonly active: boolean;
  readonly image: string;
  /** Instante de criação em ISO-8601 (UTC); `null` em linhas legadas. */
  readonly createdAt: null | string;
}

/** Página da listagem administrativa (status + paginação + contadores). */
export interface NewsPage {
  readonly counts: NewsCounts;
  readonly items: NewsItem[];
  readonly pagination: NewsPagination;
}

export interface NewsPagination {
  readonly page: number;
  readonly pageSize: number;
  /** Itens que casam o status pedido. */
  readonly total: number;
  /** `max(1, ceil(total / pageSize))` — nunca zero, para a UI. */
  readonly totalPages: number;
}

/**
 * Linha de chamada normalizada, no formato que a UI consome.
 *
 * `createdAt` é o INSTANTE da chamada em ISO-8601 (UTC) — e não um
 * "HH:mm" já formatado. A regra do sistema é uma só: o wire carrega
 * instantes, e quem formata (em BRT) é o cliente, via `@/shared/time`.
 */
export interface QueueCallRecord {
  readonly id: string;
  readonly number: number;
  readonly type: SequenceType;
  /** Instante da chamada em ISO-8601 (UTC). */
  readonly createdAt: string;
}

/** Estatísticas de uma janela, com paginação — formato consumido pela UI. */
export interface QueueStats {
  /** Apenas a página pedida — nunca a janela inteira. */
  readonly calls: readonly HistoryCall[];
  readonly days: number;
  /** Só no fallback: a query falhou e a resposta é a estrutura vazia. */
  readonly noDb?: boolean;
  readonly pagination: {
    /** Página efetivamente devolvida (o servidor clampa em `totalPages`). */
    readonly page: number;
    readonly pageSize: number;
    /** Linhas que casam janela + sector + type (o filtro da tabela). */
    readonly total: number;
    /** `max(1, ceil(total / pageSize))` — nunca zero, para a UI. */
    readonly totalPages: number;
  };
  /**
   * Resumo da janela inteira — ignora `type` e `page`.
   *
   * `total` pode ser MAIOR que `pagination.total` quando há filtro de
   * tipo: os cards resumem o período, a tabela mostra só o filtro.
   */
  readonly summary: {
    readonly normal: number;
    readonly preferencial: number;
    readonly today: number;
    readonly total: number;
  };
}

/* ── Cargos ────────────────────────────────────────────────────── */

export interface RoleRecord {
  readonly id: string;
  readonly name: string;
  readonly built_in: boolean;
  readonly description: null | string;
  readonly key: string;
  readonly permissions: readonly string[];
}

export interface UpdateRoleInput {
  readonly name?: string;
  readonly description?: null | string;
  readonly permissions?: readonly string[];
}

/** `password` em branco mantém a senha atual. */
export interface UpdateUserInput {
  readonly active?: boolean;
  readonly full_name?: string;
  readonly password?: string;
  readonly role?: string;
  readonly role_id?: string;
  readonly sector_id?: null | string;
}

/* ── Usuários ──────────────────────────────────────────────────── */

/**
 * Usuário achatado (cargo/overrides desaninhados) — o formato consumido pela
 * UI de listagem e pelos testes de contrato.
 *
 * `role` é a CHAVE do cargo ("admin"|"attendant"|chave custom), não o id.
 */
export interface UserRecord {
  readonly id: string;
  readonly active: boolean;
  readonly full_name: string;
  /** `"none"` no banco — coluna string, não numérica. */
  readonly guiche_id: string;
  readonly permissions: readonly PermissionOverride[];
  readonly role: null | string;
  readonly role_built_in: boolean;
  readonly role_id: string;
  readonly role_name: null | string;
  readonly sector_id: null | string;
  readonly username: string;
}
