"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { LockKeyhole } from "lucide-react";
import { SESSION_KEY } from "../../lib/queue";
import { USERNAME_REGEX, USERNAME_REGEX_LABEL } from "../../lib/constants.js";
import styles from "./Login.module.css";
import brandIcon from "@/app/icon.ico";
import Image from "next/image";

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        username: login,
        password,
        redirect: false,
      });

      if (result?.error) {
        throw new Error("Usuário ou senha inválidos.");
      }

      // Busca a sessão estabelecida pelo Auth.js
      const res = await fetch("/api/auth/session");
      const session = await res.json();

      if (session?.user) {
        window.localStorage.setItem(
          SESSION_KEY,
          JSON.stringify({
            id: session.user.id,
            name: session.user.name,
            initials: session.user.initials,
            role: session.user.role,
            sector: session.user.sector,
            guiche: session.user.guiche,
          }),
        );
      }

      router.push("/home");
    } catch (err) {
      setError(err.message || "Usuário ou senha inválidos.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      {/* ── Hero ── */}
      <div className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.heroMark}>
            <Image
              src={brandIcon}
              alt="Logo"
              priority
            />
          </div>
          <h1>
            Sistema de
            <br />
            Atendimento
          </h1>
          <p>Gerenciamento de senhas e filas para unidades de saúde.</p>
          <div className={styles.heroDots}>
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>

      {/* ── Painel de login ── */}
      <div className={styles.side}>
        <div className={styles.panel}>
          {/* brand só no mobile */}
          <div className={styles.mobileBrand}>
            <div className={styles.brandMark}>S</div>
            <div>
              <strong>Central de Atendimento</strong>
              <span>Sistema de Senhas</span>
            </div>
          </div>

          <h2 className={styles.panelTitle}>Entrar no sistema</h2>
          <p className={styles.panelSub}>
            Digite suas credenciais para continuar.
          </p>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label>
              Usuário
              <input
                type="text"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="nome.sobrenome"
                autoComplete="username"
                autoFocus
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
                autoComplete="current-password"
                required
              />
            </label>

            {error && <div className={styles.errorBox}>{error}</div>}

            <button type="submit" disabled={loading}>
              <LockKeyhole size={17} />
              {loading ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
