import type { CallType, NewsStatus, SequenceType } from '@/shared/constants';
import type { Permission, PermissionOverride } from '@/shared/permissions';
import type {
  CreateRoleInput,
  CreateUserInput,
  NewsItem,
  NewsPage,
  QueueStats,
  RecentCall,
  RoleRecord,
  UpdateRoleInput,
  UpdateUserInput,
  UserRecord,
} from '@/shared/types/domain';

/**
 * Contrato das camadas de dados.
 *
 * As classes concretas (`*-repo.postgres.ts`) declaram `implements` destas
 * interfaces, e `index.ts` expõe os repositórios tipados por elas — é isso que
 * permite trocar a implementação (as em-memória usadas nos testes de contrato
 * rodam sem que o restante da aplicação perceba a troca).
 *
 * Os records que atravessam a fronteira HTTP/UI vivem em
 * `@/shared/types/domain` e são reexportados aqui para que os repositórios
 * mantenham um import só (`./types`). O que é interno de persistência —
 * `QueueCallInput`, `CreateNewsInput`, interfaces de repositório — fica neste
 * módulo, que é interno do servidor.
 *
 * Nota sobre `sector: string`: o domínio tem dois setores, mas as rotas já
 * validam na borda com `Object.hasOwn(SECTORS, …)` e o TypeScript **não**
 * estreita com esse predicado. Escrever `SectorId` aqui empurraria casts para
 * toda rota; a validação fica no limite HTTP, e `isSectorId()`/`getSector()`
 * de `@/shared/constants` existem para a UI indexar `SECTORS` com segurança.
 */

export type {
  CreateRoleInput,
  CreateUserInput,
  HistoryCall,
  NewsItem,
  QueueCallRecord,
  QueueStats,
  RecentCall,
  RoleRecord,
  UpdateRoleInput,
  UpdateUserInput,
  UserRecord,
} from '@/shared/types/domain';

/* ── Queue ──────────────────────────────────────────────────────── */

/**
 * Verificação de credencial **não** faz parte deste contrato — ela vive em
 * `src/server/auth/config.ts` (NextAuth), para não existir um segundo caminho
 * sem rate limit que valide senha.
 */
export interface AuthRepository {
  /** Resolve o username de login em e-mail. @throws 404 se não existir. */
  resolveLoginEmail(username: string): Promise<string>;
}

export interface CreateNewsInput {
  readonly title: string;
  /**
   * Vem de `FormData.get("image")`: pode chegar como string ou ausente quando
   * o envio é inválido. O repositório valida e lança 400 — depois das checagens
   * o tipo estreita para `File`.
   */
  readonly image: File | null | string;
}

/* ── Read (agregações) ──────────────────────────────────────────── */

/** Filtros da listagem administrativa. */
export interface ListNewsOptions {
  /** Página 1-based (default 1, clampada em `totalPages`). */
  readonly page?: number;
  /** Itens por página (default `NEWS_PAGE_SIZE`, teto `MAX_PAGE_SIZE`). */
  readonly pageSize?: number;
  /** `active` (default) = publicadas no monitor; `inactive` = arquivadas. */
  readonly status?: NewsStatus;
}

export interface NewsRepository {
  /** Faz upload da imagem no S3 e grava a notícia (rollback do S3 se o banco falhar). */
  create(data: CreateNewsInput): Promise<{ news: NewsItem; success: true }>;

  /**
   * Exclusão definitiva: apaga a linha e o objeto do S3.
   *
   * @throws 409 se a notícia ainda estiver ativa (é preciso arquivar antes).
   */
  destroy(id: number | string): Promise<{ success: true }>;

  /**
   * Listagem paginada por status, com os contadores das duas abas.
   *
   * É a leitura do admin; o monitor continua usando `listActive()`, que tem
   * o recorte fixo de `NEWS_MAX_ACTIVE`.
   */
  list(options?: ListNewsOptions): Promise<NewsPage>;

  /** Notícias ativas, mais recentes primeiro. Nunca lança. */
  listActive(): Promise<NewsItem[]>;

  /**
   * Arquiva (`false`) ou reativa (`true`) sem tocar no S3 — a imagem
   * permanece acessível na aba de inativas.
   *
   * @throws 409 ao reativar com `NEWS_MAX_ACTIVE` já publicadas.
   */
  setActive(id: number | string, active: boolean): Promise<NewsItem>;
}

/** Payload aceito por `QueueRepository.saveCall`. */
export interface QueueCallInput {
  readonly attendantId: null | string;
  readonly callType: CallType;
  readonly number: number;
  readonly numberStr: string;
  readonly sector: string;
  readonly sequenceType: SequenceType;
}

/* ── Auth ───────────────────────────────────────────────────────── */

