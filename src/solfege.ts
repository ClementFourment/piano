// Règles de solfège partagées par le rendu (MEI) et l'export (MusicXML).

import { KEY_SIGNATURES, PORTEES, aDeuxVoix, cleDe, notesDe, noteBeats, voixDe, type Accidental, type Duration, type KeySignature, type Letter, type Note, type Pitch, type Score } from "../shared/score";

const ALTER: Record<NonNullable<Accidental>, number> = { sharp: 1, flat: -1, natural: 0 };
const ORDRE_DIESES: Letter[] = ["F", "C", "G", "D", "A", "E", "B"];

/** Altération (-1, 0, +1) imposée par l'armure à chaque note. */
function alterationsArmure(k: KeySignature): Record<Letter, number> {
  const fifths = KEY_SIGNATURES[k];
  const alt = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 } as Record<Letter, number>;
  const ordre = fifths >= 0 ? ORDRE_DIESES : [...ORDRE_DIESES].reverse();
  for (let i = 0; i < Math.abs(fifths); i++) alt[ordre[i]] = Math.sign(fifths);
  return alt;
}

/**
 * Calcule, note après note dans une mesure, l'altération réellement jouée :
 * celle écrite devant la note, sinon celle écrite plus tôt dans la mesure
 * à la même hauteur, sinon celle de l'armure.
 * Créer un objet par portée et par mesure.
 */
export function suiviAlterations(k: KeySignature) {
  const armure = alterationsArmure(k);
  const courantes = new Map<string, number>();
  return (p: Pitch): number => {
    const cle = p.letter + p.octave;
    if (p.accidental) {
      courantes.set(cle, ALTER[p.accidental]);
      return ALTER[p.accidental];
    }
    return courantes.get(cle) ?? armure[p.letter];
  };
}

/** Longueur d'un groupe de ligature, en noires : une noire pointée en 6/8, 9/8, 12/8, une blanche en x/2, sinon une noire. */
function groupeLigature(timeSig: Score["timeSig"]): number {
  if (timeSig.den === 8 && timeSig.num % 3 === 0) return 1.5;
  if (timeSig.den === 2) return 2;
  return 1;
}

const LIGATURABLE: Partial<Record<Duration, true>> = { eighth: true, sixteenth: true };

/**
 * Groupes de ligature d'une suite de notes (hors triolets) commençant à `depart` noires
 * du début de la mesure : notes consécutives de moins d'une noire (hors silences) dans le même temps.
 * Renvoie, pour chaque note, son groupe (null = non ligaturée).
 */
function groupesLigature(notes: Note[], timeSig: Score["timeSig"], depart: number): (Note[] | null)[] {
  const groupe = groupeLigature(timeSig);
  const res: (Note[] | null)[] = [];
  let courant: Note[] = [];
  let temps = -1;
  let pos = depart;
  for (const n of notes) {
    const t = Math.floor(pos / groupe + 1e-9);
    if (!n.rest && LIGATURABLE[n.duration]) {
      if (t !== temps) courant = [];
      temps = t;
      courant.push(n);
      res.push(courant);
    } else {
      courant = [];
      temps = -1;
      res.push(null);
    }
    pos += noteBeats(n);
  }
  // Un groupe d'une seule note n'est pas ligaturé.
  return res.map((g) => (g && g.length > 1 ? g : null));
}

/** Dans un triolet : toutes les notes brèves consécutives sont ligaturées ensemble. */
function ligaturesTriolet(notes: Note[]): (Note[] | null)[] {
  const res: (Note[] | null)[] = [];
  let courant: Note[] = [];
  for (const n of notes) {
    if (!n.rest && LIGATURABLE[n.duration]) {
      courant.push(n);
      res.push(courant);
    } else {
      courant = [];
      res.push(null);
    }
  }
  return res.map((g) => (g && g.length > 1 ? g : null));
}

export interface Segment {
  /** Groupe de triolet (3 dans le temps de 2), sinon suite de notes normales. */
  triolet: boolean;
  notes: Note[];
  /** Pour chaque note du segment, son groupe de ligature (null = non ligaturée). */
  ligatures: (Note[] | null)[];
}

const EPS = 1e-9;

