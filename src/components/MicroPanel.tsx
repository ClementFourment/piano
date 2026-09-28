// Enregistrement au micro : métronome + décompte, transcription en continu, aperçu, insertion.

import { useEffect, useRef, useState } from "react";
import type { KeySignature, Measure, Score } from "../../shared/score";
import { ouvrirMicro, type Micro } from "../micro/capture";
import { SENSIBILITES, versMesures, type NoteEntendue, type Sensibilite } from "../micro/partition";
import { TranscripteurDistant } from "../micro/transcripteur";

interface Props {
  tempo: number;
  timeSig: Score["timeSig"];
  armure: KeySignature;
  /** Mesures provisoires à afficher pendant l'enregistrement (null = rien). */
  onApercu: (mesures: Measure[] | null) => void;
  /** Enregistrement terminé : mesures à insérer dans la partition. */
  onTermine: (mesures: Measure[]) => void;
  onFermer: () => void;
}

type Etape = "reglages" | "preparation" | "decompte" | "enregistrement" | "finalisation";

/** Latence d'entrée du micro, non mesurable par le navigateur : estimation. */
const LATENCE_ENTREE = 0.02;
/** Programmation du métronome : on prévoit les clics 0,5 s à l'avance. */
const AVANCE = 0.5;

export function MicroPanel({ tempo: tempoPartition, timeSig, armure, onApercu, onTermine, onFermer }: Props) {
  const [etape, setEtape] = useState<Etape>("reglages");
  const [tempo, setTempo] = useState(tempoPartition);
  const [sensibilite, setSensibilite] = useState<Sensibilite>("normale");
  const [grille, setGrille] = useState(0.25);
  const [clicSonore, setClicSonore] = useState(true);
  const [erreur, setErreur] = useState("");
  const [temps, setTemps] = useState<{ mesure: number; temps: number } | null>(null);
  const [niveau, setNiveau] = useState(0);
  const [nbNotes, setNbNotes] = useState(0);

  const session = useRef<{
    micro: Micro;
    tr: TranscripteurDistant;
    premierTempsCtx: number; // instant (horloge audio) du premier temps de la 1re mesure
    premierTemps: number; // même instant, en secondes depuis le début de la capture
    prochainClic: number; // numéro du prochain clic à programmer (0 = début du décompte)
    debutClics: number;
    minuteur: number;
    raf: number;
    analyse: number;
    notes: NoteEntendue[];
  } | null>(null);

  // Toujours les fonctions de rappel les plus récentes (les callbacks de la session vivent longtemps).
  const rappels = useRef({ onApercu, onTermine });
  rappels.current = { onApercu, onTermine };

  const noire = 60 / tempo;
  const options = () => ({
    tempo,
    timeSig,
    armure,
    grille,
    premierTemps: session.current?.premierTemps ?? 0,
    amplitudeMin: SENSIBILITES[sensibilite],
  });

  // Nettoyage si le panneau est fermé en cours de route.
  useEffect(() => () => arreterTout(), []);

  function arreterTout() {
    const s = session.current;
    if (!s) return;
    clearInterval(s.minuteur);
    clearInterval(s.analyse);
    cancelAnimationFrame(s.raf);
    s.micro.fermer();
    s.tr.fermer();
    session.current = null;
  }

  async function commencer() {
    setErreur("");
    setEtape("preparation");
    let tr: TranscripteurDistant | null = null;
    try {
      tr = new TranscripteurDistant();
      await tr.demarrer();
      const trRef = tr;
      const micro = await ouvrirMicro((bloc) => trRef.pousser(bloc));
      const debutClics = micro.ctx.currentTime + 0.4;
      const latenceSortie = micro.ctx.outputLatency || micro.ctx.baseLatency || 0;
      const premierTempsCtx = debutClics + timeSig.num * noire * (4 / timeSig.den);
      const s = {
        micro,
        tr,
        premierTempsCtx,
        premierTemps: premierTempsCtx + latenceSortie + LATENCE_ENTREE - micro.debutCapture,
        prochainClic: 0,
        debutClics,
        minuteur: 0,
        raf: 0,
        analyse: 0,
        notes: [] as NoteEntendue[],
      };
      session.current = s;

      tr.onNotes = (notes, final) => {
        s.notes = notes;
        setNbNotes(notes.length);
        const mesures = versMesures(notes, { ...options(), premierTemps: s.premierTemps });
        if (final) {
          arreterTout();
          rappels.current.onApercu(null);
          rappels.current.onTermine(mesures);
        } else {
          rappels.current.onApercu(mesures);
        }
      };
      tr.onErreur = (m) => setErreur(`Transcription interrompue : ${m}`);

      // Métronome : un clic par temps (fort sur le premier temps de la mesure).
      const dureeTemps = noire * (4 / timeSig.den);
      const programmer = () => {
        const limite = micro.ctx.currentTime + AVANCE;
        while (s.debutClics + s.prochainClic * dureeTemps < limite) {
          const t = s.debutClics + s.prochainClic * dureeTemps;
          const fort = s.prochainClic % timeSig.num === 0;
          // Le décompte est toujours audible ; ensuite, selon le réglage.
          if (clicSonore || s.prochainClic < timeSig.num) micro.clic(t, fort, 1);
          s.prochainClic++;
        }
      };
      programmer();
      s.minuteur = window.setInterval(programmer, 100);

      // Affichage du temps courant et du niveau du micro.
      const afficher = () => {
        const ecoule = micro.ctx.currentTime - s.debutClics;
        const n = Math.floor(ecoule / dureeTemps);
        if (n >= 0) setTemps({ mesure: Math.floor(n / timeSig.num) - 1, temps: n % timeSig.num });
        setEtape(micro.ctx.currentTime < s.premierTempsCtx ? "decompte" : "enregistrement");
        setNiveau(micro.niveau());
        s.raf = requestAnimationFrame(afficher);
      };
      afficher();

      // Analyse régulière du son reçu.
      s.analyse = window.setInterval(() => tr!.analyser(), 700);
    } catch (e) {
      tr?.fermer();
      arreterTout();
      const err = e as DOMException;
      setErreur(
        err.name === "NotAllowedError"
          ? "Le navigateur n'a pas l'autorisation d'utiliser le micro. Autorisez-le (icône à gauche de l'adresse), puis réessayez."
          : err.name === "NotFoundError"
            ? "Aucun micro trouvé."
            : `Impossible de démarrer : ${err.message}`,
      );
      setEtape("reglages");
    }
  }

  function terminer() {
    const s = session.current;
    if (!s) return;
    setEtape("finalisation");
    clearInterval(s.minuteur);
    clearInterval(s.analyse);
    cancelAnimationFrame(s.raf);
    s.tr.finir(); // la réponse finale déclenche onTermine (voir onNotes)
  }

  function annuler() {
    arreterTout();
    onApercu(null);
    onFermer();
  }

  const enCours = etape === "decompte" || etape === "enregistrement";

  return (
    <div className="micro-panel" role="dialog" aria-label="Enregistrer au micro">
      <div className="micro-tete">
        <strong>🎤 Jouer au micro</strong>
        <button className="btn ghost small" onClick={annuler} aria-label="Fermer">
          ✕
        </button>
      </div>

      {erreur && <p className="alert small">{erreur}</p>}

      {etape === "reglages" && (
        <>
          <p className="small muted">
            Les notes s'écrivent à partir de la mesure du curseur. Un décompte d'une mesure précède l'enregistrement ;
            jouez en suivant le métronome (au casque si possible). Les notes apparaissent avec environ 2 s de retard.
          </p>
          <div className="micro-grille">
            <label>
              Tempo
              <input type="number" min={30} max={240} value={tempo} onChange={(e) => setTempo(Math.max(30, Math.min(240, Number(e.target.value) || tempo)))} />
            </label>
            <label>
              Plus petite valeur
              <select value={grille} onChange={(e) => setGrille(Number(e.target.value))}>
                <option value={0.5}>Croche</option>
                <option value={0.25}>Double croche</option>
              </select>
            </label>
            <label>
              Sensibilité
              <select value={sensibilite} onChange={(e) => setSensibilite(e.target.value as Sensibilite)}>
                <option value="haute">Haute (jeu doux)</option>
                <option value="normale">Normale</option>
                <option value="basse">Basse (moins de fausses notes)</option>
              </select>
            </label>
            <label className="dot-row">
              <input type="checkbox" checked={clicSonore} onChange={(e) => setClicSonore(e.target.checked)} /> Métronome sonore
            </label>
          </div>
          <p className="small muted">Main droite à partir du Do central, main gauche en dessous.</p>
          <button className="btn primary block" onClick={commencer}>
            Commencer
          </button>
        </>
      )}

      {etape === "preparation" && <p className="small">Préparation du micro et de la reconnaissance des notes…</p>}

      {enCours && (
        <>
          <div className="micro-temps" aria-live="off">
            {Array.from({ length: timeSig.num }, (_, i) => (
              <span key={i} className={`point${temps?.temps === i ? " actif" : ""}${i === 0 ? " fort" : ""}`} />
            ))}
          </div>
          <p className="small center">
            {etape === "decompte"
              ? "Décompte… préparez-vous"
              : `Mesure ${Math.max(1, (temps?.mesure ?? 0) + 1)} · ${nbNotes} note${nbNotes > 1 ? "s" : ""} entendue${nbNotes > 1 ? "s" : ""}`}
          </p>
          <div className="niveau" title="Niveau du micro">
            <div style={{ width: `${Math.round(niveau * 100)}%` }} />
          </div>
          <div className="row2">
            <button className="btn" onClick={annuler}>
              Annuler
            </button>
            <button className="btn primary" onClick={terminer}>
              ■ Terminer
            </button>
          </div>
        </>
      )}

      {etape === "finalisation" && <p className="small">Dernière analyse et mise en partition…</p>}
    </div>
  );
}
