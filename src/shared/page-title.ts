/**
 * Títulos das telas — o que aparece na aba do navegador (e no título da
 * janela do Electron, que segue o `document.title`).
 *
 * A montagem é sempre a mesma: **nome da tela + separador + nome do
 * sistema** ("Painel de Atendimento | Sistema de Atendimento por Senhas").
 * O layout raiz (`src/app/layout.tsx`) faz a junção pelo `title.template`;
 * cada rota define só o nome da sua tela.
 */

/** Nome do sistema — sufixo de todos os títulos de aba. */
export const APP_NAME =
  process.env.NEXT_PUBLIC_APP_NAME ?? 'Sistema de Atendimento por Senhas';

/** Separador entre o nome da tela e o nome do sistema. */
export const APP_TITLE_SEPARATOR = ' | ';

/**
 * Template do título, usado pelo layout raiz.
 *
 * O `%s` é preenchido pelo título do segmento filho (a rota). O `default`
 * do layout raiz cobre as rotas que não definem título próprio — hoje
 * apenas a raiz, que só redireciona.
 */
export const APP_TITLE_TEMPLATE = `%s${APP_TITLE_SEPARATOR}${APP_NAME}`;

/**
 * Título de cada rota.
 *
 * A chave é a URL da rota — a mesma forma usada no registro de
 * permissões (`ROUTE_RULES`, em `src/shared/permissions.ts`), para os dois
 * registros serem lidos lado a lado.
 */
export const PAGE_TITLES = {
  '/admin': 'Administração',
  '/historico': 'Histórico',
  '/home': 'Home',
  '/login': 'Login',
  '/monitor/[sector]': 'Monitor',
  '/painel': 'Painel de Atendimento',
} as const satisfies Record<string, string>;

/** Rota que tem título no registro. */
export type PageTitleRoute = keyof typeof PAGE_TITLES;
