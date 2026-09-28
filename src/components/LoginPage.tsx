import { useState, type FormEvent } from "react";
import type { User } from "../../shared/api";
import { api } from "../api";

export function LoginPage({ onLoggedIn }: { onLoggedIn: (u: User) => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLoggedIn(await api.login(login, password));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="login-clef" aria-hidden>𝄞</div>
        <h1>Partitions</h1>
        <p className="muted">Connectez-vous pour retrouver vos partitions.</p>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <label htmlFor="login">Identifiant</label>
        <input
          id="login"
          autoComplete="username"
          autoCapitalize="none"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          required
        />

        <label htmlFor="password">Mot de passe</label>
        <div className="pwd">
          <input
            id="password"
            type={showPwd ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="button" className="btn ghost small" onClick={() => setShowPwd((v) => !v)}>
            {showPwd ? "Masquer" : "Afficher"}
          </button>
        </div>

        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? "Connexion…" : "Se connecter"}
        </button>
        <p className="muted small">Les comptes sont créés sur invitation.</p>
      </form>
    </main>
  );
}
