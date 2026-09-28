// Règles de solfège partagées par le rendu (MEI) et l'export (MusicXML).

import { KEY_SIGNATURES, noteBeats, type Accidental, type Duration, type KeySignature, type Letter, type Note, type Pitch, type Score } from "../shared/score";

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
 * Découpe une portée en groupes de ligature : notes consécutives de moins d'une noire
 * (hors silences) dans le même temps. Renvoie, pour chaque note, son groupe (null = non ligaturée).
 */
export function groupesLigature(notes: Note[], timeSig: Score["timeSig"]): (Note[] | null)[] {
  const groupe = groupeLigature(timeSig);
  const res: (Note[] | null)[] = [];
  let courant: Note[] = [];
  let temps = -1;
  let pos = 0;
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
