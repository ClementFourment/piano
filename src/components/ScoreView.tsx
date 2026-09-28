import { useEffect, useMemo, useRef, useState } from "react";
import type { ScoreDoc } from "../../shared/api";
import type { Score } from "../../shared/score";
import { api } from "../api";
import { base64EnOctets, nomDeFichier, telecharger } from "../fichiers";
import { scoreToMei } from "../mei";
import { jouer, type Lecture } from "../player";
import { getToolkit, rendre, type Format } from "../verovio";

interface Props {
  doc: ScoreDoc;
  /** Lecture seule, ouverte par un lien de partage. */
  partage?: boolean;
  onBack?: () => void;
  onChange?: (doc: ScoreDoc) => void;
}

const ETROIT_MAX = 760;

export function ScoreView({ doc, partage = false, onBack, onChange }: Props) {
  const mei = useMemo(
    () => (doc.kind === "score" ? scoreToMei(JSON.parse(doc.data) as Score) : doc.data),
    [doc.kind, doc.data],
  );
  const [format, setFormat] = useState<Format>(() => (innerWidth < ETROIT_MAX ? "etroit" : "a4"));
  const [pages, setPages] = useState<string[] | null>(null);
  const [erreur, setErreur] = useState("");
  const [lecture, setLecture] = useState<"arret" | "chargement" | "lecture">("arret");
  const [pagesImpression, setPagesImpression] = useState<string[] | null>(null);
  const [menu, setMenu] = useState<"telecharger" | "partager" | null>(null);
  const [copie, setCopie] = useState(false);
  const feuilles = useRef<HTMLDivElement>(null);
  const lectureRef = useRef<Lecture | null>(null);

  // Format selon la largeur de l'écran.
  useEffect(() => {
    const onResize = () => setFormat(innerWidth < ETROIT_MAX ? "etroit" : "a4");
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);

  // Rendu de la partition.
  useEffect(() => {
    let annule = false;
    lectureRef.current?.arreter();
    getToolkit()
      .then((tk) => {
        if (!annule) setPages(rendre(tk, mei, format));
      })
      .catch((e: Error) => !annule && setErreur(e.message || "Impossible de charger le moteur de partitions."));
    return () => {
      annule = true;
    };
  }, [mei, format]);

  useEffect(() => () => lectureRef.current?.arreter(), []);

  // Impression : on rend la partition en A4, puis on ouvre la fenêtre d'impression.
  useEffect(() => {
    if (!pagesImpression) return;
    const fin = () => {
      setPagesImpression(null);
      // Verovio a été rechargé en A4 : on rétablit le rendu écran.
      getToolkit().then((tk) => setPages(rendre(tk, mei, format)));
    };
    addEventListener("afterprint", fin, { once: true });
    requestAnimationFrame(() => print());
    return () => removeEventListener("afterprint", fin);
  }, [pagesImpression, mei, format]);

  async function basculerLecture() {
    if (lecture !== "arret") {
      lectureRef.current?.arreter();
      return;
    }
    setLecture("chargement");
    try {
      const tk = await getToolkit();
      lectureRef.current = await jouer(tk, feuilles.current!, {
        onNote: (el) => {
          const r = el.getBoundingClientRect();
          if (r.top < 80 || r.bottom > innerHeight - 40) el.scrollIntoView({ block: "center", behavior: "smooth" });
        },
        onFin: () => {
          lectureRef.current = null;
          setLecture("arret");
        },
      });
      setLecture("lecture");
    } catch {
      setErreur("Impossible de charger le son du piano (connexion internet ?).");
      setLecture("arret");
    }
  }

  async function imprimer() {
    lectureRef.current?.arreter();
    const tk = await getToolkit();
    setPagesImpression(rendre(tk, mei, "a4"));
  }

  async function exporter(type: "midi" | "mei" | "json") {
    setMenu(null);
    const nom = nomDeFichier(doc.title);
    if (type === "json") return telecharger(doc.data, "application/json", `${nom}.json`);
    if (type === "mei") return telecharger(mei, "application/mei+xml", `${nom}.mei`);
    const tk = await getToolkit();
    tk.loadData(mei);
    telecharger(base64EnOctets(tk.renderToMIDI()), "audio/midi", `${nom}.mid`);
  }

  async function partager(actif: boolean) {
    try {
      const meta = actif ? await api.share(doc.id) : await api.unshare(doc.id);
      onChange?.({ ...doc, ...meta });
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  const lien = doc.shareToken ? `${location.origin}/s/${doc.shareToken}` : "";

  return (
    <>
    <div className="page score-page">
      <header className="topbar">
        {onBack && (
          <button className="btn ghost small" onClick={onBack}>
            ← Bibliothèque
          </button>
        )}
        <div className="score-heading">
          <h1>{doc.title}</h1>
          {doc.composer && <span className="muted small">{doc.composer}</span>}
        </div>
        <div className="spacer" />
        <div className="toolbar">
          <button className="btn primary" onClick={basculerLecture} disabled={!pages}>
            {lecture === "lecture" ? "⏹ Arrêter" : lecture === "chargement" ? "Chargement du piano…" : "▶ Écouter"}
          </button>

          <div className="menu-wrap">
            <button className="btn" onClick={() => setMenu(menu === "telecharger" ? null : "telecharger")} aria-expanded={menu === "telecharger"}>
              ⭳ Télécharger
            </button>
            {menu === "telecharger" && (
              <div className="menu" role="menu">
                <button role="menuitem" onClick={imprimer}>
                  PDF / Imprimer
                </button>
                <button role="menuitem" onClick={() => exporter("midi")}>
                  MIDI (.mid)
                </button>
                <button role="menuitem" onClick={() => exporter("mei")}>
                  MEI (s'ouvre dans MuseScore 4)
                </button>
                {doc.kind === "score" && (
                  <button role="menuitem" onClick={() => exporter("json")}>
                    Fichier de l'éditeur (.json)
                  </button>
                )}
              </div>
            )}
          </div>

          {!partage && (
            <div className="menu-wrap">
              <button className="btn" onClick={() => setMenu(menu === "partager" ? null : "partager")} aria-expanded={menu === "partager"}>
                🔗 Partager
              </button>
              {menu === "partager" && (
                <div className="menu share-menu">
                  {doc.shareToken ? (
                    <>
                      <p className="small">Toute personne ayant ce lien peut voir, écouter et télécharger la partition (sans la modifier).</p>
                      <div className="share-link">
                        <input readOnly value={lien} onFocus={(e) => e.target.select()} aria-label="Lien de partage" />
                        <button
                          className="btn small"
                          onClick={async () => {
                            await navigator.clipboard.writeText(lien);
                            setCopie(true);
                            setTimeout(() => setCopie(false), 1500);
                          }}
                        >
                          {copie ? "Copié ✓" : "Copier"}
                        </button>
                      </div>
                      <button className="btn small danger-outline" onClick={() => partager(false)}>
                        Arrêter le partage
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="small">La partition est privée. Créer un lien permet de la montrer à quelqu'un sans compte.</p>
                      <button className="btn small primary" onClick={() => partager(true)}>
                        Créer un lien de partage
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {menu && <div className="menu-backdrop" onClick={() => setMenu(null)} />}

      <main className="sheets" ref={feuilles}>
        {erreur && (
          <p className="alert" role="alert">
            {erreur}
          </p>
        )}
        {!pages && !erreur && <p className="muted center">Chargement de la partition…</p>}
        {pages?.map((svg, i) => (
          <div key={i} className="sheet" dangerouslySetInnerHTML={{ __html: svg }} />
        ))}
        {doc.kind === "mei" && !partage && (
          <p className="muted small center">Partition importée : lecture seule.</p>
        )}
      </main>
    </div>

    {/* Hors de .page, qui est masquée à l'impression. */}
    {pagesImpression && (
      <div className="print-only">
        {pagesImpression.map((svg, i) => (
          <div key={i} className="print-page" dangerouslySetInnerHTML={{ __html: svg }} />
        ))}
      </div>
    )}
    </>
  );
}
