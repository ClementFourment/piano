import { useEffect, useState } from "react";
import type { ScoreDoc, User } from "../shared/api";
import { api, ApiError } from "./api";
import { Library } from "./components/Library";
import { LoginPage } from "./components/LoginPage";
import { ScoreView } from "./components/ScoreView";

// Routes : /  (bibliothèque) · /p/<id> (partition) · /s/<jeton> (partition partagée, sans compte)
type Route = { page: "library" } | { page: "score"; id: string } | { page: "shared"; token: string };

function lireRoute(path: string): Route {
  const m = path.match(/^\/(p|s)\/([\w-]+)\/?$/);
  if (m?.[1] === "p") return { page: "score", id: m[2] };
  if (m?.[1] === "s") return { page: "shared", token: m[2] };
  return { page: "library" };
}

export function App() {
  const [route, setRoute] = useState(() => lireRoute(location.pathname));
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = pas encore vérifié

  useEffect(() => {
    api.me().then(setUser, () => setUser(null));
    const onPop = () => setRoute(lireRoute(location.pathname));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  function naviguer(path: string) {
    history.pushState(null, "", path);
    setRoute(lireRoute(path));
    scrollTo(0, 0);
  }

  async function deconnexion() {
    await api.logout().catch(() => {});
    setUser(null);
    naviguer("/");
  }

  // Une partition partagée s'ouvre sans compte.
  if (route.page === "shared") return <SharedScore token={route.token} />;

  if (user === undefined) return <p className="muted center pad">Chargement…</p>;
  if (user === null) return <LoginPage onLoggedIn={setUser} />;

  if (route.page === "score") return <OwnScore key={route.id} id={route.id} onBack={() => naviguer("/")} />;
  return <Library user={user} onOpen={(id) => naviguer(`/p/${id}`)} onLogout={deconnexion} />;
}

function OwnScore({ id, onBack }: { id: string; onBack: () => void }) {
  const [doc, setDoc] = useState<ScoreDoc | null>(null);
  const [erreur, setErreur] = useState("");
  useEffect(() => {
    api.score(id).then(setDoc, (e: ApiError) => setErreur(e.message));
  }, [id]);
  if (erreur) return <Erreur message={erreur} lien={{ texte: "← Bibliothèque", onClick: onBack }} />;
  if (!doc) return <p className="muted center pad">Chargement…</p>;
  return <ScoreView doc={doc} onBack={onBack} onChange={setDoc} />;
}

function SharedScore({ token }: { token: string }) {
  const [doc, setDoc] = useState<ScoreDoc | null>(null);
  const [erreur, setErreur] = useState("");
  useEffect(() => {
    api.shared(token).then(setDoc, (e: ApiError) => setErreur(e.message));
  }, [token]);
  if (erreur) return <Erreur message={erreur} />;
  if (!doc) return <p className="muted center pad">Chargement…</p>;
  return <ScoreView doc={doc} partage />;
}

function Erreur({ message, lien }: { message: string; lien?: { texte: string; onClick: () => void } }) {
  return (
    <div className="center pad">
      <p className="alert">{message}</p>
      {lien && (
        <button className="btn" onClick={lien.onClick}>
          {lien.texte}
        </button>
      )}
    </div>
  );
}
