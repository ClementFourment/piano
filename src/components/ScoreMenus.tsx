// Menus communs à la visionneuse et à l'éditeur : télécharger/imprimer et partager.

import { useEffect, useState, type ReactNode } from "react";
import type { ScoreDoc } from "../../shared/api";
import { api } from "../api";
import type { Score } from "../../shared/score";
import { base64EnOctets, nomDeFichier, telecharger } from "../fichiers";
import { scoreToMusicXml } from "../musicxml";
import { getToolkit, rendre } from "../verovio";

function Menu({ label, children, className = "" }: { label: ReactNode; children: (fermer: () => void) => ReactNode; className?: string }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <div className="menu-wrap">
      <button className="btn" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert}>
        {label}
      </button>
      {ouvert && (
        <>
          <div className="menu-backdrop" onClick={() => setOuvert(false)} />
          <div className={`menu ${className}`}>{children(() => setOuvert(false))}</div>
        </>
      )}
    </div>
  );
}

interface DownloadProps {
  doc: ScoreDoc;
  /** Document MEI actuellement affiché. */
  mei: string;
  /** Contenu JSON à jour (éditeur), sinon doc.data. */
  json?: string;
  onImprimer: () => void;
}

export function DownloadMenu({ doc, mei, json, onImprimer }: DownloadProps) {
  async function exporter(type: "midi" | "mei" | "json" | "musicxml") {
    const nom = nomDeFichier(doc.title);
    if (type === "json") return telecharger(json ?? doc.data, "application/json", `${nom}.json`);
    if (type === "musicxml") {
      const xml = scoreToMusicXml(JSON.parse(json ?? doc.data) as Score);
      return telecharger(xml, "application/vnd.recordare.musicxml+xml", `${nom}.musicxml`);
    }
    if (type === "mei") return telecharger(mei, "application/mei+xml", `${nom}.mei`);
    const tk = await getToolkit();
    tk.loadData(mei);
    telecharger(base64EnOctets(tk.renderToMIDI()), "audio/midi", `${nom}.mid`);
  }
  return (
    <Menu label="⭳ Télécharger">
      {(fermer) => (
        <>
          <button role="menuitem" onClick={() => (fermer(), onImprimer())}>
            PDF / Imprimer
          </button>
          {doc.kind === "score" && (
            <button role="menuitem" onClick={() => (fermer(), exporter("musicxml"))}>
              MusicXML (MuseScore, Sibelius, Finale…)
            </button>
          )}
          <button role="menuitem" onClick={() => (fermer(), exporter("midi"))}>
            MIDI (.mid)
          </button>
          <button role="menuitem" onClick={() => (fermer(), exporter("mei"))}>
            MEI
          </button>
          {doc.kind === "score" && (
            <button role="menuitem" onClick={() => (fermer(), exporter("json"))}>
              Fichier de l'éditeur (.json)
            </button>
          )}
        </>
      )}
    </Menu>
  );
}

export function ShareMenu({ doc, onChange }: { doc: ScoreDoc; onChange: (doc: ScoreDoc) => void }) {
  const [copie, setCopie] = useState(false);
  const [erreur, setErreur] = useState("");
  const lien = doc.shareToken ? `${location.origin}/s/${doc.shareToken}` : "";

  async function partager(actif: boolean) {
    try {
      const meta = actif ? await api.share(doc.id) : await api.unshare(doc.id);
      onChange({ ...doc, shareToken: meta.shareToken });
    } catch (e) {
      setErreur((e as Error).message);
    }
  }

  return (
    <Menu label="🔗 Partager" className="share-menu">
      {() => (
        <>
          {erreur && <p className="alert small">{erreur}</p>}
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
        </>
      )}
    </Menu>
  );
}

/**
 * Impression : rend la partition en A4 dans un bloc réservé à l'impression,
 * ouvre la fenêtre d'impression, puis appelle `apres` (pour rétablir le rendu écran,
 * Verovio ne gardant qu'un document chargé à la fois).
 */
export function useImpression(mei: string, apres: () => void) {
  const [pages, setPages] = useState<string[] | null>(null);

  useEffect(() => {
    if (!pages) return;
    const fin = () => {
      setPages(null);
      apres();
    };
    addEventListener("afterprint", fin, { once: true });
    requestAnimationFrame(() => print());
    return () => removeEventListener("afterprint", fin);
  }, [pages, apres]);

  const imprimer = async () => setPages(rendre(await getToolkit(), mei, "a4"));

  const bloc = pages && (
    <div className="print-only">
      {pages.map((svg, i) => (
        <div key={i} className="print-page" dangerouslySetInnerHTML={{ __html: svg }} />
      ))}
    </div>
  );
  return { imprimer, bloc };
}
