import type { User } from 'next-auth';
import type { SequenceType } from '@/shared/constants';
import type { Permission, PermissionOverride } from '@/shared/permissions';
import type {
  CreateRoleInput,
  CreateUserInput,
  NewsCounts,
  NewsItem,
  NewsPagination,
  QueueStats,
  RecentCall,
  RoleRecord,
  UpdateRoleInput,
  UpdateUserInput,
  UserRecord,
} from '@/shared/types/domain';

/**
 * Contrato HTTP entre as rotas em `src/app/api/*` e quem as chama.
 *
 * Como `readJson<T>`/`parseJson<T>` de `@/shared/json` assumem o formato do
 * corpo, estes tipos são a declaração *manual* desse formato — a única fonte
 * que existe, já que ele é definido em tempo de execução.
 *
 * Convenção aplicada a todos os corpos: o formato de sucesso tem os campos
 * obrigatórios e herda `error`/`code` de `ApiErrorBody`. Os campos de sucesso
 * serem obrigatórios não é ingenuidade — é o que os clientes realmente usam:
 * todo `readJson` aqui é lido depois de `if (!res.ok) throw`, então quem
 * garante a forma é o **status HTTP**, e `error` documenta só o caminho de
 * falha.
 */

/* ── Base ──────────────────────────────────────────────────────── */

/** `POST /api/roles`. */
export type CreateRoleRequest = CreateRoleInput;

/* ── Sessão ────────────────────────────────────────────────────── */

/** `POST /api/users`. */
export type CreateUserRequest = CreateUserInput;

/**
 * `GET /api/stats` — o corpo é literalmente a saída de
 * `ReadRepository.getStats` (`QueueStats`), inclusive o fallback `noDb`.
 */
export type StatsBody = QueueStats;

/* ── Usuários e cargos ─────────────────────────────────────────── */

/** Corpo de erro que qualquer rota pode devolver (4xx/5xx). */
export interface ApiErrorBody {
  readonly code?: string;
  readonly error?: string;
}

/** `GET /api/auth/session` (Auth.js) — `{}` quando não há sessão. */
export interface AuthSessionBody extends ApiErrorBody {
  readonly user?: User;
}

/**
 * `GET /api/auth` — stub legado: o caminho paralelo de credenciais foi
 * removido e a rota só responde a quem ainda a consulta.
 */
export interface AuthUsersBody {
  readonly users: readonly unknown[];
}

/**
 * Campos são todos opcionais porque vêm do cliente: a validação (e o 400)
 * acontece na rota, e é a rota que estreita `sector` para `SectorId` com
 * `isSectorId()`.
 */
export interface CallRequestBody {
  readonly sector?: string;
  readonly type?: string;
}

/** `POST /api/news`. */
export interface NewsCreateBody extends ApiErrorBody {
  readonly news: NewsItem;
  readonly success: true;
}

/**
 * `GET /api/news`.
 *
 * Sem query string o default é o do monitor (ativas, página 1, 10 itens);
 * o admin pede `status`, `page` e `pageSize` explicitamente.
 */
export interface NewsListBody extends ApiErrorBody {
  readonly counts: NewsCounts;
  readonly news: NewsItem[];
  readonly pagination: NewsPagination;
}

/**
 * `PATCH /api/news` — arquiva (`active: false`) ou reativa
 * (`active: true`). Campos opcionais porque vêm do cliente; a rota valida.
 */
export interface NewsPatchBody {
  readonly id?: unknown;
  readonly active?: unknown;
}

/** Resposta de `PATCH /api/news`. */
export interface NewsUpdateBody extends ApiErrorBody {
  readonly news: NewsItem;
  readonly success: true;
}

/** `POST /api/queue/call`. */
export interface QueueCallBody extends ApiErrorBody {
  readonly number: number;
  readonly numberStr: string;
  readonly success: true;
  readonly type: SequenceType;
  readonly wraparound: boolean;
  /** `true` quando o servidor não está configurado — o cliente cai no local. */
  readonly useLocal?: boolean;
}

/* ── Notícias ──────────────────────────────────────────────────── */

/** `POST /api/queue/recall`. */
export interface QueueRecallBody extends ApiErrorBody {
  readonly number: number;
  readonly success: true;
  readonly type: SequenceType;
}

/**
 * `GET /api/queue/recent` — fallback de polling quando o SSE não abre.
 *
 * `calls` são as chamadas pós-reset do setor (`resetAt` é o marcador que deixa
 * o cliente detectar um reset feito em outro aparelho).
 */
export interface QueueRecentBody extends ApiErrorBody {
  readonly calls: readonly RecentCall[];
  readonly resetAt: null | string;
}

/* ── Relógio e estatísticas ────────────────────────────────────── */

/** `POST /api/queue/reset`. */
export interface QueueResetBody extends ApiErrorBody {
  readonly sectors: string[];
  readonly success: true;
}

/** `POST /api/queue/sync`. */
export interface QueueSyncBody extends ApiErrorBody {
  readonly message: string;
  readonly nextNumber: number;
  readonly numberStr: string;
  readonly sector: string;
  readonly success: true;
  readonly type: SequenceType;
}

/** Corpo de `POST /api/queue/recall`. */
export interface RecallRequestBody {
  readonly sector?: string;
}

/* ── Fila: respostas ───────────────────────────────────────────── */

/** `POST /api/auth/refresh`. */
export interface RefreshBody extends ApiErrorBody {
  readonly ok?: true;
  readonly permissions?: Permission[];
}

/** Corpo de `POST /api/queue/reset` — `"all"` expande para todos os setores. */
export interface ResetRequestBody {
  readonly sector?: string;
}

/** Corpo de `PATCH /api/roles` — a rota responde 400 sem `id`. */
export interface RolePatchBody extends UpdateRoleInput {
  readonly id?: string;
}

/** `POST /api/roles` e `PATCH /api/roles`. */
export interface RoleSaveBody extends ApiErrorBody {
  readonly role: RoleRecord;
  readonly success: true;
}

/** `GET /api/roles`. */
export interface RolesListBody extends ApiErrorBody {
  readonly roles: RoleRecord[];
}

/* ── Fila: corpos de requisição ────────────────────────────────── */

/** `DELETE /api/roles`, `DELETE /api/users` e `DELETE /api/news`. */
export interface SuccessBody extends ApiErrorBody {
  readonly success: true;
}

/** Corpo de `POST /api/queue/sync`. */
export interface SyncRequestBody {
  readonly nextNumber?: unknown;
  readonly sector?: string;
  readonly type?: string;
}

/** `GET /api/time`. */
export interface TimeBody extends ApiErrorBody {
  readonly serverTime: string;
}

/**
 * Corpo de `PATCH /api/users`.
 *
 * Além dos campos de `UpdateUserInput`, carrega o `id` do alvo e os overrides
 * de permissão, que a rota aplica por fora do `update` (tabela separada).
 */
export interface UserPatchBody extends UpdateUserInput {
  readonly id?: string;
  readonly permissions?: readonly PermissionOverride[];
}

/* ── Reuso ─────────────────────────────────────────────────────── */

/** `POST /api/users` e `PATCH /api/users`. */
export interface UserSaveBody extends ApiErrorBody {
  readonly success: true;
  readonly user: UserRecord;
}

/** `GET /api/users`. */
export interface UsersListBody extends ApiErrorBody {
  readonly users: UserRecord[];
}
