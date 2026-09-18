"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Filter,
} from "lucide-react";
import {
  formatQueueNumber,
  getServerSessionSnapshot,
  getSessionSnapshot,
  subscribeSession,
} from "../../lib/queue";
import { SECTORS, ROLES, CALL_TYPES, PAGE_SIZES, DEFAULT_SECTOR } from "../../lib/constants.js";
import { SidebarLayout, sidebarStyles } from "../../components/SidebarLayout/SidebarLayout";
import styles from "./Historico.module.css";

const ITEMS_PER_PAGE = PAGE_SIZES.historico;

const emptySubscribe = () => () => {};
function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export default function HistoricoPage() {
  const router   = useRouter();
  const isClient = useIsClient();

  const session = useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getServerSessionSnapshot
  );

  const [activeSector, setActiveSector] = useState(DEFAULT_SECTOR);
  const [filterDays, setFilterDays] = useState("30");
  const [filterType, setFilterType] = useState("");
  const [stats, setStats]           = useState(null);
  const [loading, setLoading]       = useState(false);
  const [page, setPage]             = useState(1);

  useEffect(() => {
    const stored = getSessionSnapshot();
    if (!stored) router.push("/login");
  }, [router]);

  useEffect(() => {
    if (session?.role !== ROLES.ADMIN && session?.sector) {
      setActiveSector(session.sector);
    }
  }, [session?.role, session?.sector]);

  const fetchStats = (overrides = {}) => {
    const days   = overrides.days !== undefined ? overrides.days : filterDays;
    const sector = overrides.sector !== undefined ? overrides.sector : activeSector;

    const params = new URLSearchParams({ days });
    if (sector) params.set("sector", sector);

    setLoading(true);
    fetch(`/api/stats?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { setStats(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchStats();
    setPage(1);
  }, [activeSector]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isClient || !session) return null;

  const sectorInfo = SECTORS[activeSector] || SECTORS.farmacia;

  let allCalls = stats?.recent || [];
  if (filterType) {
    allCalls = allCalls.filter((c) => c.type === filterType);
  }

  const totalPages = Math.max(1, Math.ceil(allCalls.length / ITEMS_PER_PAGE));
  const pagedCalls = allCalls.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  return (
    <SidebarLayout
      activeRoute="historico"
      session={session}
      sectorInfo={sectorInfo}
      eyebrow="HISTÓRICO DE ATENDIMENTOS"
      title="Histórico completo"
      subtitle="Consulte todas as chamadas de senhas realizadas."
      headerActions={
        <>
          {session?.role === ROLES.ADMIN && (
            <select
              className={sidebarStyles.sectorSelect}
              value={activeSector}
              onChange={(e) => { setActiveSector(e.target.value); setPage(1); }}
            >
              {Object.values(SECTORS).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </>
      }
    >
      {/* ── Filtros ── */}
      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <label>Período</label>
          <select
            value={filterDays}
            onChange={(e) => { setFilterDays(e.target.value); setPage(1); }}
          >
            <option value="1">Hoje</option>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label>Tipo</label>
          <select
            value={filterType}
            onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
          >
            <option value="">Todos</option>
            <option value="normal">Normal</option>
            <option value="preferencial">Preferencial</option>
          </select>
        </div>
        <button
          className={styles.filterBtn}
          type="button"
          onClick={() => fetchStats()}
        >
          <Filter size={14} /> Filtrar
        </button>
      </div>

      {/* ── Stats ── */}
      {stats && (
        <div className={styles.statsGrid}>
          <article className={styles.statCard}>
            <strong>{stats.summary?.total ?? 0}</strong>
            <span>Total no período</span>
          </article>
          <article className={styles.statCard}>
            <strong>{stats.summary?.today ?? 0}</strong>
            <span>Atendimentos hoje</span>
          </article>
          <article className={`${styles.statCard} ${styles.statCardNormal}`}>
            <strong>{stats.summary?.normal ?? 0}</strong>
            <span>Senhas normais</span>
          </article>
          <article className={`${styles.statCard} ${styles.statCardPref}`}>
            <strong>{stats.summary?.preferencial ?? 0}</strong>
            <span>Preferenciais</span>
          </article>
        </div>
      )}

      {/* ── Tabela ── */}
      <section className={styles.historySection}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.label}>REGISTROS</span>
            <h2>Chamadas de senhas</h2>
          </div>
        </div>

        {loading && <p className={styles.loadingMsg}>Carregando...</p>}

        {!loading && pagedCalls.length === 0 && (
          <p className={styles.emptyMsg}>Nenhuma chamada encontrada para os filtros selecionados.</p>
        )}

        {!loading && pagedCalls.length > 0 && (
          <>
            <div className={styles.table}>
              <div className={styles.tableHead}>
                <span>SENHA</span>
                <span>TIPO</span>
                <span>HORÁRIO</span>
                <span>SETOR</span>
              </div>
              {pagedCalls.map((item, index) => (
                <div
                  className={styles.tableRow}
                  key={`${item.id || item.number}-${index}`}
                >
                  <strong>{formatQueueNumber(item.number, item.type)}</strong>
                  <span className={item.type === CALL_TYPES.PREFERENCIAL ? styles.priorityTag : styles.normalTag}>
                    {item.type === CALL_TYPES.PREFERENCIAL ? "Preferencial" : "Normal"}
                  </span>
                  <span>{item.time}</span>
                  <span className={styles.sectorTag}>
                    {SECTORS[item.sector_id]?.shortName || item.sector_id || "—"}
                  </span>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className={styles.pagination}>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  ← Anterior
                </button>
                <span className={styles.pageInfo}>
                  Página {page} de {totalPages}
                </span>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Próxima →
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </SidebarLayout>
  );
}
