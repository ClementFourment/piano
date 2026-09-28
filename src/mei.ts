// Conversion d'une partition (shared/score.ts) en MEI, le format natif de Verovio.
//
// Deux points de solfège sont gérés ici plutôt que laissés au moteur :
// - la hauteur jouée (accid.ges) suit l'armure et les altérations accidentelles,
//   qui valent jusqu'à la fin de la mesure, à la même octave ;
// - les croches et doubles croches sont ligaturées par temps.

import { KEY_SIGNATURES, measureCapacity, noteBeats, type Accidental, type Duration, type Note, type Score } from "../shared/score";
import { groupesLigature, suiviAlterations } from "./solfege";

const DUR: Record<Duration, string> = { whole: "1", half: "2", quarter: "4", eighth: "8", sixteenth: "16" };
const ACCID: Record<NonNullable<Accidental>, string> = { sharp: "s", flat: "f", natural: "n" };

/** Suffixe des identifiants des notes d'un accord : `${id}${CHORD_SEP}${i}`. */
export const CHORD_SEP = "-";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function durAttrs(n: Note): string {
  return `dur="${DUR[n.duration]}"${n.dotted ? ' dots="1"' : ""}`;
}

function layer(notes: Note[], score: Score): string {
  const capacity = measureCapacity(score.timeSig);

  // Portée vide : espace invisible (la mesure reste lisible pendant la saisie).
  if (notes.length === 0) return "<mSpace/>";
  // Silence qui remplit toute la mesure : pause centrée.
  if (notes.length === 1 && notes[0].rest && Math.abs(noteBeats(notes[0]) - capacity) < 1e-9) {
    return `<mRest xml:id="${notes[0].id}"/>`;
  }

  const alteration = suiviAlterations(score.keySignature);
  const element = (n: Note): string => {
    if (n.rest) return `<rest xml:id="${n.id}" ${durAttrs(n)}/>`;
    const tetes = n.pitches.map((p, i) => {
      const alter = alteration(p);
      const ges = alter === 1 ? "s" : alter === -1 ? "f" : "n";
      const id = n.pitches.length > 1 ? `${n.id}${CHORD_SEP}${i}` : n.id;
      const accid = p.accidental ? ` accid="${ACCID[p.accidental]}"` : "";
      const dur = n.pitches.length > 1 ? "" : ` ${durAttrs(n)}`;
      return `<note xml:id="${id}"${dur} pname="${p.letter.toLowerCase()}" oct="${p.octave}"${accid} accid.ges="${ges}"/>`;
    });
    return n.pitches.length > 1 ? `<chord xml:id="${n.id}" ${durAttrs(n)}>${tetes.join("")}</chord>` : tetes[0];
  };

  const groupes = groupesLigature(notes, score.timeSig);
  let out = "";
  notes.forEach((n, i) => {
    const g = groupes[i];
    if (g && g[0] === n) out += "<beam>";
    out += element(n);
    if (g && g[g.length - 1] === n) out += "</beam>";
  });
  return out;
}

export function scoreToMei(score: Score): string {
  const fifths = KEY_SIGNATURES[score.keySignature];
  const keysig = fifths === 0 ? "0" : `${Math.abs(fifths)}${fifths > 0 ? "s" : "f"}`;
  const titre = esc(score.title);
  const compositeur = esc(score.composer);

  const mesures = score.measures
    .map(
      (m, i) =>
        `<measure xml:id="${m.id}" n="${i + 1}"${i === score.measures.length - 1 ? ' right="end"' : ""}>` +
        `<staff n="1"><layer n="1">${layer(m.treble, score)}</layer></staff>` +
        `<staff n="2"><layer n="1">${layer(m.bass, score)}</layer></staff>` +
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
