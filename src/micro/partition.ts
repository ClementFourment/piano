// Mise en partition de notes détectées au micro : calage sur les temps du métronome,
// accords, répartition des mains, découpage en valeurs de notes et liaisons, orthographe.

import {
  KEY_SIGNATURES,
  LETTERS,
  emptyMeasure,
  measureCapacity,
  newId,
  type Accidental,
  type Duration,
  type KeySignature,
  type Letter,
  type Measure,
  type Note,
  type Pitch,
  type Score,
} from "../../shared/score";

/** Une note entendue : instants en secondes depuis le début de l'enregistrement. */
export interface NoteEntendue {
  debut: number;
  duree: number;
  midi: number;
  /** 0–1 : force détectée. */
  amplitude: number;
}

export interface OptionsMiseEnPartition {
  tempo: number;
  timeSig: Score["timeSig"];
  armure: KeySignature;
  /** Pas de la grille, en noires : 0.5 (croche) ou 0.25 (double croche). */
  grille: number;
  /** Instant (s) du premier temps de la première mesure, après le décompte. */
  premierTemps: number;
  /** Note MIDI à partir de laquelle on écrit en clé de sol (60 = Do central). */
  separation?: number;
  /** Notes plus faibles ignorées (bruits, résonances). */
  amplitudeMin?: number;
  /** Une note plus faible que ce rapport × une note grave jouée en même temps dont elle est une harmonique est ignorée. */
  rapportHarmonique?: number;
}

/**
 * Force minimale d'une note selon la sensibilité choisie. « Haute » garde les notes jouées
 * doucement mais aussi plus de fausses notes ; « basse » l'inverse (voir le banc d'essai).
 */
export const SENSIBILITES = { haute: 0.3, normale: 0.42, basse: 0.52 } as const;
export type Sensibilite = keyof typeof SENSIBILITES;

/** Intervalles (demi-tons) des premières harmoniques d'une note : octave, octave + quinte, 2 octaves, 2 octaves + tierce, + quinte. */
const HARMONIQUES = [12, 19, 24, 28, 31];

/**
 * Retire les notes qui ne sont probablement que les harmoniques d'une note plus grave
 * attaquée au même moment (le modèle les entend comme des notes à part entière).
 */
export function sansHarmoniques(notes: NoteEntendue[], rapport: number): NoteEntendue[] {
  return notes.filter(
    (n) =>
      !notes.some(
        (m) =>
          m !== n &&
          HARMONIQUES.includes(n.midi - m.midi) &&
          Math.abs(m.debut - n.debut) < 0.08 &&
          n.amplitude < m.amplitude * rapport,
      ),
  );
}

const EPS = 1e-6;

/** Valeurs écrites possibles (en noires), de la plus longue à la plus courte. */
const VALEURS: { beats: number; duration: Duration; dotted: boolean }[] = [
  { beats: 4, duration: "whole", dotted: false },
  { beats: 3, duration: "half", dotted: true },
  { beats: 2, duration: "half", dotted: false },
  { beats: 1.5, duration: "quarter", dotted: true },
  { beats: 1, duration: "quarter", dotted: false },
  { beats: 0.75, duration: "eighth", dotted: true },
  { beats: 0.5, duration: "eighth", dotted: false },
  { beats: 0.25, duration: "sixteenth", dotted: false },
];

interface Tranche {
  debut: number; // en noires depuis le premier temps
  fin: number;
  midis: number[] | null; // null = silence
}

/** Transforme les notes entendues en mesures (au moins une). */
export function versMesures(notes: NoteEntendue[], o: OptionsMiseEnPartition): Measure[] {
  const noire = 60 / o.tempo;
  const separation = o.separation ?? 60;
  const amplitudeMin = o.amplitudeMin ?? SENSIBILITES.normale;
  const q = (beats: number) => Math.round(beats / o.grille) * o.grille;

  // 1. Calage sur la grille.
  const calees = sansHarmoniques(notes, o.rapportHarmonique ?? 0.8)
    .filter((n) => n.amplitude >= amplitudeMin && n.midi >= 21 && n.midi <= 108)
    .map((n) => ({
      midi: n.midi,
      debut: q((n.debut - o.premierTemps) / noire),
      duree: Math.max(o.grille, q(n.duree / noire)),
    }))
    .filter((n) => n.debut >= 0);

  const capacite = measureCapacity(o.timeSig);
  const fin = Math.max(capacite, ...calees.map((n) => n.debut + n.duree));
  const nbMesures = Math.max(1, Math.ceil(fin / capacite - EPS));
  const total = nbMesures * capacite;

  // 2. Par main : une suite de tranches (accord ou silence), sans chevauchement.
  const main = (cle: "treble" | "bass") => {
    const miennes = calees.filter((n) => (cle === "treble" ? n.midi >= separation : n.midi < separation));
    const parDebut = new Map<number, { midis: Set<number>; duree: number }>();
    for (const n of miennes) {
      const slot = parDebut.get(n.debut) ?? { midis: new Set(), duree: 0 };
      slot.midis.add(n.midi);
      slot.duree = Math.max(slot.duree, n.duree);
      parDebut.set(n.debut, slot);
    }
    const debuts = [...parDebut.keys()].sort((a, b) => a - b);
    const tranches: Tranche[] = [];
    let pos = 0;
    debuts.forEach((d, i) => {
      if (d > pos + EPS) tranches.push({ debut: pos, fin: d, midis: null });
      const slot = parDebut.get(d)!;
      // Une note s'arrête au plus tard quand la suivante commence (une seule voix par main).
      const finNote = Math.min(d + slot.duree, debuts[i + 1] ?? total, total);
      tranches.push({ debut: d, fin: finNote, midis: [...slot.midis].sort((a, b) => a - b) });
      pos = finNote;
    });
    if (pos < total - EPS) tranches.push({ debut: pos, fin: total, midis: null });
    return tranches;
  };

  const mesures: Measure[] = Array.from({ length: nbMesures }, emptyMeasure);
  for (const cle of ["treble", "bass"] as const) {
    const orthographe = new Orthographe(o.armure);
    let mesureCourante = -1;
    for (const t of main(cle)) {
      // 3. Découpage aux barres de mesure et en valeurs écrites ; les morceaux d'une note sont liés.
      const morceaux = decouper(t.debut, t.fin, capacite, !t.midis);
      morceaux.forEach((m, i) => {
        if (m.mesure !== mesureCourante) {
          mesureCourante = m.mesure;
          orthographe.nouvelleMesure();
        }
        const note: Note = { id: newId(), rest: !t.midis, pitches: [], duration: m.duration, dotted: m.dotted };
        if (t.midis) {
          // 4. Orthographe : seul le premier morceau porte les altérations.
          note.pitches = t.midis.map((midi) => orthographe.ecrire(midi, i > 0));
          if (i < morceaux.length - 1) note.tie = true;
        }
        mesures[m.mesure][cle].push(note);
      });
    }
  }

  // Portée sans aucune note dans une mesure : une pause d'une mesure.
  for (const m of mesures) {
    for (const cle of ["treble", "bass"] as const) {
      if (m[cle].every((n) => n.rest)) m[cle] = [pauseMesure(capacite)];
    }
  }
  return mesures;
}

