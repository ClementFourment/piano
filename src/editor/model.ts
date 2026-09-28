// Opérations d'édition sur une partition. Toutes sont pures : elles renvoient
// un nouvel état (ou un message d'erreur à afficher), sans modifier l'ancien —
// c'est ce qui rend annuler/rétablir trivial.

import {
  LETTERS,
  emptyMeasure,
  measureCapacity,
  newId,
  noteBeats,
  type Accidental,
  type Clef,
  type Duration,
  type Note,
  type Pitch,
  type Score,
} from "../../shared/score";

/** Point d'insertion : avant la note n° `index` de la portée `cle` de la mesure `mesure`. */
export interface Curseur {
  mesure: number;
  cle: Clef;
  index: number;
}

export interface Etat {
  score: Score;
  curseur: Curseur;
  /** Note sélectionnée (clic ou flèches) : les commandes s'appliquent à elle. */
  selection: string | null;
}

export type Resultat = Etat | string;

const EPS = 1e-9;

export function remplissage(score: Score, mesure: number, cle: Clef): number {
  return score.measures[mesure]?.[cle].reduce((s, n) => s + noteBeats(n), 0) ?? 0;
}

export function trouver(score: Score, id: string): { mesure: number; cle: Clef; index: number } | null {
  for (let m = 0; m < score.measures.length; m++) {
    for (const cle of ["treble", "bass"] as const) {
      const index = score.measures[m][cle].findIndex((n) => n.id === id);
      if (index >= 0) return { mesure: m, cle, index };
    }
  }
  return null;
}

/** La note visée par les commandes : la sélection, sinon celle juste avant le curseur. */
export function cible(etat: Etat): Note | null {
  if (etat.selection) {
    const p = trouver(etat.score, etat.selection);
    return p ? etat.score.measures[p.mesure][p.cle][p.index] : null;
  }
  const { mesure, cle, index } = etat.curseur;
  return etat.score.measures[mesure]?.[cle][index - 1] ?? null;
}

/** Copie la partition et applique `fn` à la note `id`. */
function modifierNote(score: Score, id: string, fn: (n: Note) => Note): Score {
  return {
    ...score,
    measures: score.measures.map((m) => ({
      ...m,
      treble: m.treble.map((n) => (n.id === id ? fn(n) : n)),
      bass: m.bass.map((n) => (n.id === id ? fn(n) : n)),
    })),
  };
}

function avecPortee(score: Score, mesure: number, cle: Clef, notes: Note[]): Score {
  const measures = score.measures.slice();
  measures[mesure] = { ...measures[mesure], [cle]: notes };
  return { ...score, measures };
}

// ── Saisie ──────────────────────────────────────────────────────────────────

export interface Saisie {
  /** Vide = silence. */
  pitches: Pitch[];
  duration: Duration;
  dotted: boolean;
}

/**
 * Insère une note au curseur. Si la mesure est pleine, passe à la suivante
 * (en la créant au besoin), comme dans MuseScore.
 */
export function inserer(etat: Etat, saisie: Saisie): Resultat {
  let { score } = etat;
  let { mesure, cle, index } = etat.curseur;
  const duree = noteBeats(saisie);
  const capacite = measureCapacity(score.timeSig);
  if (duree > capacite + EPS) return "Cette durée est plus longue que la mesure.";

  let rempli = remplissage(score, mesure, cle);
  if (rempli + duree > capacite + EPS) {
    // On n'avance que si le curseur est en fin de mesure pleine.
    const finDeMesure = index === score.measures[mesure][cle].length;
    if (!finDeMesure || rempli < capacite - EPS) {
      const reste = capacite - rempli;
      return reste > EPS
        ? `Cette note ne tient pas : il reste ${formatTemps(reste)} dans la mesure.`
        : "La mesure est pleine.";
    }
    mesure++;
    index = 0;
    if (mesure >= score.measures.length) score = { ...score, measures: [...score.measures, emptyMeasure()] };
    rempli = remplissage(score, mesure, cle);
    if (rempli + duree > capacite + EPS) return "La mesure suivante est déjà pleine.";
  }

  const note: Note = {
    id: newId(),
    rest: saisie.pitches.length === 0,
    pitches: saisie.pitches,
    duration: saisie.duration,
    dotted: saisie.dotted,
  };
  const notes = score.measures[mesure][cle].slice();
  notes.splice(index, 0, note);
  return { score: avecPortee(score, mesure, cle, notes), curseur: { mesure, cle, index: index + 1 }, selection: null };
}

