// Export MusicXML 4.0 (partwise) : une partie « Piano » à deux portées.
// S'ouvre dans MuseScore, Sibelius, Finale, Dorico…

import { KEY_SIGNATURES, measureCapacity, noteBeats, type Accidental, type Duration, type Note, type Score } from "../shared/score";
import { groupesLigature, suiviAlterations } from "./solfege";

/** Unités par noire : 4 → la double croche vaut 1. */
const DIVISIONS = 4;
const TYPE: Record<Duration, string> = { whole: "whole", half: "half", quarter: "quarter", eighth: "eighth", sixteenth: "16th" };
const ACCIDENT: Record<NonNullable<Accidental>, string> = { sharp: "sharp", flat: "flat", natural: "natural" };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const unites = (beats: number) => Math.round(beats * DIVISIONS);

/** Balises <beam> d'une note dans son groupe de ligature. */
function ligatures(n: Note, groupe: Note[] | null): string {
  if (!groupe) return "";
  const i = groupe.indexOf(n);
  const niveau1 = i === 0 ? "begin" : i === groupe.length - 1 ? "end" : "continue";
  let xml = `<beam number="1">${niveau1}</beam>`;
  if (n.duration === "sixteenth") {
    // Deuxième barre : entre doubles croches voisines, sinon un crochet.
    const avant = groupe[i - 1]?.duration === "sixteenth";
    const apres = groupe[i + 1]?.duration === "sixteenth";
    const niveau2 = avant && apres ? "continue" : avant ? "end" : apres ? "begin" : i > 0 ? "backward hook" : "forward hook";
    xml += `<beam number="2">${niveau2}</beam>`;
  }
  return xml;
}

function portee(notes: Note[], score: Score, staff: 1 | 2): { xml: string; duree: number } {
  const voice = staff === 1 ? 1 : 5;
  const capacite = unites(measureCapacity(score.timeSig));
  const fin = `<voice>${voice}</voice>`;

  // Portée vide : pause d'une mesure (un fichier MusicXML attend des mesures complètes).
  if (notes.length === 0) {
    return { xml: `<note><rest measure="yes"/><duration>${capacite}</duration>${fin}<staff>${staff}</staff></note>`, duree: capacite };
  }

  const alteration = suiviAlterations(score.keySignature);
  const groupes = groupesLigature(notes, score.timeSig);
  let xml = "";
  let duree = 0;
  notes.forEach((n, idx) => {
    const d = unites(noteBeats(n));
    const commun = `<duration>${d}</duration>${fin}<type>${TYPE[n.duration]}</type>${n.dotted ? "<dot/>" : ""}`;
    if (n.rest) {
      xml += `<note><rest/>${commun}<staff>${staff}</staff></note>`;
    } else {
      n.pitches.forEach((p, i) => {
        const alter = alteration(p);
        xml +=
          `<note>${i > 0 ? "<chord/>" : ""}` +
          `<pitch><step>${p.letter}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${p.octave}</octave></pitch>` +
          commun +
          (p.accidental ? `<accidental>${ACCIDENT[p.accidental]}</accidental>` : "") +
          `<staff>${staff}</staff>` +
          (i === 0 ? ligatures(n, groupes[idx]) : "") +
          `</note>`;
      });
    }
    duree += d;
  });
  // Mesure incomplète : on avance jusqu'à la fin sans rien écrire.
  if (duree < capacite) {
    xml += `<forward><duration>${capacite - duree}</duration>${fin}<staff>${staff}</staff></forward>`;
    duree = capacite;
  }
  return { xml, duree };
}

export function scoreToMusicXml(score: Score): string {
  const mesures = score.measures
    .map((m, i) => {
      let xml = `<measure number="${i + 1}">`;
      if (i === 0) {
        xml +=
          `<attributes><divisions>${DIVISIONS}</divisions>` +
          `<key><fifths>${KEY_SIGNATURES[score.keySignature]}</fifths></key>` +
          `<time><beats>${score.timeSig.num}</beats><beat-type>${score.timeSig.den}</beat-type></time>` +
          `<staves>2</staves>` +
          `<clef number="1"><sign>G</sign><line>2</line></clef>` +
          `<clef number="2"><sign>F</sign><line>4</line></clef>` +
          `</attributes>` +
          `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>` +
          `<per-minute>${score.tempo}</per-minute></metronome></direction-type>` +
          `<staff>1</staff><sound tempo="${score.tempo}"/></direction>`;
      }
      const haut = portee(m.treble, score, 1);
      const bas = portee(m.bass, score, 2);
      xml += haut.xml + `<backup><duration>${haut.duree}</duration></backup>` + bas.xml;
      if (i === score.measures.length - 1) xml += `<barline location="right"><bar-style>light-heavy</bar-style></barline>`;
      return xml + `</measure>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>${esc(score.title)}</work-title></work>
<identification>${score.composer ? `<creator type="composer">${esc(score.composer)}</creator>` : ""}<encoding><software>Partitions (clementfourment.fr)</software></encoding></identification>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
${mesures}
</part>
</score-partwise>
`;
}
