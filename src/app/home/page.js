"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Monitor, Settings2, Headphones } from "lucide-react";
import { getSessionSnapshot, SECTORS } from "../../lib/queue";
import { ROLES } from "../../lib/constants.js";
import styles from "./Home.module.css";
import { SidebarLayout } from "@/components/SidebarLayout/SidebarLayout";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    if (!getSessionSnapshot()) router.push("/login");
  }, [router]);

  const session = getSessionSnapshot();
  if (!session) return null;

  return (
    <SidebarLayout
      activeRoute="home"
      session={session}
      sectorInfo={""}
      eyebrow="BEM-VINDO"
      title="O que deseja fazer?"
      subtitle=""
      headerActions={null}
    >
        {/* ── Conteúdo ── */}
        <div className={styles.content}>
          <div className={styles.grid}>

            {/* Monitores */}
            {Object.values(SECTORS).map((s) => (
              <Link key={s.id} href={`/monitor/${s.id}`} className={styles.card}>
                <div className={`${styles.cardIcon} ${styles.cardIconMonitor}`}>
                  <Monitor size={30} />
                </div>
                <div className={styles.cardBody}>
                  <strong>Monitor</strong>
                  <span>{s.name}</span>
                </div>
                <div className={styles.cardArrow}>→</div>
              </Link>
            ))}

            {/* Painel de Atendimento */}
            <Link href="/painel" className={`${styles.card} ${styles.cardAdmin}`}>
              <div className={`${styles.cardIcon} ${styles.cardIconAtendimento}`}>
                <Headphones size={30} />
              </div>
              <div className={styles.cardBody}>
                <strong>Painel de Atendimento</strong>
                <span>Controle as chamadas em tempo real</span>
              </div>
              <div className={styles.cardArrow}>→</div>
            </Link>

            {/* Admin — só para admins */}
            {session.role === ROLES.ADMIN && (
              <Link href="/admin" className={`${styles.card} ${styles.cardAdmin}`}>
                <div className={`${styles.cardIcon} ${styles.cardIconAdmin}`}>
                  <Settings2 size={30} />
                </div>
                <div className={styles.cardBody}>
                  <strong>Administração</strong>
                  <span>Filas, notícias e estatísticas</span>
                </div>
                <div className={styles.cardArrow}>→</div>
              </Link>
            )}

          </div>
        </div>
    </SidebarLayout>
  );
}
