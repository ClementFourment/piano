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
  type Articulation,
  type Clef,
  type Doigt,
  type Duration,
  type Dynamic,
  type Measure,
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
  triolet?: boolean;
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
    ...(saisie.triolet ? { triolet: true } : {}),
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
  const rempli = remplissage(etat.score, p.mesure, p.cle) - noteBeats(note) + noteBeats({ duration, dotted, triolet: note.triolet });
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
      return { letter: LETTERS[((h % 7) + 7) % 7], accidental: null, octave, ...(p.doigt ? { doigt: p.doigt } : {}) };
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
    score: sansReferencesA(avecPortee(etat.score, p.mesure, p.cle, notes), id),
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

// ── Liaisons et nuances ─────────────────────────────────────────────────────

/** Note suivante sur la même portée, en passant la barre de mesure. */
export function suivante(score: Score, id: string): Note | null {
  const p = trouver(score, id);
  if (!p) return null;
  for (let m = p.mesure; m < score.measures.length; m++) {
    const notes = score.measures[m][p.cle];
    const debut = m === p.mesure ? p.index + 1 : 0;
    if (debut < notes.length) return notes[debut];
  }
  return null;
}

const memeHauteur = (a: Pitch, b: Pitch) => a.letter === b.letter && a.octave === b.octave;

/**
 * Touche L : relie la note à la suivante. Même hauteur → prolongation ;
 * sinon liaison de phrasé. Sur une liaison de phrasé existante, l'allonge d'une note.
 */
export function lier(etat: Etat, id: string): Resultat {
  const note = trouverNote(etat.score, id);
  if (!note) return etat;
  if (note.rest) return "On ne lie pas un silence.";
  if (note.tie) return "Cette note est déjà prolongée (Maj+L pour retirer la liaison).";

  const depuis = note.slurEnd ?? id;
  const suiv = suivante(etat.score, depuis);
  if (!suiv) return "Il n'y a pas de note après, sur cette portée.";
  if (suiv.rest) return "La note suivante est un silence.";

  if (!note.slurEnd && note.pitches.some((p) => suiv.pitches.some((q) => memeHauteur(p, q)))) {
    return { ...etat, score: modifierNote(etat.score, id, (n) => ({ ...n, tie: true })) };
  }
  return { ...etat, score: modifierNote(etat.score, id, (n) => ({ ...n, slurEnd: suiv.id })) };
}

/** Maj+L : retire la prolongation et la liaison de phrasé qui partent de la note. */
export function delier(etat: Etat, id: string): Resultat {
  return {
    ...etat,
    score: modifierNote(etat.score, id, ({ tie: _t, slurEnd: _s, ...n }) => n),
  };
}

/** Pose une nuance (ou la retire si c'est la même). */
export function nuance(etat: Etat, id: string, d: Dynamic): Resultat {
  return {
    ...etat,
    score: modifierNote(etat.score, id, ({ dynamic, ...n }) => (dynamic === d ? n : { ...n, dynamic: d })),
  };
}

/** Soufflet depuis la note ; appuyer de nouveau l'allonge d'une note. */
export function soufflet(etat: Etat, id: string, form: "cres" | "dim"): Resultat {
  const note = trouverNote(etat.score, id);
  if (!note) return etat;
  const depuis = note.hairpin?.form === form ? note.hairpin.end : id;
  const suiv = suivante(etat.score, depuis);
  if (!suiv) return "Il faut au moins une note après pour un soufflet.";
  return { ...etat, score: modifierNote(etat.score, id, (n) => ({ ...n, hairpin: { form, end: suiv.id } })) };
}

/** Fait d'une note une note de triolet (2/3 de sa durée), ou l'inverse si elle tient encore. */
export function basculerTriolet(etat: Etat, id: string): Resultat {
  const p = trouver(etat.score, id);
  if (!p) return etat;
  const note = etat.score.measures[p.mesure][p.cle][p.index];
  const triolet = !note.triolet;
  const rempli = remplissage(etat.score, p.mesure, p.cle) - noteBeats(note) + noteBeats({ ...note, triolet });
  if (rempli > measureCapacity(etat.score.timeSig) + EPS) return "Sans triolet, la note ne tient plus dans la mesure.";
  return { ...etat, score: modifierNote(etat.score, id, ({ triolet: _t, ...n }) => (triolet ? { ...n, triolet } : n)) };
}

