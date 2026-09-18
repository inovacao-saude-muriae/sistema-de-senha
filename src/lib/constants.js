// ── Setores ──
export const SECTORS = {
  farmacia: { id: "farmacia", name: "Farmácia", shortName: "FARMÁCIA" },
  recepcao: { id: "recepcao", name: "Recepção Saúde", shortName: "RECEPÇÃO" },
};
export const DEFAULT_SECTOR = "farmacia";
export const ALL_SECTORS = "all";

// ── Roles ──
export const ROLES = { ADMIN: "admin", ATTENDANT: "attendant" };
export const DEFAULT_ROLE = ROLES.ATTENDANT;

// ── Tipos de chamada ──
export const CALL_TYPES = {
  NORMAL: "normal",
  PREFERENCIAL: "preferencial",
  PREFERENTIAL: "preferential",
};
export const TYPE_FIELDS = {
  preferencial: "priorityCurrent",
  preferential: "priorityCurrent",
  normal: "normalCurrent",
};
export const TYPE_LABELS = {
  preferencial: "Preferencial",
  preferential: "Preferencial",
  normal: "Normal",
};
export const TYPE_PREFIXES = { preferencial: "P", preferential: "P", normal: "N" };

// ── Fila ──
export const MIN_QUEUE_NUMBER = 0;
export const MAX_QUEUE_NUMBER = 999;
export const DEFAULT_QUEUE_NUMBER = MIN_QUEUE_NUMBER;
export const NO_PASSWORD = null;
export const DEFAULT_RECENT_LIMIT = 30;

// ── Estatísticas ──
export const MIN_DAYS = 1;
export const MAX_DAYS = 90;
export const DEFAULT_DAYS = 30;

// ── Paginação ──
export const PAGE_SIZES = { historico: 20, painel: 10 };

// ── Histórico ──
export const HISTORY_LIMITS = { painel: 100, monitor: 30 };

// ── Timing ──
export const CLOCK_INTERVAL = 1000;
export const KEEPALIVE_INTERVAL = 30000;
export const POLLING_INTERVAL = 3000;
export const NEWS_CAROUSEL_INTERVAL = 5000;
export const SSE_BACKOFF_BASE = 1000;
export const SSE_BACKOFF_MAX = 30000;

// ── Eventos SSE ──
export const SSE_EVENT_TYPES = { CALL: "call", RECALL: "recall" };

// ── Auth ──
export const USERNAME_REGEX = /^[a-z0-9]+(?:[._][a-z0-9]+)*$/;
export const USERNAME_REGEX_LABEL = "Use o formato nome.sobrenome";
export const BCRYPT_SALT_ROUNDS = 10;
export const EMAIL_DOMAIN = "@central-atendimento.local";
export const DEFAULT_INITIALS = "AT";
export const DEFAULT_NAME = "Atendente";

// ── Guichê ──
export const DEFAULT_GUICHE = "none";

// ── Notícia ──
export const NEWS_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
];
export const NEWS_MAX_FILE_SIZE = 5 * 1024 * 1024;
export const NEWS_BUCKET = "news-images";
export const NEWS_DIR = "public/news";
export const NEWS_MAX_ACTIVE = 10;

// ── Locale / Timezone ──
export const LOCALE = "pt-BR";
export const APP_TIMEZONE = "America/Sao_Paulo";
export const SERVER_TIME_SYNC_INTERVAL = 60000; // 60s entre sincronizações com servidor

// ── Draft ──
export const DRAFT_PREFIX = "draft-";

// ── Speech/TTS ──
export const TTS_MAX_NUMBER = 1000;
export const TTS_DEDUP_WINDOW = 10000;
export const TTS_VOICE_TIMEOUT = 1500;
export const TTS_WATCHDOG_INTERVAL = 3000;
export const TTS_SPEECH_RATE = 0.88;
export const TTS_PITCH = 1;
export const TTS_VOLUME = 1;
export const TTS_RETRY_DELAY = 400;
export const TTS_BEEP_FREQ_LOW = 880;
export const TTS_BEEP_FREQ_HIGH = 1100;
export const TTS_BEEP_DURATION = 0.18;
export const TTS_BEEP_OFFSET = 0.24;
export const TTS_GAIN = 0.6;
export const TTS_POST_BEEP_BUFFER = 100;
export const TTS_SPEAK_DELAY = 100;
export const TTS_PRE_SPEECH_PAUSE = 250;

// ── Rotas ──
export const API_ROUTES = {
  QUEUE_CALL: "/api/queue/call",
  QUEUE_RECENT: "/api/queue/recent",
  QUEUE_EVENTS: "/api/queue/events",
  QUEUE_SYNC: "/api/queue/sync",
  QUEUE_RESET: "/api/queue/reset",
  QUEUE_RECALL: "/api/queue/recall",
  AUTH: "/api/auth",
  LOGIN: "/login",
  HOME: "/home",
  TIME: "/api/time",
};

// ── Navegação ──
export const NAV_ITEMS = [
  { label: "Home", href: "/home", icon: "Home" },
  { label: "Administração", href: "/admin", icon: "Settings", onlyAdmin: true },
  { label: "Chamadas", href: "/painel", icon: "Monitor" },
  { label: "Histórico", href: "/historico", icon: "History" },
];

// ── Atalhos de teclado ──
export const KEYBOARD_SHORTCUTS = {
  INPUT_TAGS: ["INPUT", "SELECT", "TEXTAREA", "BUTTON"],
  NORMAL_CALL: ["ArrowRight", "PageDown", "Enter", " "],
  PRIORITY_CALL: ["ArrowLeft", "PageUp"],
  RECALL: ["ArrowUp", "Home"],
};

// ── Chaves de armazenamento ──
export const QUEUE_KEY = "saude-queue-state";
export const SESSION_KEY = "saude-attendant-session";

// ── Guichês ──
export const GUICHES = [
  { id: "none", name: "Sem guichê" },
  { id: "guiche-1", name: "Guichê 1" },
  { id: "guiche-2", name: "Guichê 2" },
  { id: "guiche-3", name: "Guichê 3" },
  { id: "guiche-4", name: "Guichê 4" },
];