/** Ajoute une hauteur à la note visée (qui devient un accord). */
export function ajouterAuAccord(etat: Etat, pitch: Pitch): Resultat {
  const note = cible(etat);
  if (!note) return "Saisissez d'abord une note, puis ajoutez-lui des notes pour former un accord.";
  if (note.rest) return "On ne peut pas ajouter de note à un silence.";
  if (note.pitches.some((p) => p.letter === pitch.letter && p.octave === pitch.octave)) return etat;
  if (note.pitches.length >= 12) return "Accord trop grand.";
  const pitches = [...note.pitches, pitch].sort((a, b) => hauteur(a) - hauteur(b));
  return { ...etat, score: modifierNote(etat.score, note.id, (n) => ({ ...n, pitches })) };
}

/** Remplace la hauteur de la note sélectionnée (un silence devient une note). */
export function remplacerHauteur(etat: Etat, id: string, pitch: Pitch): Resultat {
  return { ...etat, score: modifierNote(etat.score, id, (n) => ({ ...n, rest: false, pitches: [pitch] })) };
}

export function enSilence(etat: Etat, id: string): Resultat {
  return { ...etat, score: modifierNote(etat.score, id, (n) => ({ ...n, rest: true, pitches: [] })) };
}

/** Change la durée d'une note, si elle tient encore dans la mesure. */
export function changerDuree(etat: Etat, id: string, duration: Duration, dotted: boolean): Resultat {
  const p = trouver(etat.score, id);
  if (!p) return etat;
  const note = etat.score.measures[p.mesure][p.cle][p.index];
  const capacite = measureCapacity(etat.score.timeSig);
  const rempli = remplissage(etat.score, p.mesure, p.cle) - noteBeats(note) + noteBeats({ duration, dotted });
  if (rempli > capacite + EPS) return "Avec cette durée, la note ne tient plus dans la mesure.";
  return { ...etat, score: modifierNote(etat.score, id, (n) => ({ ...n, duration, dotted })) };
}

/** Met (ou retire, si c'est déjà la même) une altération. Pour un accord : la note la plus haute. */
export function basculerAlteration(etat: Etat, id: string, acc: NonNullable<Accidental>): Resultat {
  return {
    ...etat,
    score: modifierNote(etat.score, id, (n) => {
      if (n.rest) return n;
      const pitches = n.pitches.slice();
      const i = pitches.length - 1;
      pitches[i] = { ...pitches[i], accidental: pitches[i].accidental === acc ? null : acc };
      return { ...n, pitches };
    }),
  };
}

/** Monte ou descend une note (ou tout un accord) de `pas` degrés : 1 = une note, 7 = une octave. */
export function transposer(etat: Etat, id: string, pas: number): Resultat {
  let horsLimite = false;
  const score = modifierNote(etat.score, id, (n) => ({
    ...n,
    pitches: n.pitches.map((p) => {
      const h = hauteur(p) + pas;
      const octave = Math.floor(h / 7);
      if (octave < 0 || octave > 8) horsLimite = true;
      // L'altération écrite est retirée : la nouvelle note suit l'armure.
      return { letter: LETTERS[((h % 7) + 7) % 7], accidental: null, octave };
    }),
  }));
  return horsLimite ? "Hors de la tessiture du piano." : { ...etat, score };
}

// ── Suppression et navigation ───────────────────────────────────────────────

export function supprimer(etat: Etat, id: string): Resultat {
  const p = trouver(etat.score, id);
  if (!p) return etat;
  const notes = etat.score.measures[p.mesure][p.cle].filter((n) => n.id !== id);
  return {
    score: avecPortee(etat.score, p.mesure, p.cle, notes),
    curseur: { mesure: p.mesure, cle: p.cle, index: p.index },
    selection: null,
  };
}