/** Met ou retire une articulation. */
export function articuler(etat: Etat, id: string, a: Articulation): Resultat {
  return {
    ...etat,
    score: modifierNote(etat.score, id, ({ articulations = [], ...n }) => {
      const suite = articulations.includes(a) ? articulations.filter((x) => x !== a) : [...articulations, a];
      return suite.length ? { ...n, articulations: suite } : n;
    }),
  };
}

/** Accord arpégé ou non. */
export function basculerArpege(etat: Etat, id: string): Resultat {
  const note = trouverNote(etat.score, id);
  if (!note) return etat;
  if (note.rest || note.pitches.length < 2) return "L'arpège ne s'applique qu'à un accord (au moins deux notes).";
  return { ...etat, score: modifierNote(etat.score, id, ({ arpege, ...n }) => (arpege ? n : { ...n, arpege: true })) };
}

/**
 * Doigté. Note seule : le met, ou le retire si c'est le même.
 * Accord : remplit la note suivante sans doigté, du grave à l'aigu ; une fois
 * l'accord complet, on recommence par le bas. `null` retire tous les doigtés.
 */
export function doigter(etat: Etat, id: string, doigt: Doigt | null): Resultat {
  const note = trouverNote(etat.score, id);
  if (!note) return etat;
  if (note.rest) return "Un silence n'a pas de doigté.";
  const sansDoigt = ({ doigt: _d, ...p }: Pitch): Pitch => p;
  let pitches: Pitch[];
  if (doigt === null) pitches = note.pitches.map(sansDoigt);
  else if (note.pitches.length === 1) {
    const p = note.pitches[0];
    pitches = [p.doigt === doigt ? sansDoigt(p) : { ...p, doigt }];
  } else {
    // Accord déjà complet : on repart du grave.
    pitches = note.pitches.every((p) => p.doigt) ? note.pitches.map(sansDoigt) : note.pitches.slice();
    const i = pitches.findIndex((p) => !p.doigt);
    pitches[i] = { ...pitches[i], doigt };
  }
  return { ...etat, score: modifierNote(etat.score, id, (n) => ({ ...n, pitches })) };
}

/** Retire nuance et soufflet de la note. */
export function sansNuance(etat: Etat, id: string): Resultat {
  return { ...etat, score: modifierNote(etat.score, id, ({ dynamic: _d, hairpin: _h, ...n }) => n) };
}

function trouverNote(score: Score, id: string): Note | null {
  const p = trouver(score, id);
  return p ? score.measures[p.mesure][p.cle][p.index] : null;
}

/** Après une suppression : retire les liaisons et soufflets qui aboutissaient à la note. */
function sansReferencesA(score: Score, id: string): Score {
  const nettoyer = (n: Note): Note => {
    if (n.slurEnd !== id && n.hairpin?.end !== id) return n;
    const copie = { ...n };
    if (copie.slurEnd === id) delete copie.slurEnd;
    if (copie.hairpin?.end === id) delete copie.hairpin;
    return copie;
  };
  return {
    ...score,
    measures: score.measures.map((m) => ({ ...m, treble: m.treble.map(nettoyer), bass: m.bass.map(nettoyer) })),
  };
}

// ── Mesures et en-tête ──────────────────────────────────────────────────────

export function ajouterMesures(etat: Etat, nombre: number, apres: number): Etat {
  const measures = etat.score.measures.slice();
  measures.splice(apres + 1, 0, ...Array.from({ length: nombre }, emptyMeasure));
  return { ...etat, score: { ...etat.score, measures } };
}

export function supprimerMesure(etat: Etat, mesure: number): Resultat {
  if (etat.score.measures.length <= 1) return "La partition doit garder au moins une mesure.";
  const retiree = etat.score.measures[mesure];
  let score: Score = { ...etat.score, measures: etat.score.measures.filter((_, i) => i !== mesure) };
  for (const n of [...retiree.treble, ...retiree.bass]) score = sansReferencesA(score, n.id);
  const measures = score.measures;
  const m = Math.min(mesure, measures.length - 1);
  return {
    score,
    curseur: { mesure: m, cle: etat.curseur.cle, index: measures[m][etat.curseur.cle].length },
    selection: null,
  };
}

