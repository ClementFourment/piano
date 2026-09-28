// Éditeur de partition : palette à gauche, partition gravée par Verovio à droite.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ScoreDoc } from "../../shared/api";
import {
  LETTERS,
  measureCapacity,
  noteBeats,
  type Accidental,
  type Clef,
  type Duration,
  type KeySignature,
  type Letter,
  type Score,
} from "../../shared/score";
import { api } from "../api";
import * as M from "../editor/model";
import { scoreToMei } from "../mei";
import { getToolkit, rendre } from "../verovio";
import { NOMS_NOTES, Palette } from "./Palette";
import { DownloadMenu, ShareMenu, useImpression } from "./ScoreMenus";
import { useFormat, useLecture } from "./ScoreView";

interface Props {
  doc: ScoreDoc;
  onBack: () => void;
  onChange: (doc: ScoreDoc) => void;
}

const HISTORIQUE_MAX = 200;
const DELAI_SAUVEGARDE = 1200;
const DUREE_TOUCHE: Record<string, Duration> = { "3": "sixteenth", "4": "eighth", "5": "quarter", "6": "half", "7": "whole" };
const ALTERATION_TOUCHE: Record<string, NonNullable<Accidental>> = { "+": "sharp", "-": "flat", "=": "natural" };

type Sauvegarde = "ok" | "attente" | "encours" | "erreur";

