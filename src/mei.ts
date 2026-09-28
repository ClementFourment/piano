// Conversion d'une partition (shared/score.ts) en MEI, le format natif de Verovio.
//
// Deux points de solfège sont gérés ici plutôt que laissés au moteur :
// - la hauteur jouée (accid.ges) suit l'armure et les altérations accidentelles,
//   qui valent jusqu'à la fin de la mesure, à la même octave ;
// - les croches et doubles croches sont ligaturées par temps.

import {
  KEY_SIGNATURES,
  measureCapacity,
  noteBeats,
  type Accidental,
  type Duration,
  type Letter,
  type Note,
  type Score,
} from "../shared/score";

const DUR: Record<Duration, string> = { whole: "1", half: "2", quarter: "4", eighth: "8", sixteenth: "16" };
const ACCID: Record<NonNullable<Accidental>, string> = { sharp: "s", flat: "f", natural: "n" };
const ALTER: Record<NonNullable<Accidental>, number> = { sharp: 1, flat: -1, natural: 0 };
const ORDRE_DIESES: Letter[] = ["F", "C", "G", "D", "A", "E", "B"];

/** Suffixe des identifiants des notes d'un accord : `${id}${CHORD_SEP}${i}`. */
export const CHORD_SEP = "-";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Altération (-1, 0, +1) imposée par l'armure à chaque note. */
function alterationsArmure(fifths: number): Record<Letter, number> {
  const alt = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 } as Record<Letter, number>;
  const ordre = fifths >= 0 ? ORDRE_DIESES : [...ORDRE_DIESES].reverse();
  for (let i = 0; i < Math.abs(fifths); i++) alt[ordre[i]] = Math.sign(fifths);
  return alt;
}

function durAttrs(n: Note): string {
  return `dur="${DUR[n.duration]}"${n.dotted ? ' dots="1"' : ""}`;
}

/** Longueur d'un groupe de ligature, en noires : une noire pointée en 6/8, 9/8, 12/8, une blanche en x/2, sinon une noire. */
function groupeLigature(timeSig: Score["timeSig"]): number {
  if (timeSig.den === 8 && timeSig.num % 3 === 0) return 1.5;
  if (timeSig.den === 2) return 2;
  return 1;
}

const LIGATURABLE: Partial<Record<Duration, true>> = { eighth: true, sixteenth: true };

function layer(notes: Note[], score: Score, armure: Record<Letter, number>): string {
  const capacity = measureCapacity(score.timeSig);

  // Portée vide : espace invisible (la mesure reste lisible pendant la saisie).
  if (notes.length === 0) return "<mSpace/>";
  // Silence qui remplit toute la mesure : pause centrée.
  if (notes.length === 1 && notes[0].rest && Math.abs(noteBeats(notes[0]) - capacity) < 1e-9) {
    return `<mRest xml:id="${notes[0].id}"/>`;
  }

  const courantes = new Map<string, number>(); // altérations accidentelles en cours dans la mesure
  const element = (n: Note): string => {
    if (n.rest) return `<rest xml:id="${n.id}" ${durAttrs(n)}/>`;
    const tetes = n.pitches.map((p, i) => {
      const cle = p.letter + p.octave;
      let alter: number;
      if (p.accidental) {
        alter = ALTER[p.accidental];
        courantes.set(cle, alter);
      } else {
        alter = courantes.get(cle) ?? armure[p.letter];
      }
      const ges = alter === 1 ? "s" : alter === -1 ? "f" : "n";
      const id = n.pitches.length > 1 ? `${n.id}${CHORD_SEP}${i}` : n.id;
      const accid = p.accidental ? ` accid="${ACCID[p.accidental]}"` : "";
      const dur = n.pitches.length > 1 ? "" : ` ${durAttrs(n)}`;
      return `<note xml:id="${id}"${dur} pname="${p.letter.toLowerCase()}" oct="${p.octave}"${accid} accid.ges="${ges}"/>`;
    });
    return n.pitches.length > 1 ? `<chord xml:id="${n.id}" ${durAttrs(n)}>${tetes.join("")}</chord>` : tetes[0];
  };

  // Ligatures : notes consécutives de moins d'une noire, dans le même temps.
  const groupe = groupeLigature(score.timeSig);
  const out: string[] = [];
  let beam: string[] = [];
  let beamTemps = -1;
  const fermer = () => {
    if (beam.length > 1) out.push(`<beam>${beam.join("")}</beam>`);
    else out.push(...beam);
    beam = [];
  };
  let pos = 0;
  for (const n of notes) {
    const temps = Math.floor(pos / groupe + 1e-9);
    if (!n.rest && LIGATURABLE[n.duration]) {
      if (temps !== beamTemps) fermer();
      beamTemps = temps;
      beam.push(element(n));
    } else {
      fermer();
      out.push(element(n));
    }
    pos += noteBeats(n);
  }
  fermer();
  return out.join("");
}

export function scoreToMei(score: Score): string {
  const fifths = KEY_SIGNATURES[score.keySignature];
  const armure = alterationsArmure(fifths);
  const keysig = fifths === 0 ? "0" : `${Math.abs(fifths)}${fifths > 0 ? "s" : "f"}`;
  const titre = esc(score.title);
  const compositeur = esc(score.composer);

  const mesures = score.measures
    .map(
      (m, i) =>
        `<measure xml:id="${m.id}" n="${i + 1}">` +
        `<staff n="1"><layer n="1">${layer(m.treble, score, armure)}</layer></staff>` +
        `<staff n="2"><layer n="1">${layer(m.bass, score, armure)}</layer></staff>` +
        (i === 0
          ? `<tempo tstamp="1" staff="1" place="above" mm="${score.tempo}" mm.unit="4" midi.bpm="${score.tempo}">` +
            `<rend fontstyle="normal"><rend glyph.auth="smufl">&#xE1D5;</rend> = ${score.tempo}</rend></tempo>`
          : "") +
        `</measure>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1">
<meiHead><fileDesc><titleStmt><title>${titre}</title>${
    compositeur ? `<composer>${compositeur}</composer>` : ""
  }</titleStmt><pubStmt/></fileDesc></meiHead>
<music><body><mdiv><score>
<scoreDef midi.bpm="${score.tempo}">
<staffGrp symbol="brace" bar.thru="true">
<staffDef n="1" lines="5"><clef shape="G" line="2"/><keySig sig="${keysig}"/><meterSig count="${score.timeSig.num}" unit="${score.timeSig.den}"/></staffDef>
<staffDef n="2" lines="5"><clef shape="F" line="4"/><keySig sig="${keysig}"/><meterSig count="${score.timeSig.num}" unit="${score.timeSig.den}"/></staffDef>
</staffGrp>
</scoreDef>
<section>${mesures}</section>
</score></mdiv></body></music>
</mei>`;
}