/**
 * Découpe une portée d'une mesure en segments : notes normales et groupes de triolet.
 * Un groupe de triolet se ferme quand il remplit le temps de deux de ses plus petites valeurs
 * (3 croches = 1 noire, noire + croche = 1 noire, 3 noires = 1 blanche…).
 */
export function segments(notes: Note[], timeSig: Score["timeSig"]): Segment[] {
  const res: Segment[] = [];
  let i = 0;
  let pos = 0;
  while (i < notes.length) {
    const debut = pos;
    const groupe: Note[] = [];
    if (notes[i].triolet) {
      let rempli = 0;
      let plusPetite = Infinity;
      while (i < notes.length && notes[i].triolet) {
        const n = notes[i++];
        groupe.push(n);
        rempli += noteBeats(n);
        plusPetite = Math.min(plusPetite, noteBeats({ ...n, triolet: false }));
        if (rempli >= 2 * plusPetite - EPS) break;
      }
      pos += rempli;
      res.push({ triolet: true, notes: groupe, ligatures: ligaturesTriolet(groupe) });
    } else {
      while (i < notes.length && !notes[i].triolet) {
        groupe.push(notes[i]);
        pos += noteBeats(notes[i++]);
      }
      res.push({ triolet: false, notes: groupe, ligatures: groupesLigature(groupe, timeSig, debut) });
    }
  }
  return res;
}

/** Pour chaque note, la note qui la suit sur la même portée et dans la même voix (en passant les barres de mesure). */
export function notesSuivantes(score: Score): Map<string, Note> {
  const suivantes = new Map<string, Note>();
  for (const cle of PORTEES) {
    let prec: Note | null = null;
    for (const m of score.measures) {
      for (const n of notesDe(m, cle)) {
        if (prec) suivantes.set(prec.id, n);
        prec = n;
      }
    }
  }
  return suivantes;
}

/** Paires de têtes de notes reliées par une liaison de prolongation (indices dans `pitches`). */
export function tetesLiees(n: Note, suivante: Note | undefined): [number, number][] {
  if (!n.tie || !suivante || n.rest || suivante.rest) return [];
  const paires: [number, number][] = [];
  n.pitches.forEach((p, i) => {
    const j = suivante.pitches.findIndex((q) => q.letter === p.letter && q.octave === p.octave);
    if (j >= 0) paires.push([i, j]);
  });
  return paires;
}

// ── Sens des hampes et placement des indications ────────────────────────────

export type Sens = "up" | "down";

/** Ligne du milieu de chaque portée, en degrés (octave × 7 + note) : si 4 en clé de sol, ré 3 en clé de fa. */
const MILIEU = { treble: 4 * 7 + 6, bass: 3 * 7 + 1 };
const degre = (p: Pitch) => p.octave * 7 + "CDEFGAB".indexOf(p.letter);

/**
 * Sens de la hampe de chaque note (règle de gravure classique) : la note la plus
 * éloignée de la ligne du milieu décide ; à égalité, hampe en bas. Toutes les notes
 * d'un groupe ligaturé partagent le même sens. Les silences n'en ont pas.
 * Quand une portée a deux voix dans la mesure : voix 1 en haut, voix 2 en bas.
 */
export function sensHampes(score: Score): Map<string, Sens> {
  const sens = new Map<string, Sens>();
  const decider = (notes: Note[], milieu: number): Sens => {
    const degres = notes.flatMap((n) => n.pitches.map(degre));
    return milieu - Math.min(...degres) > Math.max(...degres) - milieu ? "up" : "down";
  };
  for (const cle of PORTEES) {
    for (const m of score.measures) {
      const impose: Sens | null = aDeuxVoix(m, cleDe(cle)) ? (voixDe(cle) === 1 ? "up" : "down") : null;
      for (const seg of segments(notesDe(m, cle), score.timeSig)) {
        seg.notes.forEach((n, i) => {
          if (n.rest || sens.has(n.id)) return;
          const groupe = seg.ligatures[i] ?? [n];
          const s = impose ?? decider(groupe, MILIEU[cleDe(cle)]);
          for (const g of groupe) sens.set(g.id, s);
        });
      }
    }
  }
  return sens;
}