/**
 * Découpe [debut, fin[ en valeurs de notes, en coupant aux barres de mesure.
 * Silences : jamais pointés, et en 4/4 jamais à cheval sur le milieu de la mesure (usage d'écriture).
 */
function decouper(debut: number, fin: number, capacite: number, silence: boolean) {
  const res: { mesure: number; duration: Duration; dotted: boolean }[] = [];
  let pos = debut;
  while (pos < fin - EPS) {
    const mesure = Math.floor(pos / capacite + EPS);
    const finMesure = (mesure + 1) * capacite;
    let limite = Math.min(fin, finMesure);
    const milieu = mesure * capacite + capacite / 2;
    if (silence && capacite === 4 && pos < milieu - EPS) limite = Math.min(limite, milieu);
    const reste = limite - pos;
    // Au-delà d'un temps, une valeur doit commencer sur un temps (écriture lisible).
    const surUnTemps = Math.abs(pos - Math.round(pos)) < EPS;
    const jusquAuTemps = Math.ceil(pos - EPS) - pos || 1;
    const v =
      VALEURS.find(
        (x) => x.beats <= reste + EPS && (surUnTemps || x.beats <= jusquAuTemps + EPS) && !(silence && x.dotted),
      ) ??
      VALEURS[VALEURS.length - 1];
    res.push({ mesure, duration: v.duration, dotted: v.dotted });
    pos += v.beats;
  }
  return res;
}

function pauseMesure(capacite: number): Note {
  const v = VALEURS.find((x) => Math.abs(x.beats - capacite) < EPS) ?? VALEURS[0];
  return { id: newId(), rest: true, pitches: [], duration: v.duration, dotted: v.dotted };
}

const DIESES: [Letter, number][] = [["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0], ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0]];
const BEMOLS: [Letter, number][] = [["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0], ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0]];
const ORDRE_DIESES: Letter[] = ["F", "C", "G", "D", "A", "E", "B"];

/**
 * Écrit une hauteur MIDI selon l'armure : dièses dans les tonalités à dièses, bémols sinon,
 * et une altération seulement quand elle diffère de l'armure ou de ce qui précède dans la mesure.
 */
class Orthographe {
  private armure: Record<Letter, number>;
  private bemols: boolean;
  private sansArmure: boolean;
  private courantes = new Map<string, number>();

  constructor(k: KeySignature) {
    const fifths = KEY_SIGNATURES[k];
    this.bemols = fifths < 0;
    this.sansArmure = fifths === 0;
    this.armure = Object.fromEntries(LETTERS.map((l) => [l, 0])) as Record<Letter, number>;
    const ordre = fifths >= 0 ? ORDRE_DIESES : [...ORDRE_DIESES].reverse();
    for (let i = 0; i < Math.abs(fifths); i++) this.armure[ordre[i]] = Math.sign(fifths);
  }

  nouvelleMesure() {
    this.courantes.clear();
  }

  /** `suite` : prolongation liée d'une note déjà écrite (pas d'altération répétée). */
  ecrire(midi: number, suite: boolean): Pitch {
    const pc = midi % 12;
    const octave = Math.floor(midi / 12) - 1;
    // Une note diatonique de l'armure est préférée (ex. Si♭ en Fa majeur, Fa♯ en Sol majeur) ;
    // sinon dièses dans les tonalités à dièses, bémols dans celles à bémols, et Si♭ plutôt que La♯ en Do.
    const candidats = [DIESES[pc], BEMOLS[pc]];
    const [letter, alter] =
      candidats.find(([l, a]) => this.armure[l] === a && a !== 0) ??
      (this.bemols || (this.sansArmure && pc === 10) ? BEMOLS[pc] : DIESES[pc]);
    const cle = letter + octave;
    const attendue = this.courantes.get(cle) ?? this.armure[letter];
    let accidental: Accidental = null;
    if (!suite && alter !== attendue) {
      accidental = alter === 1 ? "sharp" : alter === -1 ? "flat" : "natural";
      this.courantes.set(cle, alter);
    }
    return { letter, accidental, octave };
  }
}