/** Retour arrière : supprime la note avant le curseur (ou remonte à la mesure précédente). */
export function supprimerAvant(etat: Etat): Resultat {
  const { mesure, cle, index } = etat.curseur;
  if (index > 0) return supprimer(etat, etat.score.measures[mesure][cle][index - 1].id);
  if (mesure === 0) return etat;
  const prec = etat.score.measures[mesure - 1][cle];
  return { ...etat, curseur: { mesure: mesure - 1, cle, index: prec.length } };
}

/** Flèches gauche/droite : passe d'une note à l'autre sur la même portée, d'une mesure à l'autre. */
export function naviguer(etat: Etat, dir: -1 | 1): Etat {
  const { score } = etat;
  // Toutes les positions de la portée, à la suite.
  const cle = etat.selection ? (trouver(score, etat.selection)?.cle ?? etat.curseur.cle) : etat.curseur.cle;
  const suite: { mesure: number; index: number; id: string }[] = [];
  score.measures.forEach((m, mi) => m[cle].forEach((n, i) => suite.push({ mesure: mi, index: i, id: n.id })));

  let pos: number;
  if (etat.selection) {
    pos = suite.findIndex((s) => s.id === etat.selection) + dir;
  } else {
    // Depuis le curseur : la note juste avant (←) ou juste après (→).
    const { mesure, index } = etat.curseur;
    const apres = suite.findIndex((s) => s.mesure > mesure || (s.mesure === mesure && s.index >= index));
    pos = dir === 1 ? (apres === -1 ? suite.length : apres) : (apres === -1 ? suite.length : apres) - 1;
  }
  if (pos < 0) return etat;
  if (pos >= suite.length) {
    // Au-delà de la dernière note : curseur en fin de partition.
    const derniere = score.measures.length - 1;
    return { ...etat, selection: null, curseur: { mesure: derniere, cle, index: score.measures[derniere][cle].length } };
  }
  const s = suite[pos];
  return { ...etat, selection: s.id, curseur: { mesure: s.mesure, cle, index: s.index + 1 } };
}

// ── Mesures et en-tête ──────────────────────────────────────────────────────

export function ajouterMesures(etat: Etat, nombre: number, apres: number): Etat {
  const measures = etat.score.measures.slice();
  measures.splice(apres + 1, 0, ...Array.from({ length: nombre }, emptyMeasure));
  return { ...etat, score: { ...etat.score, measures } };
}

export function supprimerMesure(etat: Etat, mesure: number): Resultat {
  if (etat.score.measures.length <= 1) return "La partition doit garder au moins une mesure.";
  const measures = etat.score.measures.filter((_, i) => i !== mesure);
  const m = Math.min(mesure, measures.length - 1);
  return {
    score: { ...etat.score, measures },
    curseur: { mesure: m, cle: etat.curseur.cle, index: measures[m][etat.curseur.cle].length },
    selection: null,
  };
}

export function changerChiffrage(etat: Etat, num: number, den: number): Resultat {
  const capacite = measureCapacity({ num, den });
  const trop = etat.score.measures.findIndex(
    (_, i) => remplissage(etat.score, i, "treble") > capacite + EPS || remplissage(etat.score, i, "bass") > capacite + EPS,
  );
  if (trop >= 0) return `La mesure ${trop + 1} est trop remplie pour ${num}/${den} : raccourcissez-la d'abord.`;
  return { ...etat, score: { ...etat.score, timeSig: { num, den } } };
}

// ── Utilitaires ─────────────────────────────────────────────────────────────

/** Position diatonique (Do0 = 0) : sert à trier et transposer. */
function hauteur(p: Pitch): number {
  return p.octave * 7 + LETTERS.indexOf(p.letter);
}

/** « 1 temps », « 1 temps ½ », « ½ temps »… (en noires). */
export function formatTemps(beats: number): string {
  const entier = Math.floor(beats + EPS);
  const reste = beats - entier;
  const fraction = reste > EPS ? ({ 0.25: "¼", 0.5: "½", 0.75: "¾" } as Record<number, string>)[Math.round(reste * 4) / 4] ?? "" : "";
  if (!entier) return fraction ? `${fraction} temps` : "0 temps";
  return `${entier}${fraction ? " " + fraction : ""} temps`;
}