export function Editor({ doc, onBack, onChange }: Props) {
  // ── État de la partition et historique ──
  const [etat, setEtat] = useState<M.Etat>(() => {
    const score = JSON.parse(doc.data) as Score;
    return { score, curseur: { mesure: 0, cle: "treble", index: score.measures[0]?.treble.length ?? 0 }, selection: null };
  });
  const [passe, setPasse] = useState<M.Etat[]>([]);
  const [futur, setFutur] = useState<M.Etat[]>([]);
  const { score, curseur, selection } = etat;

  // ── État de la palette ──
  const [octaves, setOctaves] = useState<Record<Clef, number>>({ treble: 4, bass: 3 });
  const [duree, setDuree] = useState<Duration>("quarter");
  const [pointee, setPointee] = useState(false);
  const [triolet, setTriolet] = useState(false);
  const [alteration, setAlteration] = useState<Accidental>(null);
  const [modeAccord, setModeAccord] = useState(false);
  const [paletteOuverte, setPaletteOuverte] = useState(false);
  const [message, setMessage] = useState("");

  const signaler = useCallback((texte: string) => setMessage(texte), []);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 3500);
    return () => clearTimeout(t);
  }, [message]);

  /** Applique le résultat d'une opération (ou affiche son message d'erreur). */
  function appliquer(res: M.Resultat, historique = true) {
    if (typeof res === "string") return signaler(res);
    if (historique && res.score !== etat.score) {
      setPasse((p) => [...p.slice(-HISTORIQUE_MAX + 1), etat]);
      setFutur([]);
    }
    setEtat(res);
  }

  function annuler() {
    if (!passe.length) return;
    setFutur((f) => [etat, ...f]);
    setEtat(passe[passe.length - 1]);
    setPasse((p) => p.slice(0, -1));
  }
  function retablir() {
    if (!futur.length) return;
    setPasse((p) => [...p, etat]);
    setEtat(futur[0]);
    setFutur((f) => f.slice(1));
  }

  // La palette reflète la note sélectionnée.
  const noteSelectionnee = selection ? M.cible(etat) : null;
  useEffect(() => {
    if (!noteSelectionnee) return;
    setDuree(noteSelectionnee.duration);
    setPointee(noteSelectionnee.dotted);
    setTriolet(!!noteSelectionnee.triolet);
  }, [noteSelectionnee]);

  // ── Commandes ──
  const cle = curseur.cle;

  function note(letter: Letter, accord = false) {
    const pitch = { letter, accidental: alteration, octave: octaves[cle] };
    setAlteration(null);
    if (accord || modeAccord) return appliquer(M.ajouterAuAccord(etat, pitch));
    if (selection) return appliquer(M.remplacerHauteur(etat, selection, pitch));
    appliquer(M.inserer(etat, { pitches: [pitch], duration: duree, dotted: pointee, triolet }));
  }

  function silence() {
    if (selection) return appliquer(M.enSilence(etat, selection));
    appliquer(M.inserer(etat, { pitches: [], duration: duree, dotted: pointee, triolet }));
  }

  function choisirDuree(d: Duration, dot = pointee) {
    setDuree(d);
    setPointee(dot);
    if (selection) appliquer(M.changerDuree(etat, selection, d, dot));
  }

  /** Sur une sélection, bascule la note ; sinon, les prochaines notes seront (ou non) des triolets. */
  function basculerTriolet() {
    if (selection) return appliquer(M.basculerTriolet(etat, selection));
    setTriolet((t) => !t);
  }

  /** Palette : sur une sélection, change la note ; sinon, prépare la prochaine. */
  function choisirAlteration(a: NonNullable<Accidental>) {
    if (selection) return appliquer(M.basculerAlteration(etat, selection, a));
    setAlteration((x) => (x === a ? null : a));
  }

  /** Applique une commande à la note visée : la sélection, sinon la dernière saisie. */
  function surCible(op: (id: string) => M.Resultat) {
    const n = M.cible(etat);
    if (!n) return signaler("Sélectionnez une note (clic), ou saisissez-en une d'abord.");
    appliquer(op(n.id));
  }

  function effacer() {
    if (selection) return appliquer(M.supprimer(etat, selection));
    appliquer(M.supprimerAvant(etat));
  }

  function changerCle(c: Clef) {
    const index = score.measures[curseur.mesure][c].length;
    appliquer({ ...etat, selection: null, curseur: { mesure: curseur.mesure, cle: c, index } }, false);
  }

  function allerMesure(delta: -1 | 1) {
    const mesure = Math.max(0, Math.min(score.measures.length - 1, curseur.mesure + delta));
    appliquer({ ...etat, selection: null, curseur: { mesure, cle, index: score.measures[mesure][cle].length } }, false);
  }

  function modifierScore(patch: Partial<Score>) {
    appliquer({ ...etat, score: { ...score, ...patch } }, false);
  }

  // ── Clavier ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target;
      if (t instanceof Element && t.closest("input, select, textarea, [contenteditable]")) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key;

      if (ctrl) {
        const kl = k.toLowerCase();
        if (kl === "z" && !e.shiftKey) annuler();
        else if (kl === "y" || (kl === "z" && e.shiftKey)) retablir();
        else if (kl === "s") sauverMaintenant();
        else if (k === "ArrowUp" || k === "ArrowDown") {
          const n = M.cible(etat);
          if (n) appliquer(M.transposer(etat, n.id, k === "ArrowUp" ? 7 : -7));
        } else return;
        return e.preventDefault();
      }
      if (e.altKey) return;

      const lettre = k.toUpperCase();
      if (k.length === 1 && (LETTERS as readonly string[]).includes(lettre)) note(lettre as Letter, e.shiftKey);
      else if (k === "0") silence();
      else if (DUREE_TOUCHE[k]) choisirDuree(DUREE_TOUCHE[k]);
      else if (k === ".") choisirDuree(duree, !pointee);
      else if (ALTERATION_TOUCHE[k]) {
        // Clavier : agit sur la dernière note saisie (ou la sélection), comme MuseScore.
        const n = M.cible(etat);
        if (n) appliquer(M.basculerAlteration(etat, n.id, ALTERATION_TOUCHE[k]));
      } else if (k === "ArrowUp" || k === "ArrowDown") {
        const n = M.cible(etat);
        if (n && !n.rest) appliquer(M.transposer(etat, n.id, k === "ArrowUp" ? 1 : -1));
        else setOctaves((o) => ({ ...o, [cle]: Math.max(0, Math.min(8, o[cle] + (k === "ArrowUp" ? 1 : -1))) }));
      } else if (k === "ArrowLeft" || k === "ArrowRight") appliquer(M.naviguer(etat, k === "ArrowLeft" ? -1 : 1), false);
      else if (k === "Tab") changerCle(cle === "treble" ? "bass" : "treble");
      else if (k.toLowerCase() === "t") basculerTriolet();
      else if (k.toLowerCase() === "s") surCible((id) => M.articuler(etat, id, "staccato"));
      else if (k.toLowerCase() === "l") surCible((id) => (e.shiftKey ? M.delier(etat, id) : M.lier(etat, id)));
      else if (k === "<" || k === ">") surCible((id) => M.soufflet(etat, id, k === "<" ? "cres" : "dim"));
      else if (k === "Backspace" || k === "Delete") effacer();
      else if (k === "Escape") appliquer({ ...etat, selection: null }, false);
      else if (k === " ") lecture.basculer();
      else return;
      e.preventDefault();
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  // ── Rendu Verovio ──
  const mei = useMemo(() => scoreToMei(score), [score]);
  const format = useFormat();
  const [pages, setPages] = useState<string[] | null>(null);
  const [erreur, setErreur] = useState("");
  const feuilles = useRef<HTMLDivElement>(null);
  const lecture = useLecture(feuilles);

  const rendreEcran = useCallback(() => {
    getToolkit()
      .then((tk) => setPages(rendre(tk, mei, format)))
      .catch((e: Error) => setErreur(e.message || "Impossible de charger le moteur de partitions."));
  }, [mei, format]);
  useEffect(() => {
    lecture.arreter();
    rendreEcran();
  }, [rendreEcran, lecture.arreter]);
  const impression = useImpression(mei, rendreEcran);

  // ── Curseur et sélection dans le SVG ──
  const [repere, setRepere] = useState<{ portee: DOMRect; x: number } | null>(null);

  const placerRepere = useCallback(() => {
    const racine = feuilles.current;
    if (!racine || !pages) return;
    racine.querySelectorAll(".selectionnee").forEach((el) => el.classList.remove("selectionnee"));
    if (selection) racine.querySelector(`[id="${CSS.escape(selection)}"]`)?.classList.add("selectionnee");

    const mesure = score.measures[curseur.mesure];
    const staff = mesure && porteeSvg(racine, mesure.id, curseur.cle);
    if (!staff) return setRepere(null);
    const lignes = rectLignes(staff);
    const base = racine.getBoundingClientRect();
    const notes = mesure[curseur.cle];
    let x: number;
    const avant = notes[curseur.index - 1] && racine.querySelector(`[id="${CSS.escape(notes[curseur.index - 1].id)}"]`);
    const apres = notes[curseur.index] && racine.querySelector(`[id="${CSS.escape(notes[curseur.index].id)}"]`);
    if (avant) x = avant.getBoundingClientRect().right + 5;
    else if (apres) x = apres.getBoundingClientRect().left - 6;
    else x = debutMesure(staff, lignes) + 14;
    // Coordonnées dans la zone de partition, qui défile.
    const dx = racine.scrollLeft - base.left;
    const dy = racine.scrollTop - base.top;
    setRepere({
      portee: new DOMRect(lignes.left + dx, lignes.top + dy, lignes.width, lignes.height),
      x: x + dx,
    });
  }, [pages, selection, curseur, score]);

  useLayoutEffect(placerRepere, [placerRepere]);
  useEffect(() => {
    addEventListener("resize", placerRepere);
    return () => removeEventListener("resize", placerRepere);
  }, [placerRepere]);

  function clicPartition(e: React.MouseEvent) {
    const racine = feuilles.current!;
    const cibleEl = (e.target as Element).closest(".chord, .note, .rest, .mRest");
    if (cibleEl) {
      const id = cibleEl.closest(".chord")?.id ?? cibleEl.id;
      const pos = M.trouver(score, id);
      if (pos) {
        return appliquer({ ...etat, selection: id, curseur: { mesure: pos.mesure, cle: pos.cle, index: pos.index + 1 } }, false);
      }
    }
    // Clic sur une portée, hors note : place le curseur à l'endroit cliqué.
    for (let m = 0; m < score.measures.length; m++) {
      for (const c of ["treble", "bass"] as const) {
        const staff = porteeSvg(racine, score.measures[m].id, c);
        if (!staff) continue;
        const r = rectLignes(staff);
        const marge = r.height * 0.6;
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top - marge || e.clientY > r.bottom + marge) continue;
        const notes = score.measures[m][c];
        const index = notes.filter((n) => {
          const el = racine.querySelector(`[id="${CSS.escape(n.id)}"]`);
          if (!el) return false;
          const b = el.getBoundingClientRect();
          return b.left + b.width / 2 < e.clientX;
        }).length;
        return appliquer({ ...etat, selection: null, curseur: { mesure: m, cle: c, index } }, false);
      }
    }
  }

  // ── Enregistrement automatique ──
  const [sauvegarde, setSauvegarde] = useState<Sauvegarde>("ok");
  const dernierEnvoi = useRef(doc.data);
  const json = useMemo(() => JSON.stringify(score), [score]);
  const docRef = useRef(doc);
  docRef.current = doc;
  const jsonRef = useRef(json);
  jsonRef.current = json;

  const sauverMaintenant = useCallback(async () => {
    const data = json;
    if (data === dernierEnvoi.current) return setSauvegarde("ok");
    setSauvegarde("encours");
    try {
      const d = await api.save(docRef.current.id, { data });
      dernierEnvoi.current = data;
      // Si la partition a encore changé pendant l'envoi, un nouvel envoi suivra.
      setSauvegarde(jsonRef.current === data ? "ok" : "attente");
      onChange({ ...docRef.current, title: d.title, composer: d.composer, updatedAt: d.updatedAt });
    } catch (e) {
      setSauvegarde("erreur");
      signaler((e as Error).message);
    }
  }, [json, onChange, signaler]);

  useEffect(() => {
    if (json === dernierEnvoi.current) return;
    setSauvegarde("attente");
    const t = setTimeout(sauverMaintenant, DELAI_SAUVEGARDE);
    return () => clearTimeout(t);
  }, [json, sauverMaintenant]);

  // Prévient avant de quitter la page si des modifications ne sont pas enregistrées.
  useEffect(() => {
    const avertir = (e: BeforeUnloadEvent) => {
      if (json !== dernierEnvoi.current) e.preventDefault();
    };
    addEventListener("beforeunload", avertir);
    return () => removeEventListener("beforeunload", avertir);
  }, [json]);

  async function retour() {
    if (json !== dernierEnvoi.current) await sauverMaintenant();
    onBack();
  }

  // ── Statut de la mesure courante ──
  const mesureCourante = score.measures[curseur.mesure];
  const capacite = measureCapacity(score.timeSig);
  const rempli = M.remplissage(score, curseur.mesure, cle);
  const nomPortee = cle === "treble" ? "main droite" : "main gauche";
  const statut = noteSelectionnee
    ? `Note sélectionnée : ${noteSelectionnee.rest ? "silence" : noteSelectionnee.pitches.map((p) => NOMS_NOTES[p.letter] + (p.accidental ? { sharp: "♯", flat: "♭", natural: "♮" }[p.accidental] : "") + p.octave).join(" + ")} (${M.formatTemps(noteBeats(noteSelectionnee))})`
    : rempli >= capacite - 1e-9
      ? `Mesure ${curseur.mesure + 1}, ${nomPortee} : complète.`
      : `Mesure ${curseur.mesure + 1}, ${nomPortee} : ${M.formatTemps(rempli)} sur ${M.formatTemps(capacite)}.`;

  const libelleSauvegarde = { ok: "Enregistré", attente: "Modifications…", encours: "Enregistrement…", erreur: "Non enregistré" }[sauvegarde];

  return (
    <>
      <div className="page editor-page">
        <header className="topbar">
          <button className="btn ghost small" onClick={retour}>
            ← Bibliothèque
          </button>
          <div className="meta-fields">
            <input
              className="title-field"
              value={score.title}
              maxLength={200}
              onChange={(e) => modifierScore({ title: e.target.value })}
              onBlur={() => !score.title.trim() && modifierScore({ title: "Sans titre" })}
              aria-label="Titre"
            />
            <input
              className="composer-field"
              value={score.composer}
              maxLength={200}
              placeholder="Compositeur"
              onChange={(e) => modifierScore({ composer: e.target.value })}
              aria-label="Compositeur"
            />
          </div>
          <span className={`save-status ${sauvegarde}`} role="status">
            {libelleSauvegarde}
          </span>
          <div className="spacer" />
          <div className="toolbar">
            <button className="btn rail-toggle" onClick={() => setPaletteOuverte(true)}>
              🎹 Outils
            </button>
            <button className="btn primary" onClick={lecture.basculer} disabled={!pages} title="Espace">
              {lecture.libelle}
            </button>
            <DownloadMenu doc={doc} mei={mei} json={json} onImprimer={() => (lecture.arreter(), impression.imprimer())} />
            <ShareMenu doc={doc} onChange={onChange} />
          </div>
        </header>

        <div className="editor-body">
          {paletteOuverte && <div className="rail-backdrop" onClick={() => setPaletteOuverte(false)} />}
          <div className={`rail-wrap${paletteOuverte ? " open" : ""}`}>
            <Palette
              cle={cle}
              octave={octaves[cle]}
              duree={duree}
              pointee={pointee}
              triolet={triolet}
              onTriolet={basculerTriolet}
              articulations={M.cible(etat)?.articulations ?? []}
              onArticulation={(a) => surCible((id) => M.articuler(etat, id, a))}
              arpege={!!M.cible(etat)?.arpege}
              onArpege={() => surCible((id) => M.basculerArpege(etat, id))}
              alteration={alteration}
              modeAccord={modeAccord}
              selection={selection !== null}
              statut={statut}
              mesure={curseur.mesure}
              nbMesures={score.measures.length}
              tempo={score.tempo}
              chiffrage={`${score.timeSig.num}/${score.timeSig.den}`}
              armure={score.keySignature}
              peutAnnuler={passe.length > 0}
              peutRetablir={futur.length > 0}
              onCle={changerCle}
              onOctave={(d) => setOctaves((o) => ({ ...o, [cle]: Math.max(0, Math.min(8, o[cle] + d)) }))}
              onDuree={(d) => choisirDuree(d)}
              onPointee={() => choisirDuree(duree, !pointee)}
              onAlteration={choisirAlteration}
              onNote={(l) => note(l)}
              onModeAccord={setModeAccord}
              onSilence={silence}
              onSupprimer={effacer}
              nuance={M.cible(etat)?.dynamic ?? null}
              onLier={() => surCible((id) => M.lier(etat, id))}
              onDelier={() => surCible((id) => M.delier(etat, id))}
              onNuance={(d) => surCible((id) => M.nuance(etat, id, d))}
              onSoufflet={(f) => surCible((id) => M.soufflet(etat, id, f))}
              onSansNuance={() => surCible((id) => M.sansNuance(etat, id))}
              onMesure={allerMesure}
              onAjouterMesures={(n) => appliquer(M.ajouterMesures(etat, n, curseur.mesure))}
              onSupprimerMesure={() => appliquer(M.supprimerMesure(etat, curseur.mesure))}
              barre={mesureCourante.barre ?? (curseur.mesure === score.measures.length - 1 ? "final" : "simple")}
              repriseDebut={!!mesureCourante.repriseDebut}
              volta={mesureCourante.volta ?? null}
              onBarre={(b) => appliquer(M.reglerMesure(etat, curseur.mesure, { barre: b }))}
              onRepriseDebut={(v) => appliquer(M.reglerMesure(etat, curseur.mesure, { repriseDebut: v }))}
              onVolta={(v) => appliquer(M.reglerMesure(etat, curseur.mesure, { volta: v ?? undefined }))}
              onTempo={(t) => modifierScore({ tempo: t })}
              onChiffrage={(c) => {
                const [num, den] = c.split("/").map(Number);
                appliquer(M.changerChiffrage(etat, num, den));
              }}
              onArmure={(k: KeySignature) => appliquer({ ...etat, score: { ...score, keySignature: k } })}
              onAnnuler={annuler}
              onRetablir={retablir}
              onFermer={() => setPaletteOuverte(false)}
            />
          </div>

          <main className="sheets editable" ref={feuilles} onClick={clicPartition}>
            {(erreur || lecture.erreur) && (
              <p className="alert" role="alert">
                {erreur || lecture.erreur}
              </p>
            )}
            {!pages && !erreur && <p className="muted center">Chargement de l'éditeur…</p>}
            {pages?.map((svg, i) => (
              <div key={i} className="sheet" dangerouslySetInnerHTML={{ __html: svg }} />
            ))}
            {repere && lecture.etat === "arret" && (
              <>
                <div
                  className="repere-portee"
                  style={{ left: repere.portee.x - 4, top: repere.portee.y - 6, width: repere.portee.width + 8, height: repere.portee.height + 12 }}
                />
                {!selection && (
                  <div className="repere-curseur" style={{ left: repere.x, top: repere.portee.y - 10, height: repere.portee.height + 20 }} />
                )}
              </>
            )}
          </main>
        </div>

        <div className={`toast${message ? " show" : ""}`} role="alert">
          {message}
        </div>
      </div>
      {impression.bloc}
    </>
  );
}

// ── Repérage dans le SVG de Verovio ─────────────────────────────────────────

/** Groupe SVG d'une portée (0 = clé de sol, 1 = clé de fa) dans une mesure. */
function porteeSvg(racine: Element, mesureId: string, cle: Clef): Element | null {
  const mesure = racine.querySelector(`[id="${CSS.escape(mesureId)}"]`);
  return mesure?.querySelectorAll(".staff")[cle === "treble" ? 0 : 1] ?? null;
}

/** Rectangle des cinq lignes de la portée (sans les notes qui dépassent). */
function rectLignes(staff: Element): DOMRect {
  const lignes = Array.from(staff.querySelectorAll(":scope > path"));
  if (!lignes.length) return staff.getBoundingClientRect();
  const rects = lignes.map((l) => l.getBoundingClientRect());
  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  const top = Math.min(...rects.map((r) => r.top));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Abscisse où commence la musique (après clé, armure et chiffrage en début de ligne). */
function debutMesure(staff: Element, lignes: DOMRect): number {
  const entete = Array.from(staff.querySelectorAll(".clef, .keySig, .meterSig"));
  return entete.length ? Math.max(...entete.map((el) => el.getBoundingClientRect().right)) : lignes.left;
}
