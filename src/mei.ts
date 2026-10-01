// Conversion d'une partition (shared/score.ts) en MEI, le format natif de Verovio.
//
// Deux points de solfège sont gérés ici plutôt que laissés au moteur :
// - la hauteur jouée (accid.ges) suit l'armure et les altérations accidentelles,
//   qui valent jusqu'à la fin de la mesure, à la même octave ;
// - les croches et doubles croches sont ligaturées par temps.

import { KEY_SIGNATURES, aDeuxVoix, notesDe, toutesNotes, measureCapacity, noteBeats, type Accidental, type Articulation, type Barre, type Duration, type Measure, type Note, type Score } from "../shared/score";
import { coteIndications, cotesLiaisons, notesADeuxVoix, notesSuivantes, segments, sensHampes, suiviAlterations, tetesLiees, type Sens } from "./solfege";

const DUR: Record<Duration, string> = { whole: "1", half: "2", quarter: "4", eighth: "8", sixteenth: "16" };
const ACCID: Record<NonNullable<Accidental>, string> = { sharp: "s", flat: "f", natural: "n" };

/** Écart pour faire passer un doigté au-delà d'un bout de liaison, en demi-interlignes (« vu »). */
const ECART_LIAISON = 2;

/** Marque (espace de largeur nulle) des noms de mains à remplacer par un dessin (voir verovio.ts). */
export const MARQUE_DESSIN_MAIN = "\u200B";

/** Suffixe des identifiants des notes d'un accord : `${id}${CHORD_SEP}${i}`. */
export const CHORD_SEP = "-";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function durAttrs(n: Note): string {
  return `dur="${DUR[n.duration]}"${n.dotted ? ' dots="1"' : ""}`;
}

function layer(notes: Note[], score: Score, sens: Map<string, Sens>): string {
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
    const artic = articulation(n);
    // Sens imposé : les doigtés et les liaisons sont placés d'après lui.
    const hampe = sens.has(n.id) ? ` stem.dir="${sens.get(n.id)}"` : "";
    const tetes = n.pitches.map((p, i) => {
      const alter = alteration(p);
      const ges = alter === 1 ? "s" : alter === -1 ? "f" : "n";
      const id = n.pitches.length > 1 ? `${n.id}${CHORD_SEP}${i}` : n.id;
      const accid = p.accidental ? ` accid="${ACCID[p.accidental]}"` : "";
      const dur = n.pitches.length > 1 ? "" : ` ${durAttrs(n)}${hampe}`;
      const debut = `<note xml:id="${id}"${dur} pname="${p.letter.toLowerCase()}" oct="${p.octave}"${accid} accid.ges="${ges}"`;
      // Note seule : l'articulation va dans la note ; accord : dans l'accord.
      return artic && n.pitches.length === 1 ? `${debut}>${artic}</note>` : `${debut}/>`;
    });
    return n.pitches.length > 1 ? `<chord xml:id="${n.id}" ${durAttrs(n)}${hampe}>${artic}${tetes.join("")}</chord>` : tetes[0];
  };

  let out = "";
  for (const seg of segments(notes, score.timeSig)) {
    if (seg.triolet) out += `<tuplet num="3" numbase="2" num.visible="true" bracket.visible="${seg.ligatures.every(Boolean) ? "false" : "true"}">`;
    seg.notes.forEach((n, i) => {
      const g = seg.ligatures[i];
      if (g && g[0] === n) out += "<beam>";
      out += element(n);
      if (g && g[g.length - 1] === n) out += "</beam>";
    });
    if (seg.triolet) out += "</tuplet>";
  }
  return out;
}

const BARRE_MEI: Record<Barre, string> = { simple: "single", double: "dbl", final: "end", reprise: "rptend" };

/** Attributs left/right d'une mesure (barres et reprises). */
function barres(m: Measure, derniere: boolean): string {
  const droite = m.barre ? BARRE_MEI[m.barre] : derniere ? "end" : "";
  return (m.repriseDebut ? ' left="rptstart"' : "") + (droite && droite !== "single" ? ` right="${droite}"` : "");
}

const ARTIC: Partial<Record<Articulation, string>> = { staccato: "stacc", accent: "acc", tenuto: "ten", marcato: "marc" };

/** Élément <artic> (le point d'orgue est à part : c'est un élément de contrôle). */
function articulation(n: Note): string {
  const valeurs = (n.articulations ?? []).map((a) => ARTIC[a]).filter(Boolean);
  return valeurs.length ? `<artic artic="${valeurs.join(" ")}"/>` : "";
}

