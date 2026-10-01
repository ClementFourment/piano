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
  /** Doigté (1 = pouce … 5 = auriculaire). */
  doigt?: Doigt;
}

export const DOIGTS = [1, 2, 3, 4, 5] as const;
export type Doigt = (typeof DOIGTS)[number];

export const ARTICULATIONS = ["staccato", "accent", "tenuto", "marcato", "fermata"] as const;
export type Articulation = (typeof ARTICULATIONS)[number];

export const DYNAMICS = ["pp", "p", "mp", "mf", "f", "ff"] as const;
export type Dynamic = (typeof DYNAMICS)[number];

export interface Note {
  id: string;
  rest: boolean;
  /** Vide pour un silence ; plusieurs hauteurs = accord. */
  pitches: Pitch[];
  duration: Duration;
  dotted: boolean;
  /** Note de triolet : dure les 2/3 de sa valeur écrite (3 notes dans le temps de 2). */
  triolet?: boolean;
  articulations?: Articulation[];
  /** Accord arpégé : notes égrenées du grave vers l'aigu. */
  arpege?: boolean;
  /** Liaison de prolongation vers la note suivante de la même portée (hauteurs communes). */
  tie?: boolean;
  /** Liaison de phrasé : identifiant de la dernière note liée (même portée, plus loin). */
  slurEnd?: string;
  /** Nuance qui commence sur cette note. */
  dynamic?: Dynamic;
  /** Soufflet (crescendo ou decrescendo) de cette note jusqu'à `end`. */
  hairpin?: { form: "cres" | "dim"; end: string };
}

export const BARRES = ["simple", "double", "final", "reprise"] as const;
/** Barre à la fin de la mesure ; « reprise » = fin de reprise (:‖). */
export type Barre = (typeof BARRES)[number];

export interface Measure {
  id: string;
  /** Voix 1 de chaque portée. */
  treble: Note[];
  bass: Note[];
  /** Voix 2 (facultative) : notes jouées en même temps que la voix 1, hampes en bas. */
  treble2?: Note[];
  bass2?: Note[];
  /** Barre de fin (absente : simple, ou finale pour la dernière mesure). */
  barre?: Barre;
  /** La mesure commence par un début de reprise (‖:). */
  repriseDebut?: boolean;
  /** Case de première ou deuxième fois (les mesures consécutives d'une même case forment un seul crochet). */
  volta?: 1 | 2;
  /** Texte écrit au-dessus du début de la mesure (consigne, indication). */
  texte?: string;
}

export interface Score {
  version: 1;
  title: string;
  composer: string;
  tempo: number;
  /** Indication de tempo masquée sur la partition (la lecture garde le tempo). */
  tempoMasque?: boolean;
  /** « M.D. » et « M.G. » écrits devant chaque système. */
  mains?: boolean;
  timeSig: { num: number; den: number };
  keySignature: KeySignature;
  measures: Measure[];
}

/** Une suite de notes d'une mesure : portée (clé de sol / de fa) et voix (1 ou 2). */
export const PORTEES = ["treble", "bass", "treble2", "bass2"] as const;
export type Portee = (typeof PORTEES)[number];
export type Voix = 1 | 2;

export const cleDe = (p: Portee): Clef => (p.startsWith("treble") ? "treble" : "bass");
export const voixDe = (p: Portee): Voix => (p.endsWith("2") ? 2 : 1);
export const portee = (cle: Clef, voix: Voix): Portee => (voix === 2 ? `${cle}2` : cle);
export const notesDe = (m: Measure, p: Portee): Note[] => m[p] ?? [];
/** Toutes les notes d'une mesure (les deux portées, les deux voix). */
export const toutesNotes = (m: Measure): Note[] => PORTEES.flatMap((p) => notesDe(m, p));
/** La portée a deux voix dans cette mesure. */
export const aDeuxVoix = (m: Measure, cle: Clef): boolean => notesDe(m, portee(cle, 2)).length > 0;

export const BEATS: Record<Duration, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25 };

/** Durée réelle d'une note, en noires (pointée : ×1,5 ; triolet : ×2/3). */
export function noteBeats(n: Pick<Note, "duration" | "dotted" | "triolet">): number {
  return BEATS[n.duration] * (n.dotted ? 1.5 : 1) * (n.triolet ? 2 / 3 : 1);
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
  const pitch: Pitch = { letter: p.letter as Letter, accidental: accidental as Accidental, octave: p.octave as number };
  if (DOIGTS.includes(p.doigt as Doigt)) pitch.doigt = p.doigt as Doigt;
  return pitch;
}

/**
 * Lit une note. Accepte aussi l'ancien format du prototype
 * (une seule hauteur posée directement sur la note : letter/accidental/octave).
 */
const estId = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z][\w-]{0,40}$/.test(v);

function lireNote(n: unknown): Note | null {
  if (!isObj(n)) return null;
  if (!DURATIONS.includes(n.duration as Duration)) return null;
  const base: Omit<Note, "rest" | "pitches"> = {
    id: estId(n.id) ? n.id : newId(),
    duration: n.duration as Duration,
    dotted: n.dotted === true,
  };
  // Indications facultatives : ignorées si elles sont mal formées.
  if (n.triolet === true) base.triolet = true;
  if (Array.isArray(n.articulations)) {
    const a = ARTICULATIONS.filter((x) => (n.articulations as unknown[]).includes(x));
    if (a.length) base.articulations = a;
  }
  if (DYNAMICS.includes(n.dynamic as Dynamic)) base.dynamic = n.dynamic as Dynamic;
  if (isObj(n.hairpin) && (n.hairpin.form === "cres" || n.hairpin.form === "dim") && estId(n.hairpin.end)) {
    base.hairpin = { form: n.hairpin.form, end: n.hairpin.end };
  }
  if (n.rest === true) return { ...base, rest: true, pitches: [] };
  if (n.tie === true) base.tie = true;
  if (n.arpege === true) base.arpege = true;
  if (estId(n.slurEnd)) base.slurEnd = n.slurEnd;
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
    const treble2 = lirePortee(m.treble2);
    const bass2 = lirePortee(m.bass2);
    if (!treble || !bass || !treble2 || !bass2) return `Note invalide dans la mesure ${measures.length + 1}.`;
    const id = estId(m.id) ? m.id : newId();
    const mesure: Measure = { id, treble, bass };
    if (treble2.length) mesure.treble2 = treble2;
    if (bass2.length) mesure.bass2 = bass2;
    if (BARRES.includes(m.barre as Barre)) mesure.barre = m.barre as Barre;
    if (m.repriseDebut === true) mesure.repriseDebut = true;
    if (m.volta === 1 || m.volta === 2) mesure.volta = m.volta;
    if (typeof m.texte === "string" && m.texte.trim()) mesure.texte = m.texte.trim().slice(0, LIMITES.titre);
    measures.push(mesure);
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
    for (const n of toutesNotes(m)) n.id = unique(n.id);
  }

  return {
    version: 1,
    title: texte(v.title, "Sans titre"),
    composer: texte(v.composer, ""),
    tempo: tempo as number,
    ...(v.tempoMasque === true ? { tempoMasque: true } : {}),
    ...(v.mains === true ? { mains: true } : {}),
    timeSig: { num: num as number, den: den as number },
    keySignature,
    measures,
  };
}
