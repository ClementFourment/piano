// Export MusicXML 4.0 (partwise) : une partie « Piano » à deux portées.
// S'ouvre dans MuseScore, Sibelius, Finale, Dorico…

import { KEY_SIGNATURES, measureCapacity, noteBeats, type Accidental, type Articulation, type Duration, type Note, type Score } from "../shared/score";
import { notesSuivantes, segments, suiviAlterations, tetesLiees } from "./solfege";

/** Unités par noire : 12, divisible par 4 (doubles croches) et par 3 (triolets). */
const DIVISIONS = 12;
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

const ARTICULATION_XML: Partial<Record<Articulation, string>> = {
  staccato: "<staccato/>", accent: "<accent/>", tenuto: "<tenuto/>", marcato: '<strong-accent type="up"/>',
};

function articulationsXml(n: Note): string {
  const a = (n.articulations ?? []).map((x) => ARTICULATION_XML[x]).filter(Boolean).join("");
  const orgue = n.articulations?.includes("fermata") ? '<fermata type="upright"/>' : "";
  return (a ? `<articulations>${a}</articulations>` : "") + orgue;
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
  // Groupe de ligature et position dans un triolet, pour chaque note.
  const infos = new Map<Note, { ligature: Note[] | null; triolet: "start" | "stop" | "milieu" | "seul" | null }>();
  for (const seg of segments(notes, score.timeSig)) {
    seg.notes.forEach((n, i) => {
      const dernier = i === seg.notes.length - 1;
      const triolet = !seg.triolet ? null : seg.notes.length === 1 ? "seul" : i === 0 ? "start" : dernier ? "stop" : "milieu";
      infos.set(n, { ligature: seg.ligatures[i], triolet });
    });
  }
  let xml = "";
  let duree = 0;
  notes.forEach((n) => {
    const info = infos.get(n)!;
    // Indications placées avant la note (elles s'attachent à son instant).
    if (n.dynamic) xml += direction(`<dynamics><${n.dynamic}/></dynamics>`, `<sound dynamics="${SON_NUANCE[n.dynamic]}"/>`);
    if (n.hairpin && ctx.finsDeSoufflet.has(n.hairpin.end)) {
      xml += direction(`<wedge type="${n.hairpin.form === "cres" ? "crescendo" : "diminuendo"}"/>`);
    }

    const d = unites(noteBeats(n));
    const figure = `${fin}<type>${TYPE[n.duration]}</type>${n.dotted ? "<dot/>" : ""}`;
    const modification = n.triolet ? "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>" : "";
    // Groupe incomplet d'une seule note : début et fin sur la même note.
    const marqueTriolet =
      (info.triolet === "start" || info.triolet === "seul" ? '<tuplet type="start" bracket="no"/>' : "") +
      (info.triolet === "stop" || info.triolet === "seul" ? '<tuplet type="stop"/>' : "");
    if (n.rest) {
      const notations = marqueTriolet + articulationsXml(n);
      xml += `<note><rest/><duration>${d}</duration>${figure}${modification}<staff>${staff}</staff>${notations ? `<notations>${notations}</notations>` : ""}</note>`;
    } else {
      const liees = new Set(tetesLiees(n, ctx.suivantes.get(n.id)).map(([i]) => i));
      n.pitches.forEach((p, i) => {
        const alter = alteration(p);
        const arrivee = ctx.finsDeProlongation.has(`${n.id}:${i}`);
        const depart = liees.has(i);
        const ties = (arrivee ? '<tie type="stop"/>' : "") + (depart ? '<tie type="start"/>' : "");
        let notations = (arrivee ? '<tied type="stop"/>' : "") + (depart ? '<tied type="start"/>' : "");
        // L'arpège se note sur chaque note de l'accord.
        if (n.arpege && n.pitches.length > 1) notations += "<arpeggiate/>";
        if (i === 0) {
          notations += marqueTriolet + articulationsXml(n);
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
          modification +
          `<staff>${staff}</staff>` +
          (i === 0 ? ligatures(n, info.ligature) : "") +
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

/** Début de reprise et début de case. */
function barreGauche(score: Score, i: number): string {
  const m = score.measures[i];
  const debutCase = m.volta && m.volta !== score.measures[i - 1]?.volta;
  if (!m.repriseDebut && !debutCase) return "";
  return (
    `<barline location="left">` +
    (m.repriseDebut ? "<bar-style>heavy-light</bar-style>" : "") +
    (debutCase ? `<ending number="${m.volta}" type="start">${m.volta}.</ending>` : "") +
    (m.repriseDebut ? '<repeat direction="forward"/>' : "") +
    `</barline>`
  );
}

/** Barre de fin, fin de reprise et fin de case. */
function barreDroite(score: Score, i: number): string {
  const m = score.measures[i];
  const barre = m.barre ?? (i === score.measures.length - 1 ? "final" : "simple");
  const finCase = m.volta && m.volta !== score.measures[i + 1]?.volta;
  if (barre === "simple" && !finCase) return "";
  const style = { simple: "regular", double: "light-light", final: "light-heavy", reprise: "light-heavy" }[barre];
  return (
    `<barline location="right"><bar-style>${style}</bar-style>` +
    // Case 1 fermée par un crochet, case 2 laissée ouverte (usage courant).
    (finCase ? `<ending number="${m.volta}" type="${m.volta === 1 ? "stop" : "discontinue"}"/>` : "") +
    (barre === "reprise" ? '<repeat direction="backward"/>' : "") +
    `</barline>`
  );
}

export function scoreToMusicXml(score: Score): string {
  const ctx = contexte(score);
  const mesures = score.measures
    .map((m, i) => {
      let xml = `<measure number="${i + 1}">` + barreGauche(score, i);
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
      xml += barreDroite(score, i);
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
