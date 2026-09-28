// Visionneuse : partitions importées (MEI) et liens de partage, en lecture seule.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScoreDoc } from "../../shared/api";
import type { Score } from "../../shared/score";
import { scoreToMei } from "../mei";
import { jouer, type Lecture } from "../player";
import { getToolkit, rendre, type Format } from "../verovio";
import { DownloadMenu, ShareMenu, useImpression } from "./ScoreMenus";

interface Props {
  doc: ScoreDoc;
  /** Lecture seule, ouverte par un lien de partage. */
  partage?: boolean;
  onBack?: () => void;
  onChange?: (doc: ScoreDoc) => void;
}

export const ETROIT_MAX = 760;

export function useFormat(): Format {
  const [format, setFormat] = useState<Format>(() => (innerWidth < ETROIT_MAX ? "etroit" : "a4"));
  useEffect(() => {
    const onResize = () => setFormat(innerWidth < ETROIT_MAX ? "etroit" : "a4");
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);
  return format;
}

/** Bouton Écouter/Arrêter, branché sur le document chargé dans Verovio. */
export function useLecture(conteneur: React.RefObject<HTMLElement | null>) {
  const [etat, setEtat] = useState<"arret" | "chargement" | "lecture">("arret");
  const [erreur, setErreur] = useState("");
  const lecture = useRef<Lecture | null>(null);

  const arreter = useCallback(() => lecture.current?.arreter(), []);
  useEffect(() => arreter, [arreter]);

  async function basculer() {
    if (etat !== "arret") return arreter();
    setEtat("chargement");
    setErreur("");
    try {
      lecture.current = await jouer(await getToolkit(), conteneur.current!, {
        onNote: (el) => {
          const r = el.getBoundingClientRect();
          if (r.top < 80 || r.bottom > innerHeight - 40) el.scrollIntoView({ block: "center", behavior: "smooth" });
        },
        onFin: () => {
          lecture.current = null;
          setEtat("arret");
        },
      });
      setEtat("lecture");
    } catch {
      setErreur("Impossible de charger le son du piano (connexion internet ?).");
      setEtat("arret");
    }
  }

  const libelle = etat === "lecture" ? "⏹ Arrêter" : etat === "chargement" ? "Chargement du piano…" : "▶ Écouter";
  return { etat, basculer, arreter, libelle, erreur };
}

export function ScoreView({ doc, partage = false, onBack, onChange }: Props) {
  const mei = useMemo(
    () => (doc.kind === "score" ? scoreToMei(JSON.parse(doc.data) as Score) : doc.data),
    [doc.kind, doc.data],
  );
  const format = useFormat();
  const [pages, setPages] = useState<string[] | null>(null);
  const [erreur, setErreur] = useState("");
  const feuilles = useRef<HTMLDivElement>(null);
  const lecture = useLecture(feuilles);

  const rendreEcran = useCallback(() => {
    lecture.arreter();
    getToolkit()
      .then((tk) => setPages(rendre(tk, mei, format)))
      .catch((e: Error) => setErreur(e.message || "Impossible de charger le moteur de partitions."));
  }, [mei, format, lecture.arreter]);

  useEffect(rendreEcran, [rendreEcran]);
  const impression = useImpression(mei, rendreEcran);

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
            <button className="btn primary" onClick={lecture.basculer} disabled={!pages}>
              {lecture.libelle}
            </button>
            <DownloadMenu doc={doc} mei={mei} onImprimer={() => (lecture.arreter(), impression.imprimer())} />
            {!partage && onChange && <ShareMenu doc={doc} onChange={onChange} />}
          </div>
        </header>

        <main className="sheets" ref={feuilles}>
          {(erreur || lecture.erreur) && (
            <p className="alert" role="alert">
              {erreur || lecture.erreur}
            </p>
          )}
          {!pages && !erreur && <p className="muted center">Chargement de la partition…</p>}
          {pages?.map((svg, i) => (
            <div key={i} className="sheet" dangerouslySetInnerHTML={{ __html: svg }} />
          ))}
          {doc.kind === "mei" && !partage && <p className="muted small center">Partition importée : lecture seule.</p>}
        </main>
      </div>
      {/* Hors de .page, qui est masquée à l'impression. */}
      {impression.bloc}
    </>
  );
}