type ReglagesMesure = Pick<Measure, "barre" | "repriseDebut" | "volta" | "texte">;

/** Barre de fin, début de reprise, case, texte : une valeur `undefined` (ou vide) retire le réglage. */
export function reglerMesure(etat: Etat, mesure: number, reglages: Partial<ReglagesMesure>): Etat {
  const measures = etat.score.measures.slice();
  const m: Measure = { ...measures[mesure] };
  for (const [cle, valeur] of Object.entries(reglages) as [keyof ReglagesMesure, never][]) {
    if (valeur === undefined || valeur === false || valeur === "") delete m[cle];
    else m[cle] = valeur;
  }
  measures[mesure] = m;
  return { ...etat, score: { ...etat.score, measures } };
}

/**
 * Recopie les mesures `debut` à `fin` juste après `fin`, avec de nouveaux identifiants.
 * Les liaisons et soufflets internes à la copie suivent ; ceux qui en sortent sont retirés.
 */
export function dupliquerMesures(etat: Etat, debut: number, fin: number): Resultat {
  const originales = etat.score.measures.slice(debut, fin + 1);
  if (etat.score.measures.length + originales.length > 2000) return "Trop de mesures (2000 maximum).";
  const nouveaux = new Map<string, string>();
  for (const m of originales) for (const n of [...m.treble, ...m.bass]) nouveaux.set(n.id, newId());
  const copierNote = ({ slurEnd, hairpin, ...n }: Note): Note => {
    const copie: Note = { ...n, id: nouveaux.get(n.id)! };
    if (slurEnd && nouveaux.has(slurEnd)) copie.slurEnd = nouveaux.get(slurEnd);
    if (hairpin && nouveaux.has(hairpin.end)) copie.hairpin = { ...hairpin, end: nouveaux.get(hairpin.end)! };
    return copie;
  };
  const copies = originales.map((m) => ({ ...m, id: newId(), treble: m.treble.map(copierNote), bass: m.bass.map(copierNote) }));
  const measures = etat.score.measures.slice();
  measures.splice(fin + 1, 0, ...copies);
  const cle = etat.curseur.cle;
  return {
    score: { ...etat.score, measures },
    curseur: { mesure: fin + 1, cle, index: measures[fin + 1][cle].length },
    selection: null,
  };
}

const estVide = (m: Measure) => [...m.treble, ...m.bass].every((n) => n.rest);

/**
 * Place des mesures enregistrées à partir de la mesure `depuis` : les mesures vides
 * (sans notes) sont remplies en gardant leurs réglages (barres, reprises) ; à la première
 * mesure qui contient déjà des notes, le reste est inséré avant elle.
 */
export function insererEnregistrement(etat: Etat, enregistrees: Measure[], depuis: number): Etat {
  const measures = etat.score.measures.slice();
  let k = depuis;
  for (let j = 0; j < enregistrees.length; j++, k++) {
    const cible = measures[k];
    if (cible && estVide(cible)) {
      measures[k] = { ...cible, treble: enregistrees[j].treble, bass: enregistrees[j].bass };
    } else {
      measures.splice(k, 0, ...enregistrees.slice(j));
      k += enregistrees.length - j;
      break;
    }
  }
  const derniere = Math.min(k, measures.length) - 1;
  return {
    score: { ...etat.score, measures },
    curseur: { mesure: derniere, cle: etat.curseur.cle, index: measures[derniere][etat.curseur.cle].length },
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

/** « 1 temps », « 1 ½ temps », « ⅓ temps »… (en noires ; les triolets donnent des tiers). */
export function formatTemps(beats: number): string {
  const entier = Math.floor(beats + 1e-6);
  const reste = beats - entier;
  const fractions: [number, string][] = [[0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"]];
  const fraction = reste < 1e-6 ? "" : (fractions.find(([v]) => Math.abs(v - reste) < 0.01)?.[1] ?? reste.toFixed(2).replace(".", ","));
  if (!entier) return fraction ? `${fraction} temps` : "0 temps";
  return `${entier}${fraction ? " " + fraction : ""} temps`;
}
