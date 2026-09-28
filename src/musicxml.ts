// Export MusicXML 4.0 (partwise) : une partie « Piano » à deux portées.
// S'ouvre dans MuseScore, Sibelius, Finale, Dorico…

import { KEY_SIGNATURES, measureCapacity, noteBeats, type Accidental, type Duration, type Note, type Score } from "../shared/score";
import { groupesLigature, notesSuivantes, suiviAlterations, tetesLiees } from "./solfege";

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

/** Liaisons et soufflets vus depuis leur note d'arrivée, calculés une fois pour toute la partition. */
interface Contexte {
  suivantes: Map<string, Note>;
  /** `${idNote}:${indexTête}` des têtes où finit une prolongation. */
  finsDeProlongation: Set<string>;
  /** Note d'arrivée d'une liaison de phrasé → numéro de la liaison. */
  finsDeLiaison: Map<string, number>;
  /** Notes où finit un soufflet. */
  finsDeSoufflet: Set<string>;
  /** Note de départ d'une liaison de phrasé → numéro. */
  numeros: Map<string, number>;
}

function contexte(score: Score): Contexte {
  const suivantes = notesSuivantes(score);
  const ids = new Set(score.measures.flatMap((m) => [...m.treble, ...m.bass].map((n) => n.id)));
  const ctx: Contexte = { suivantes, finsDeProlongation: new Set(), finsDeLiaison: new Map(), finsDeSoufflet: new Set(), numeros: new Map() };
  for (const cle of ["treble", "bass"] as const) {
    let numero = 0;
    for (const m of score.measures) {
      for (const n of m[cle]) {
        const suiv = suivantes.get(n.id);
        for (const [, j] of tetesLiees(n, suiv)) ctx.finsDeProlongation.add(`${suiv!.id}:${j}`);
        if (n.slurEnd && ids.has(n.slurEnd)) {
          numero = (numero % 6) + 1;
          ctx.numeros.set(n.id, numero);
          ctx.finsDeLiaison.set(n.slurEnd, numero);
        }
        if (n.hairpin && ids.has(n.hairpin.end)) ctx.finsDeSoufflet.add(n.hairpin.end);
      }
    }
  }
  return ctx;
}

/** Vélocité de chaque nuance ramenée à l'échelle MusicXML (100 = forte… environ). */
const SON_NUANCE: Record<string, number> = { pp: 38, p: 54, mp: 69, mf: 84, f: 102, ff: 118 };

function portee(notes: Note[], score: Score, staff: 1 | 2, ctx: Contexte): { xml: string; duree: number } {
  const voice = staff === 1 ? 1 : 5;
  const capacite = unites(measureCapacity(score.timeSig));
  const fin = `<voice>${voice}</voice>`;
  const direction = (contenu: string, son = "") =>
    `<direction placement="below"><direction-type>${contenu}</direction-type><staff>${staff}</staff>${son}</direction>`;

  // Portée vide : pause d'une mesure (un fichier MusicXML attend des mesures complètes).
  if (notes.length === 0) {
    return { xml: `<note><rest measure="yes"/><duration>${capacite}</duration>${fin}<staff>${staff}</staff></note>`, duree: capacite };
  }

  const alteration = suiviAlterations(score.keySignature);
  const groupes = groupesLigature(notes, score.timeSig);
  let xml = "";
  let duree = 0;
  notes.forEach((n, idx) => {
    // Indications placées avant la note (elles s'attachent à son instant).
    if (n.dynamic) xml += direction(`<dynamics><${n.dynamic}/></dynamics>`, `<sound dynamics="${SON_NUANCE[n.dynamic]}"/>`);
    if (n.hairpin && ctx.finsDeSoufflet.has(n.hairpin.end)) {
      xml += direction(`<wedge type="${n.hairpin.form === "cres" ? "crescendo" : "diminuendo"}"/>`);
    }

    const d = unites(noteBeats(n));
    const figure = `${fin}<type>${TYPE[n.duration]}</type>${n.dotted ? "<dot/>" : ""}`;
    if (n.rest) {
      xml += `<note><rest/><duration>${d}</duration>${figure}<staff>${staff}</staff></note>`;
    } else {
      const liees = new Set(tetesLiees(n, ctx.suivantes.get(n.id)).map(([i]) => i));
      n.pitches.forEach((p, i) => {
        const alter = alteration(p);
        const arrivee = ctx.finsDeProlongation.has(`${n.id}:${i}`);
        const depart = liees.has(i);
        const ties = (arrivee ? '<tie type="stop"/>' : "") + (depart ? '<tie type="start"/>' : "");
        let notations = (arrivee ? '<tied type="stop"/>' : "") + (depart ? '<tied type="start"/>' : "");
        if (i === 0) {
          const finLiaison = ctx.finsDeLiaison.get(n.id);
          if (finLiaison) notations += `<slur type="stop" number="${finLiaison}"/>`;
          const debutLiaison = ctx.numeros.get(n.id);
          if (debutLiaison) notations += `<slur type="start" number="${debutLiaison}" placement="above"/>`;
        }
        xml +=
          `<note>${i > 0 ? "<chord/>" : ""}` +
          `<pitch><step>${p.letter}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${p.octave}</octave></pitch>` +
          `<duration>${d}</duration>${ties}${figure}` +
          (p.accidental ? `<accidental>${ACCIDENT[p.accidental]}</accidental>` : "") +
          `<staff>${staff}</staff>` +
          (i === 0 ? ligatures(n, groupes[idx]) : "") +
          (notations ? `<notations>${notations}</notations>` : "") +
          `</note>`;
      });
    }
    duree += d;
    if (ctx.finsDeSoufflet.has(n.id)) xml += direction(`<wedge type="stop"/>`);
  });
  // Mesure incomplète : on avance jusqu'à la fin sans rien écrire.
  if (duree < capacite) {
    xml += `<forward><duration>${capacite - duree}</duration>${fin}<staff>${staff}</staff></forward>`;
    duree = capacite;
  }
  return { xml, duree };
}

export function scoreToMusicXml(score: Score): string {
  const ctx = contexte(score);
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
      const haut = portee(m.treble, score, 1, ctx);
      const bas = portee(m.bass, score, 2, ctx);
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