export function scoreToMei(score: Score): string {
  const fifths = KEY_SIGNATURES[score.keySignature];
  const keysig = fifths === 0 ? "0" : `${Math.abs(fifths)}${fifths > 0 ? "s" : "f"}`;
  const titre = esc(score.title);
  const compositeur = esc(score.composer);

  /** Nom de la main devant la portée, sur chaque système. */
  // Pour le dessin, le texte (qui réserve la place) porte une marque invisible : il est remplacé après le rendu.
  const main = (nom: string) => {
    if (!score.mains) return "";
    const texte = nom + (score.mains === "dessin" ? MARQUE_DESSIN_MAIN : "");
    return `<label>${texte}</label><labelAbbr>${texte}</labelAbbr>`;
  };

  const suivantes = notesSuivantes(score);
  const sens = sensHampes(score);
  const cotes = cotesLiaisons(score, sens);
  const deuxVoix = notesADeuxVoix(score);
  const parId = new Map(score.measures.flatMap(toutesNotes).map((n) => [n.id, n]));

  /**
   * Rondes doigtées au bout d'une liaison du même côté : sans hampe, Verovio fait partir
   * la liaison de la tête, à l'endroit du chiffre. La liaison garde son départ contre la
   * note et le chiffre est repoussé au-delà. (Pour les notes à hampe, Verovio s'en charge.)
   */
  const chiffresRepousses = new Set<string>();
  for (const n of parId.values()) {
    const cote = cotes.get(n.id);
    if (!n.slurEnd || !cote) continue;
    for (const x of [n, parId.get(n.slurEnd)]) {
      if (x?.duration === "whole" && coteIndications(x.id, sens, deuxVoix) === cote) chiffresRepousses.add(x.id);
    }
  }
  const liaison = (n: Note, staff: 1 | 2) =>
    `<slur staff="${staff}" curvedir="${cotes.get(n.id) ?? "above"}" startid="#${n.id}" endid="#${n.slurEnd}"/>`;
  const ids = new Set(score.measures.flatMap((m) => toutesNotes(m).map((n) => n.id)));
  const tete = (n: Note, i: number) => (n.pitches.length > 1 ? `${n.id}${CHORD_SEP}${i}` : n.id);

  /** Liaisons, nuances et soufflets qui commencent dans la mesure (placés entre les portées). */
  const indications = (notes: Note[], staff: 1 | 2) =>
    notes
      .map((n) => {
        let xml = "";
        const suiv = suivantes.get(n.id);
        for (const [i, j] of tetesLiees(n, suiv)) xml += `<tie startid="#${tete(n, i)}" endid="#${tete(suiv!, j)}"/>`;
        if (n.slurEnd && ids.has(n.slurEnd)) xml += liaison(n, staff);
        if (n.dynamic) xml += `<dynam staff="${staff}" place="below" startid="#${n.id}">${n.dynamic}</dynam>`;
        // Doigtés : côté des têtes de notes, sous la liaison éventuelle.
        n.pitches.forEach((p, i) => {
          if (!p.doigt) return;
          const place = coteIndications(n.id, sens, deuxVoix);
          const vo = chiffresRepousses.has(n.id) ? ` vo="${place === "above" ? ECART_LIAISON : -ECART_LIAISON}vu"` : "";
          xml += `<fing staff="${staff}" place="${place}"${vo} startid="#${tete(n, i)}">${p.doigt}</fing>`;
        });
        if (n.arpege && n.pitches.length > 1) xml += `<arpeg staff="${staff}" startid="#${n.id}"/>`;
        if (n.articulations?.includes("fermata")) {
          const s = sens.get(n.id);
          const place = s ? (s === "up" ? "above" : "below") : staff === 1 ? "above" : "below";
          xml += `<fermata staff="${staff}" place="${place}" startid="#${n.id}"/>`;
        }
        if (n.hairpin && ids.has(n.hairpin.end)) {
          xml += `<hairpin form="${n.hairpin.form}" staff="${staff}" place="below" startid="#${n.id}" endid="#${n.hairpin.end}"/>`;
        }
        return xml;
      })
      .join("");

  const derniere = score.measures.length - 1;
  const xmlMesures = score.measures.map(
      (m, i) =>
        `<measure xml:id="${m.id}" n="${i + 1}"${barres(m, i === derniere)}>` +
        `<staff n="1"><layer n="1">${layer(m.treble, score, sens)}</layer>` +
        (aDeuxVoix(m, "treble") ? `<layer n="2">${layer(notesDe(m, "treble2"), score, sens)}</layer>` : "") +
        `</staff>` +
        `<staff n="2"><layer n="1">${layer(m.bass, score, sens)}</layer>` +
        (aDeuxVoix(m, "bass") ? `<layer n="2">${layer(notesDe(m, "bass2"), score, sens)}</layer>` : "") +
        `</staff>` +
        indications(m.treble, 1) +
        indications(notesDe(m, "treble2"), 1) +
        indications(m.bass, 2) +
        indications(notesDe(m, "bass2"), 2) +
        (m.texte ? `<dir staff="1" place="above" tstamp="0"><rend fontstyle="normal">${esc(m.texte)}</rend></dir>` : "") +
        (i === 0 && !score.tempoMasque
          ? `<tempo tstamp="1" staff="1" place="above" mm="${score.tempo}" mm.unit="4" midi.bpm="${score.tempo}">` +
            `<rend fontstyle="normal"><rend glyph.auth="smufl">&#xE1D5;</rend> = ${score.tempo}</rend></tempo>`
          : "") +
        `</measure>`,
    );

  // Les mesures consécutives d'une même case sont regroupées dans un <ending>.
  let mesures = "";
  score.measures.forEach((m, i) => {
    const prec = score.measures[i - 1]?.volta;
    const suiv = score.measures[i + 1]?.volta;
    if (m.volta && m.volta !== prec) mesures += `<ending xml:id="${m.id}-v" n="${m.volta}" label="${m.volta}.">`;
    mesures += xmlMesures[i];
    if (m.volta && m.volta !== suiv) mesures += "</ending>";
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1">
<meiHead><fileDesc><titleStmt><title>${titre}</title>${
    compositeur ? `<composer>${compositeur}</composer>` : ""
  }</titleStmt><pubStmt/></fileDesc></meiHead>
<music><body><mdiv><score>
<scoreDef midi.bpm="${score.tempo}">
<staffGrp symbol="brace" bar.thru="true">
<staffDef n="1" lines="5">${main("M.D.")}<clef shape="G" line="2"/><keySig sig="${keysig}"/><meterSig count="${score.timeSig.num}" unit="${score.timeSig.den}"/></staffDef>
<staffDef n="2" lines="5">${main("M.G.")}<clef shape="F" line="4"/><keySig sig="${keysig}"/><meterSig count="${score.timeSig.num}" unit="${score.timeSig.den}"/></staffDef>
</staffGrp>
</scoreDef>
<section>${mesures}</section>
</score></mdiv></body></music>
</mei>`;
}