/** Côté des têtes de notes : à l'opposé de la hampe (doigtés, liaisons). */
export const coteTetes = (s: Sens | undefined): "above" | "below" => (s === "up" ? "below" : "above");

/** Notes des mesures où leur portée a deux voix. */
export function notesADeuxVoix(score: Score): Set<string> {
  const ids = new Set<string>();
  for (const m of score.measures) {
    for (const p of PORTEES) if (aDeuxVoix(m, cleDe(p))) for (const n of notesDe(m, p)) ids.add(n.id);
  }
  return ids;
}

/**
 * Côté des indications d'une note (doigtés) : côté des têtes avec une seule voix ;
 * avec deux voix, à l'extérieur (voix 1 au-dessus, voix 2 en dessous), pour ne pas
 * mélanger les indications des deux voix entre elles.
 */
export function coteIndications(id: string, sens: Map<string, Sens>, deuxVoix: Set<string>): "above" | "below" {
  const s = sens.get(id);
  return deuxVoix.has(id) ? (s === "down" ? "below" : "above") : coteTetes(s);
}

/** Longueur d'une hampe, en degrés (trois espaces et demi). */
const HAMPE = 7;
/** Écart (en degrés) à partir duquel le côté le plus dégagé l'emporte sur la règle classique. */
const SEUIL_DEGAGEMENT = 5;

/**
 * Côté de chaque liaison de phrasé (clé : note de départ).
 * Règle classique : côté des têtes si toutes les hampes vont dans le même sens, au-dessus sinon.
 * Mais si les notes intermédiaires dépassent nettement d'un côté (la liaison devrait faire un
 * grand arc pour les enjamber) et beaucoup moins de l'autre, on prend le côté dégagé.
 */
export function cotesLiaisons(score: Score, sens: Map<string, Sens>): Map<string, "above" | "below"> {
  const cotes = new Map<string, "above" | "below">();
  const deuxVoix = notesADeuxVoix(score);
  const haut = (n: Note) => Math.max(...n.pitches.map(degre)) + (sens.get(n.id) === "up" && n.duration !== "whole" ? HAMPE : 0);
  const bas = (n: Note) => Math.min(...n.pitches.map(degre)) - (sens.get(n.id) === "down" && n.duration !== "whole" ? HAMPE : 0);

  for (const cle of PORTEES) {
    const notes = score.measures.flatMap((m) => notesDe(m, cle));
    notes.forEach((n, i) => {
      if (!n.slurEnd) return;
      const fin = notes.findIndex((x) => x.id === n.slurEnd);
      if (fin <= i) return;
      const tranche = notes.slice(i, fin + 1);
      // Avec deux voix, la liaison va à l'extérieur, comme les autres indications de la voix.
      if (tranche.some((x) => deuxVoix.has(x.id))) {
        cotes.set(n.id, coteIndications(n.id, sens, deuxVoix));
        return;
      }
      const directions = new Set(tranche.map((x) => sens.get(x.id)).filter(Boolean));
      const classique = directions.size === 1 ? coteTetes([...directions][0]) : "above";

      // Dépassement des notes intermédiaires au-delà de la droite qui relie les extrémités.
      const temps: number[] = [];
      tranche.reduce((t, x) => (temps.push(t), t + noteBeats(x)), 0);
      const debut = tranche[0], dernier = tranche[tranche.length - 1];
      const duree = temps[temps.length - 1] || 1;
      const depassement = (bord: (x: Note) => number, signe: 1 | -1) => {
        let max = 0;
        tranche.forEach((x, j) => {
          if (j === 0 || j === tranche.length - 1 || x.rest) return;
          const droite = bord(debut) + ((bord(dernier) - bord(debut)) * temps[j]) / duree;
          max = Math.max(max, signe * (bord(x) - droite));
        });
        return max;
      };
      const dessus = depassement(haut, 1);
      const dessous = depassement(bas, -1);
      const autre = classique === "above" ? "below" : "above";
      const ecart = classique === "above" ? dessus - dessous : dessous - dessus;
      cotes.set(n.id, ecart >= SEUIL_DEGAGEMENT ? autre : classique);
    });
  }
  return cotes;
}