export interface QueueRepository {
  /**
   * Chamadas recentes do setor. Com `resetAt`, exclui as anteriores ao reset
   * (que sobrevivem ao reset e não devem ser repetidas num monitor).
   */
  getRecentCalls(
    sector: string,
    limit?: number,
    resetAt?: Date | null,
  ): Promise<RecentCall[]>;

  /** Marcador de reset do setor (`null` quando nunca foi resetado). */
  getSectorResetAt(sector: string): Promise<Date | null>;

  /**
   * Próximo número do setor/tipo, com transação atômica e wraparound em
   * `MAX_QUEUE_NUMBER` (999 → 000).
   */
  nextNumber(
    sector: string,
    type: SequenceType,
  ): Promise<{ number: number; wraparound: boolean }>;

  /**
   * Zera a sequência do setor. As linhas de `queue_calls` são mantidas de
   * propósito — `/historico` as lê.
   */
  resetSector(sector: string): Promise<void>;

  /**
   * Persiste uma chamada e devolve o id gerado + o instante gravado.
   *
   * O instante vem do banco (`created_at`), não de `new Date()`: é o
   * valor que virou registro, e é ele que o SSE propaga adiante.
   */
  saveCall(call: QueueCallInput): Promise<{ id: string; createdAt: string }>;

  /** Fixa o próximo número (sync manual). A chamada seguinte retorna `nextNumber`. */
  setNextNumber(
    sector: string,
    type: SequenceType,
    nextNumber: number,
  ): Promise<void>;
}

/* ── Users ──────────────────────────────────────────────────────── */

export interface ReadRepository {
  /**
   * Estatísticas de uma janela, com filtros por setor/tipo. Nunca lança:
   * em erro devolve a estrutura vazia com `noDb: true`.
   */
  getStats(options?: StatsOptions): Promise<QueueStats>;
}

/* ── Roles ──────────────────────────────────────────────────────── */

/**
 * Cargos e atribuições de permissão. As chaves de permissão em si vivem em
 * `src/shared/permissions.ts` — aqui só se grava cargo→permissão. Cargos
 * built-in (admin/attendant) são imutáveis: sem eles o sistema se trancaria.
 */
export interface RolesRepository {
  create(data: CreateRoleInput): Promise<RoleRecord>;

  getByKey(key: string): Promise<RoleRecord | null>;

  list(): Promise<RoleRecord[]>;

  /** @throws 409 quando o cargo ainda tem usuários (FK RESTRICT). */
  remove(id: string): Promise<void>;

  update(id: string, data: UpdateRoleInput): Promise<RoleRecord>;
}

/* ── News ───────────────────────────────────────────────────────── */

export interface StatsOptions {
  readonly days?: number;
  /**
   * O "agora" da consulta (padrão: `new Date()`).
   *
   * Existe para a janela ser determinística nos testes — sem ele, um
   * teste que roda perto da meia-noite BRT muda de resultado sozinho.
   */
  readonly now?: Date;
  /**
   * Página do histórico, 1-based.
   *
   * A paginação é feita no servidor: o cliente nunca recebe a janela
   * inteira. O servidor clampa em `[1, totalPages]`.
   */
  readonly page?: number;
  /** Linhas por página (default 20; máximo `MAX_PAGE_SIZE`). */
  readonly pageSize?: number;
  readonly sector?: null | string;
  /** Inclusivo — primeira chamada dentro da janela. */
  readonly since?: Date;
  /**
   * Filtra o histórico exibido (`calls` + `pagination.total`).
   *
   * Não afeta `summary`: os cards são totais da janela inteira, e um
   * filtro na tabela ("só preferenciais") não deve mudar "Total no
   * período" nem "Atendimentos hoje".
   */
  readonly type?: SequenceType | null;
  /**
   * EXCLUSIVO — o instante da meia-noite BRT do dia seguinte.
   *
   * A janela padrão (quando `since`/`until` não vêm) é calculada por
   * `dayWindow()` em `@/shared/time`: dia-calendário BRT, não "agora
   * menos N×24h".
   */
  readonly until?: Date | null;
}

export interface UsersRepository {
  create(data: CreateUserInput): Promise<{ success: true; user: UserRecord }>;

  /** Permissões efetivas (cargo ∪ grants − denials) para login/refresh. */
  getEffectivePermissions(id: string): Promise<Permission[] | null>;

  /** Lista todos os usuários, com cargo e overrides. */
  list(): Promise<UserRecord[]>;

  /** Remove o usuário — overrides e refresh tokens caem em cascata. */
  remove(id: string): Promise<void>;

  /** Substitui todos os overrides (grants/denials) do usuário. */
  setPermissions(
    id: string,
    permissions: readonly PermissionOverride[],
  ): Promise<PermissionOverride[]>;

  update(id: string, data: UpdateUserInput): Promise<UserRecord>;
}
