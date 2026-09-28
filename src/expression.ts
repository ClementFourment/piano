// Ce que Verovio ne fait pas à la lecture : tenir les notes prolongées et suivre les nuances.
// Les indications sont lues dans le MEI du document chargé ; ça marche donc aussi
// pour les partitions importées (du moment que les indications sont rattachées à des notes).

import type { VerovioToolkit } from "verovio/esm";

/** Vélocité MIDI (1–127) de chaque nuance. */
const NIVEAUX: Record<string, number> = {
  pppp: 16, ppp: 24, pp: 34, p: 48, mp: 62, mf: 76, f: 92, ff: 106, fff: 116, ffff: 124,
};
const NIVEAU_DEFAUT = NIVEAUX.mf;
/** Écart d'un soufflet quand aucune nuance n'indique où il mène. */
const AMPLITUDE_SOUFFLET = 26;

export interface Expression {
  /** Tête de note → tête suivante à laquelle elle est prolongée. */
  prolongations: Map<string, string>;
  /** Têtes qui ne doivent pas être rejouées (fin d'une prolongation). */
  finsDeProlongation: Set<string>;
  /** Vélocité à un instant donné (ms). */
  velocite(ms: number): number;
  /** Effet des articulations sur une tête de note : durée ×facteur, vélocité +bonus. */
  articulation(id: string): { duree: number; bonus: number };
}

/** Staccato : moitié de la durée ; accent et marcato : plus fort ; point d'orgue : tenu deux fois plus. */
const EFFETS: Record<string, { duree: number; bonus: number }> = {
  stacc: { duree: 0.5, bonus: 0 },
  stacciss: { duree: 0.3, bonus: 0 },
  acc: { duree: 1, bonus: 16 },
  marc: { duree: 0.75, bonus: 26 },
  ten: { duree: 1, bonus: 4 },
  fermata: { duree: 2, bonus: 0 },
};

const cible = (el: Element, attr: string) => el.getAttribute(attr)?.replace(/^#/, "") ?? null;

export function lireExpression(tk: VerovioToolkit): Expression {
  // Verovio ne calcule les instants des notes qu'avec la chronologie : on s'assure qu'elle existe.
  tk.renderToTimemap();
  const doc = new DOMParser().parseFromString(tk.getMEI({}), "application/xml");
  const tous = (nom: string) => Array.from(doc.getElementsByTagNameNS("*", nom));
  const instant = (id: string | null) => {
    if (!id) return null;
    const v = tk.getMIDIValuesForElement(id);
    return v && v.duration > 0 ? v.time : null;
  };

  const prolongations = new Map<string, string>();
  const finsDeProlongation = new Set<string>();
  for (const tie of tous("tie")) {
    const debut = cible(tie, "startid");
    const fin = cible(tie, "endid");
    if (debut && fin) {
      prolongations.set(debut, fin);
      finsDeProlongation.add(fin);
    }
  }

  // Nuances : (instant, niveau), triées.
  const nuances: { t: number; niveau: number }[] = [];
  for (const d of tous("dynam")) {
    const niveau = NIVEAUX[(d.textContent ?? "").trim().toLowerCase()];
    const t = instant(cible(d, "startid"));
    if (niveau && t !== null) nuances.push({ t, niveau });
  }
  nuances.sort((a, b) => a.t - b.t);

  const niveauA = (ms: number) => {
    let n = NIVEAU_DEFAUT;
    for (const d of nuances) if (d.t <= ms + 1) n = d.niveau;
    return n;
  };

  // Soufflets : du niveau au départ jusqu'à la nuance qui suit (ou ± une marge).
  const soufflets = tous("hairpin").flatMap((h) => {
    const t0 = instant(cible(h, "startid"));
    const t1 = instant(cible(h, "endid"));
    if (t0 === null || t1 === null || t1 <= t0) return [];
    const depart = niveauA(t0);
    const signe = h.getAttribute("form") === "dim" ? -1 : 1;
    const suivante = nuances.find((d) => d.t >= t1 - 1 && d.t <= t1 + 2000);
    const arrivee = suivante?.niveau ?? Math.max(20, Math.min(120, depart + signe * AMPLITUDE_SOUFFLET));
    return [{ t0, t1, depart, arrivee }];
  });

  // Articulations : <artic> dans une note ou un accord, <fermata> rattaché par startid.
  const effets = new Map<string, { duree: number; bonus: number }>();
  const appliquer = (el: Element | null, valeurs: string[]) => {
    if (!el) return;
    // Un accord transmet l'effet à chacune de ses notes.
    const cibles = el.localName === "chord" ? Array.from(el.getElementsByTagNameNS("*", "note")) : [el];
    for (const c of cibles) {
      const id = c.getAttribute("xml:id");
      if (!id) continue;
      const e = { ...(effets.get(id) ?? { duree: 1, bonus: 0 }) };
      for (const v of valeurs) {
        const effet = EFFETS[v];
        if (effet) {
          e.duree *= effet.duree;
          e.bonus += effet.bonus;
        }
      }
      effets.set(id, e);
    }
  };
  for (const a of tous("artic")) appliquer(a.parentElement, (a.getAttribute("artic") ?? "").split(/\s+/));
  const parId = new Map(Array.from(doc.getElementsByTagNameNS("*", "*")).map((el) => [el.getAttribute("xml:id"), el]));
  for (const f of tous("fermata")) appliquer(parId.get(cible(f, "startid")) ?? null, ["fermata"]);

  return {
    articulation: (id) => effets.get(id) ?? { duree: 1, bonus: 0 },
    prolongations,
    finsDeProlongation,
    velocite(ms) {
      const s = soufflets.find((h) => ms >= h.t0 && ms <= h.t1);
      if (s) return Math.round(s.depart + ((ms - s.t0) / (s.t1 - s.t0)) * (s.arrivee - s.depart));
      // Après un soufflet sans nuance d'arrivée, on garde le niveau atteint.
      const fini = soufflets.filter((h) => h.t1 < ms).pop();
      const derniere = nuances.filter((d) => d.t <= ms + 1).pop();
      if (fini && (!derniere || derniere.t < fini.t1)) return fini.arrivee;
      return niveauA(ms);
    },
  };
}
