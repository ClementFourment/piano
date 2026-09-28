// Modèle d'une partition éditable (piano, portée double).
// Reprend le format du prototype PHP, avec un identifiant par mesure et par note
// (il sert à retrouver l'élément cliqué dans le rendu Verovio).

export const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
export type Letter = (typeof LETTERS)[number];

export const DURATIONS = ["whole", "half", "quarter", "eighth", "sixteenth"] as const;
export type Duration = (typeof DURATIONS)[number];

export const ACCIDENTALS = ["sharp", "flat", "natural"] as const;
export type Accidental = (typeof ACCIDENTALS)[number] | null;

export type Clef = "treble" | "bass";

/** Armures : nom → nombre d'altérations (positif = dièses, négatif = bémols). */
export const KEY_SIGNATURES = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
} as const;
export type KeySignature = keyof typeof KEY_SIGNATURES;

export interface Pitch {
  letter: Letter;
  /** Altération écrite devant la note (null = aucune ; l'armure s'applique). */
  accidental: Accidental;
  octave: number;
}

export interface Note {
  id: string;
  rest: boolean;
  /** Vide pour un silence ; plusieurs hauteurs = accord. */
  pitches: Pitch[];
  duration: Duration;
  dotted: boolean;
}

export interface Measure {
  id: string;
  treble: Note[];
  bass: Note[];
}

export interface Score {
  version: 1;
  title: string;
  composer: string;
  tempo: number;
  timeSig: { num: number; den: number };
  keySignature: KeySignature;
  measures: Measure[];
}

export const BEATS: Record<Duration, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 };

export function noteBeats(n: Pick<Note, "duration" | "dotted">): number {
  return BEATS[n.duration] * (n.dotted ? 1.5 : 1);
}

/** Durée d'une mesure, en noires. */
export function measureCapacity(timeSig: Score["timeSig"]): number {
  return timeSig.num * (4 / timeSig.den);
}

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  // Préfixe alphabétique : un xml:id MEI ne peut pas commencer par un chiffre.
  return "n" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function emptyMeasure(): Measure {
  return { id: newId(), treble: [], bass: [] };
}

export function emptyScore(composer = ""): Score {
  return {
    version: 1,
    title: "Sans titre",
    composer,
    tempo: 100,
    timeSig: { num: 4, den: 4 },
    keySignature: "C",
    measures: Array.from({ length: 4 }, emptyMeasure),
  };
}

// ── Validation (API et import) ──────────────────────────────────────────────

export const LIMITES = {
  titre: 200,
  mesures: 2000,
  notesParMesure: 64,
  hauteursParAccord: 12,
  /** Taille maximale du champ `data` stocké (octets). */
  donnees: 1_900_000,
} as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function lirePitch(p: unknown): Pitch | null {
  if (!isObj(p)) return null;
  if (!LETTERS.includes(p.letter as Letter)) return null;
  const accidental = p.accidental ?? null;
  if (accidental !== null && !ACCIDENTALS.includes(accidental as never)) return null;
  if (!Number.isInteger(p.octave) || (p.octave as number) < 0 || (p.octave as number) > 8) return null;
  return { letter: p.letter as Letter, accidental: accidental as Accidental, octave: p.octave as number };
}

/**
 * Lit une note. Accepte aussi l'ancien format du prototype
 * (une seule hauteur posée directement sur la note : letter/accidental/octave).
 */
function lireNote(n: unknown): Note | null {
  if (!isObj(n)) return null;
  if (!DURATIONS.includes(n.duration as Duration)) return null;
  const base = {
    id: typeof n.id === "string" && /^[a-zA-Z][\w-]{0,40}$/.test(n.id) ? n.id : newId(),
    duration: n.duration as Duration,
    dotted: n.dotted === true,
  };
  if (n.rest === true) return { ...base, rest: true, pitches: [] };
  const brutes = Array.isArray(n.pitches) ? n.pitches : [n];
  if (brutes.length === 0 || brutes.length > LIMITES.hauteursParAccord) return null;
  const pitches: Pitch[] = [];
  for (const p of brutes) {
    const pitch = lirePitch(p);
    if (!pitch) return null;
    pitches.push(pitch);
  }
  return { ...base, rest: false, pitches };
}

function lirePortee(v: unknown): Note[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > LIMITES.notesParMesure) return null;
  const notes: Note[] = [];
  for (const n of v) {
    const note = lireNote(n);
    if (!note) return null;
    notes.push(note);
  }
  return notes;
}

/** Vérifie et normalise une partition (format actuel ou export du prototype). */
export function lireScore(v: unknown): Score | string {
  if (!isObj(v)) return "Ce fichier n'est pas une partition.";
  if (!Array.isArray(v.measures)) return "Ce fichier n'est pas une partition (aucune mesure).";
  if (v.measures.length > LIMITES.mesures) return `Trop de mesures (${LIMITES.mesures} maximum).`;

  const ts = isObj(v.timeSig) ? v.timeSig : { num: 4, den: 4 };
  const num = ts.num, den = ts.den;
  if (!Number.isInteger(num) || (num as number) < 1 || (num as number) > 32 || ![1, 2, 4, 8, 16].includes(den as number)) {
    return "Chiffrage de mesure invalide.";
  }
  const keySignature = (v.keySignature ?? "C") as KeySignature;
  if (!(keySignature in KEY_SIGNATURES)) return "Armure inconnue.";
  const tempo = v.tempo ?? 100;
  if (!Number.isInteger(tempo) || (tempo as number) < 20 || (tempo as number) > 300) return "Tempo invalide (20 à 300).";

  const measures: Measure[] = [];
  for (const m of v.measures) {
    if (!isObj(m)) return "Mesure invalide.";
    const treble = lirePortee(m.treble);
    const bass = lirePortee(m.bass);
    if (!treble || !bass) return `Note invalide dans la mesure ${measures.length + 1}.`;
    const id = typeof m.id === "string" && /^[a-zA-Z][\w-]{0,40}$/.test(m.id) ? m.id : newId();
    measures.push({ id, treble, bass });
  }

  const texte = (t: unknown, defaut: string) =>
    typeof t === "string" ? t.trim().slice(0, LIMITES.titre) || defaut : defaut;

  // Deux éléments ne doivent jamais partager un identifiant (fichier copié-collé, etc.).
  const vus = new Set<string>();
  const unique = (id: string) => {
    const libre = vus.has(id) ? newId() : id;
    vus.add(libre);
    return libre;
  };
  for (const m of measures) {
    m.id = unique(m.id);
    for (const n of [...m.treble, ...m.bass]) n.id = unique(n.id);
  }

  return {
    version: 1,
    title: texte(v.title, "Sans titre"),
    composer: texte(v.composer, ""),
    tempo: tempo as number,
    timeSig: { num: num as number, den: den as number },
    keySignature,
    measures,
  };
}
