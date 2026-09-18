"use client";

import { useEffect, useRef, useState, useSyncExternalStore, } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertTriangle, ImagePlus, Monitor, RotateCcw, Save, Trash2, } from "lucide-react";
import {
  getQueueSnapshot,
  getServerQueueSnapshot,
  getServerSessionSnapshot,
  getSessionSnapshot, MIN_QUEUE_NUMBER,
  normalizeQueue,
  saveQueueState,
  subscribeQueue,
  subscribeSession,
} from "../../lib/queue";
import {
  SECTORS,
  ROLES,
  DEFAULT_SECTOR,
  CALL_TYPES,
  MAX_QUEUE_NUMBER,
  DRAFT_PREFIX,
  USERNAME_REGEX,
  USERNAME_REGEX_LABEL,
  NO_PASSWORD,
} from "../../lib/constants.js";
import styles from "./Admin.module.css";
import { SidebarLayout } from "@/components/SidebarLayout/SidebarLayout";

let newsCache = [];
const serverNewsSnapshot = [];

function getNewsSnapshot() {
  if (typeof window === "undefined") return serverNewsSnapshot;
  return newsCache;
}

function getServerNewsSnapshot() {
  return serverNewsSnapshot;
}

function subscribeNews(callback) {
  window.addEventListener("storage", callback);
  window.addEventListener("news-updated", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("news-updated", callback);
  };
}

