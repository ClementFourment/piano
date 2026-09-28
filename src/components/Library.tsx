import { useEffect, useRef, useState } from "react";
import type { ScoreMeta, User } from "../../shared/api";
import { api } from "../api";
import { EXTENSIONS_IMPORT, importerFichier } from "../fichiers";

interface Props {
  user: User;
  onOpen: (id: string) => void;
  onLogout: () => void;
}

const dateFr = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

export function Library({ user, onOpen, onLogout }: Props) {
  const [scores, setScores] = useState<ScoreMeta[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [aSupprimer, setASupprimer] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.scores().then(setScores, (e) => setError(e.message));
  }, []);

  async function importer(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    let dernier: string | null = null;
    try {
      for (const file of Array.from(files)) {
        const f = await importerFichier(file).catch((e: Error) => {
          throw new Error(`${file.name} : ${e.message}`);
        });
        const doc = await api.create(f.kind, f.data, f.title, f.composer);
        setScores((s) => [doc, ...(s ?? [])]);
        dernier = doc.id;
      }
      if (dernier && files.length === 1) onOpen(dernier);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function supprimer(id: string) {
    try {
      await api.remove(id);
      setScores((s) => s?.filter((x) => x.id !== id) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
    setASupprimer(null);
  }

  return (
    <div className="page">
      <header className="topbar">
        <h1 className="brand">
          <span aria-hidden>𝄞</span> Partitions
        </h1>
        <div className="spacer" />
        <span className="muted small">{user.firstname || user.login}</span>
        <button className="btn ghost small" onClick={onLogout}>
          Déconnexion
        </button>
      </header>

      <main className="library">
        <div className="library-actions">
          <h2>Mes partitions</h2>
          <div className="spacer" />
          <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? "Import…" : "⭱ Importer un fichier"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={EXTENSIONS_IMPORT}
            multiple
            hidden
            onChange={(e) => {
              importer(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        <p className="muted small">
          Formats acceptés : MusicXML (.musicxml, .xml, .mxl, exportés par MuseScore, Sibelius, Finale…), MEI, et les
          .json de l'ancien éditeur.
        </p>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        {scores === null && !error && <p className="muted">Chargement…</p>}
        {scores?.length === 0 && (
          <div className="empty">
            <p>Aucune partition pour l'instant.</p>
            <p className="muted small">Importez un fichier pour commencer.</p>
          </div>
        )}

        <ul className="score-list">
          {scores?.map((s) => (
            <li key={s.id} className="score-item">
              <button className="score-open" onClick={() => onOpen(s.id)}>
                <span className="score-title">{s.title}</span>
                <span className="muted small">
                  {s.composer && <>{s.composer} · </>}
                  modifiée le {dateFr.format(new Date(s.updatedAt))}
                </span>
                <span className="badges">
                  {s.kind === "mei" && <span className="badge">importée</span>}
                  {s.shareToken && <span className="badge accent">partagée</span>}
                </span>
              </button>
              {aSupprimer === s.id ? (
                <span className="confirm-inline">
                  Supprimer ?
                  <button className="btn small danger" onClick={() => supprimer(s.id)}>
                    Oui
                  </button>
                  <button className="btn small ghost" onClick={() => setASupprimer(null)}>
                    Non
                  </button>
                </span>
              ) : (
                <button className="btn small ghost" onClick={() => setASupprimer(s.id)} aria-label={`Supprimer ${s.title}`}>
                  🗑
                </button>
              )}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