export default function AdminPage() {
  const router = useRouter();

  const session = useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getServerSessionSnapshot,
  );
  const state = useSyncExternalStore(
    subscribeQueue,
    getQueueSnapshot,
    getServerQueueSnapshot,
  );
  const news = useSyncExternalStore(
    subscribeNews,
    getNewsSnapshot,
    getServerNewsSnapshot,
  );

  const [title, setTitle] = useState("");
  const [image, setImage] = useState("");
  const [message, setMessage] = useState("");
  const [draftNews, setDraftNews] = useState([]);
  const [savingNews, setSavingNews] = useState(false);
  const [resettingSector, setResettingSector] = useState({});
  const [, refreshNews] = useState(0);
  const pendingFileRef = useRef(null);

  /* segurança: só admin */
  useEffect(() => {
    const storedSession = getSessionSnapshot();
    if (!storedSession || storedSession.role !== ROLES.ADMIN) { router.push("/login"); }
  }, [router]);

  /* notícias */
  useEffect(() => {
    fetch("/api/news")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.news) return;
        newsCache.splice(0, newsCache.length, ...data.news);
        setDraftNews(data.news);
        refreshNews((v) => v + 1);
        window.dispatchEvent(new Event("news-updated"));
      })
      .catch(() => {
      });
  }, []);

  if (!session) return null;

  /* ── reset de fila ── */
  async function resetSector(sectorId) {
    const isAll = sectorId === "all";
    const label = isAll
      ? "TODOS os setores (Farmácia e Recepção)"
      : SECTORS[sectorId]?.name || sectorId;

    const msg = isAll
      ? `ATENÇÃO\n\nIsso vai zerar as senhas de ${label}.\n\nA numeração voltará para ${MIN_QUEUE_NUMBER.toString().padStart(3, "0")}. Esta ação não pode ser desfeita.\n\nDeseja continuar?`
      : `Zerar as senhas do setor "${label}"?\n\nA numeração voltará para ${MIN_QUEUE_NUMBER.toString().padStart(3, "0")}.`;

    if (!window.confirm(msg)) return;

    const sectorsToReset = isAll ? Object.keys(SECTORS) : [sectorId];
    setResettingSector((prev) => {
      const next = { ...prev };
      sectorsToReset.forEach((s) => (next[s] = true));
      return next;
    });
    setMessage("");

    try {
      const currentState = getQueueSnapshot();
      const next = { ...currentState };
      sectorsToReset.forEach((s) => {
        next[s] = {
          ...normalizeQueue(currentState[s]),
          normalCurrent: NO_PASSWORD,
          priorityCurrent: NO_PASSWORD,
          history: [],
        };
      });
      saveQueueState(next);

      const res = await fetch("/api/queue/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector: sectorId }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok && !data.localOnly) {
        setMessage(data.error || "Erro ao zerar o contador no banco.");
        return;
      }
      setMessage(
        isAll
          ? `Todas as senhas foram resetadas. Numeração reinicia em ${MIN_QUEUE_NUMBER.toString().padStart(3, "0")}.`
          : `Senhas de "${label}" zeradas. Numeração reinicia em ${MIN_QUEUE_NUMBER.toString().padStart(3, "0")}.`,
      );
    } catch {
      setMessage("Erro ao zerar os contadores.");
    } finally {
      setResettingSector((prev) => {
        const next = { ...prev };
        sectorsToReset.forEach((s) => delete next[s]);
        return next;
      });
    }
  }

  /* ── notícias ── */
  function addNews(event) {
    event.preventDefault();
    if (!title || !pendingFileRef.current) return;
    setDraftNews([
      {
        id: `draft-${Date.now()}`,
        title,
        image,
        _file: pendingFileRef.current,
      },
      ...draftNews,
    ]);
    setTitle("");
    setImage("");
    pendingFileRef.current = null;
    setMessage(
      "Alteração pendente. Clique em 'Salvar notícias' para publicar.",
    );
  }

  async function saveNews() {
    setSavingNews(true);
    setMessage("");
    try {
      // Remove os que foram deletados do rascunho
      const removed = news.filter(
        (item) => !draftNews.some((d) => String(d.id) === String(item.id)),
      );
      for (const item of removed) {
        await fetch(`/api/news?id=${item.id}`, { method: "DELETE" });
      }

      // Cria os novos (que têm id começando com "draft-")
      const created = [];
      for (const item of draftNews.filter((d) =>
        String(d.id).startsWith("draft-"),
      )) {
        const fd = new FormData();
        fd.append("title", item.title);
        fd.append("image", item._file);
        const res = await fetch("/api/news", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        created.push(data.news);
      }

      const res = await fetch("/api/news");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      newsCache.splice(0, newsCache.length, ...data.news);
      setDraftNews(data.news);
      refreshNews((v) => v + 1);
      window.dispatchEvent(new Event("news-updated"));
      setMessage(`${created.length} notícia(s) salva(s) com sucesso.`);
    } catch (err) {
      setMessage(err.message || "Não foi possível salvar as notícias.");
    } finally {
      setSavingNews(false);
    }
  }

  function deleteNews(id) {
    setDraftNews(draftNews.filter((item) => String(item.id) !== String(id)));
    setMessage(
      "Exclusão pendente. Clique em 'Salvar notícias' para confirmar.",
    );
  }

  function readImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    pendingFileRef.current = file;
    // preview local via URL temporária
    setImage(URL.createObjectURL(file));
  }

  return (
    <SidebarLayout
      activeRoute="admin"
      session={session}
      sectorInfo={""}
      eyebrow="CONTROLE CENTRAL"
      title="Administração"
      subtitle="Gerencie as filas de atendimento e as notícias do monitor."
      headerActions={null}
    >
      <section className={styles.content}>
        {message && <div className={styles.alertBox}>{message}</div>}

        {/* ── Controle de filas ── */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>
            <div>
              <p>FILAS POR SERVIÇO</p>
              <h2>Controle dos atendimentos</h2>
            </div>
          </div>

          <div className={styles.sectors}>
            {Object.values(SECTORS).map((item) => {
              const queue = normalizeQueue(state[item.id]);
              const isReset = !!resettingSector[item.id];
              return (
                <article key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      Normal: {queue.normalCurrent === null || queue.normalCurrent === undefined
                        ? "N---"
                        : `N${String(queue.normalCurrent).padStart(3, "0")}`} ·
                      Preferencial: {queue.priorityCurrent === null || queue.priorityCurrent === undefined
                        ? "P---"
                        : `P${String(queue.priorityCurrent).padStart(3, "0")}`}
                    </small>
                  </div>
                  <div className={styles.cardActions}>
                    <Link href={`/monitor/${item.id}`} target="_blank">
                      <Monitor size={16}/> Abrir Monitor
                    </Link>
                    <button
                      type="button"
                      onClick={() => resetSector(item.id)}
                      disabled={isReset}
                      className={styles.resetSectorButton}
                    >
                      <RotateCcw size={16}/>
                      {isReset ? "Resetando…" : "Resetar senhas"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className={styles.resetAllWrapper}>
            <div className={styles.resetAllInfo}>
              <AlertTriangle size={16}/>
              <span>
                Resetar todos os setores de uma vez — numeração volta para {MIN_QUEUE_NUMBER.toString().padStart(3, "0")}
                em todos.
              </span>
            </div>
            <button
              type="button"
              className={styles.resetAllButton}
              onClick={() => resetSector("all")}
              disabled={Object.keys(resettingSector).length > 0}
            >
              <RotateCcw size={16}/>
              {Object.keys(resettingSector).length > 0
                ? "Resetando…"
                : "Resetar todos os setores"}
            </button>
          </div>
        </section>

        {/* ── Sincronizar senhas ── */}
        <SyncSection />

        {/* ── Notícias do monitor ── */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>
            <div>
              <p>COMUNICAÇÃO</p>
              <h2>Notícias do monitor</h2>
            </div>
          </div>

          <form className={styles.newsForm} onSubmit={addNews}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título da notícia"
              required
            />
            <label className={styles.upload}>
              <ImagePlus size={18}/>{" "}
              {image ? "Imagem selecionada" : "Adicionar imagem"}
              <input
                type="file"
                accept="image/*"
                onChange={readImage}
                required
              />
            </label>
            <button type="submit">
              <ImagePlus size={16}/> Adicionar à lista
            </button>
          </form>

          <div className={styles.newsGrid}>
            {draftNews.map((item, i) => (
              <article key={`${item.title}-${i}`}>
                <Image
                  src={item.image}
                  alt=""
                  width={300}
                  height={170}
                  unoptimized
                />
                <strong>{item.title}</strong>
                <button
                  className={styles.deleteNews}
                  type="button"
                  onClick={() => deleteNews(item.id)}
                >
                  <Trash2 size={14}/> Excluir
                </button>
              </article>
            ))}
          </div>

          <button
            className={styles.saveNews}
            type="button"
            onClick={saveNews}
            disabled={savingNews}
          >
            <Save size={16}/> {savingNews ? "Salvando…" : "Salvar notícias"}
          </button>
        </section>

        {/* ── Gerenciamento de usuários ── */}
        <UsersSection/>
      </section>
    </SidebarLayout>
  );
}

/* ═══════════════════════════════════════════════════════════
   SEÇÃO DE USUÁRIOS
═══════════════════════════════════════════════════════════ */
function UsersSection() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);

  // form
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState(ROLES.ATTENDANT);
  const [sectorId, setSectorId] = useState("");

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUsers(data.users || []);
    } catch (err) {
      setMessage(err.message || "Erro ao carregar usuários");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setMessage("");
    setLoading(true);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          full_name: fullName,
          role,
          sector_id: sectorId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setMessage(`Usuário ${fullName} criado com sucesso!`);
      setUsername("");
      setPassword("");
      setFullName("");
      setRole(ROLES.ATTENDANT);
      setSectorId("");
      setShowForm(false);
      await loadUsers();
    } catch (err) {
      setMessage(err.message || "Erro ao criar usuário");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(userId, userName) {
    if (
      !window.confirm(
        `Excluir o usuário "${userName}"?\n\nEsta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const res = await fetch(`/api/users?id=${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setMessage(`Usuário ${userName} excluído com sucesso.`);
      await loadUsers();
    } catch (err) {
      setMessage(err.message || "Erro ao excluir usuário");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionTitle}>
        <div>
          <p>ACESSO</p>
          <h2>Gerenciamento de usuários</h2>
        </div>
        <button
          type="button"
          className={styles.addUserBtn}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? "Cancelar" : "+ Novo usuário"}
        </button>
      </div>

      {message && <div className={styles.alertBox}>{message}</div>}

      {/* Formulário de criação */}
      {showForm && (
        <form className={styles.userForm} onSubmit={handleCreate}>
          <div className={styles.formRow}>
            <label>
              Usuário
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="nome.sobrenome"
                pattern={USERNAME_REGEX}
                title={USERNAME_REGEX_LABEL}
                required
              />
            </label>

            <label>
              Senha
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </label>
          </div>

          <div className={styles.formRow}>
            <label>
              Nome completo
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nome Sobrenome"
                required
              />
            </label>

            <label>
              Função
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value={ROLES.ATTENDANT}>Atendente</option>
                <option value={ROLES.ADMIN}>Administrador</option>
              </select>
            </label>

            <label>
              Setor (opcional)
              <select
                value={sectorId}
                onChange={(e) => setSectorId(e.target.value)}
              >
                <option value="">Nenhum</option>
                {Object.values(SECTORS).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button type="submit" disabled={loading}>
            {loading ? "Criando…" : "Criar usuário"}
          </button>
        </form>
      )}

      {/* Lista de usuários */}
      <div className={styles.usersTable}>
        <h3>Usuários cadastrados</h3>
        {loading && <p className={styles.loadingMsg}>Carregando…</p>}
        {!loading && users.length === 0 && (
          <p className={styles.emptyMsg}>
            Nenhum usuário cadastrado. Clique em &quot;+ Novo usuário&quot; para criar o
            primeiro administrador.
          </p>
        )}
        {!loading && users.length > 0 && (
          <table>
            <thead>
            <tr>
              <th>Usuário</th>
              <th>Nome</th>
              <th>Função</th>
              <th>Setor</th>
              <th>Ações</th>
            </tr>
            </thead>
            <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username || "—"}</td>
                <td>{u.full_name}</td>
                <td>
                    <span
                      className={
                        u.role === ROLES.ADMIN
                          ? styles.badgeAdmin
                          : styles.badgeAttendant
                      }
                    >
                      {u.role === ROLES.ADMIN ? "Administrador" : "Atendente"}
                    </span>
                </td>
                <td>
                  {u.sector_id
                    ? SECTORS[u.sector_id]?.name || u.sector_id
                    : "—"}
                </td>
                <td>
                  <button
                    type="button"
                    className={styles.deleteUserBtn}
                    onClick={() => handleDelete(u.id, u.full_name)}
                    disabled={loading}
                  >
                    <Trash2 size={13}/> Excluir
                  </button>
                </td>
              </tr>
            ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   SEÇÃO DE SINCRONIZAÇÃO DE SENHAS
═══════════════════════════════════════════════════════════ */
function SyncSection() {
  const [syncSector, setSyncSector] = useState(DEFAULT_SECTOR);
  const [syncType, setSyncType] = useState(CALL_TYPES.NORMAL);
  const [syncNumber, setSyncNumber] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  async function handleSync(e) {
    e.preventDefault();
    setSyncMessage("");
    setSyncing(true);

    try {
      const num = parseInt(syncNumber, 10);
      if (!num || num < 1 || num > MAX_QUEUE_NUMBER) {
        setSyncMessage("Use um número entre 1 e 999.");
        return;
      }

      const res = await fetch("/api/queue/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sector: syncSector,
          type: syncType,
          nextNumber: num,
        }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setSyncMessage(data.message || `Próxima senha: ${data.numberStr}`);
      setSyncNumber("");
    } catch (err) {
      setSyncMessage(err.message || "Erro ao sincronizar senha.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionTitle}>
        <div>
          <p>CONTROLE</p>
          <h2>Sincronizar senhas</h2>
        </div>
      </div>

      <p className={styles.syncInfo}>
        Pule para um número específico de senha. Útil quando senhas são perdidas
        ou não aparecem nos monitores.
      </p>

      {syncMessage && <div className={styles.alertBox}>{syncMessage}</div>}

      <form className={styles.syncForm} onSubmit={handleSync}>
        <div className={styles.syncRow}>
          <label>
            Setor
            <select
              value={syncSector}
              onChange={(e) => setSyncSector(e.target.value)}
            >
              {Object.values(SECTORS).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>

          <label>
            Tipo
            <select
              value={syncType}
              onChange={(e) => setSyncType(e.target.value)}
            >
              <option value={CALL_TYPES.NORMAL}>Normal</option>
              <option value={CALL_TYPES.PREFERENCIAL}>Preferencial</option>
            </select>
          </label>

          <label>
            Próximo número
            <input
              type="number"
              min="1"
              max="999"
              value={syncNumber}
              onChange={(e) => setSyncNumber(e.target.value)}
              placeholder="Ex: 045"
              required
            />
          </label>

          <label>
            &nbsp;
            <button
              type="submit"
              className={styles.syncButton}
              disabled={syncing || !syncNumber}
            >
              {syncing ? "Sincronizando…" : "Sincronizar"}
            </button>
          </label>
        </div>
      </form>
    </section>
  );
}
