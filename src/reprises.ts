// Ordre de lecture des mesures quand il y a des reprises et des cases (1re / 2e fois).
// La structure est lue dans le MEI chargé dans Verovio : ça marche aussi pour les fichiers importés.

import type { VerovioToolkit } from "verovio/esm";

export interface MesureLue {
  id: string;
  /** Début de reprise (‖:). */
  debut: boolean;
  /** Fin de reprise (:‖). */
  fin: boolean;
  /** Numéros de passage où la mesure est jouée (case), ou null si toujours. */
  cases: number[] | null;
}

export function lireStructure(tk: VerovioToolkit): MesureLue[] {
  const doc = new DOMParser().parseFromString(tk.getMEI({}), "application/xml");
  const mesures = Array.from(doc.getElementsByTagNameNS("*", "measure"));
  const res: MesureLue[] = [];
  mesures.forEach((m, i) => {
    const gauche = m.getAttribute("left");
    const droite = m.getAttribute("right");
    const droitePrec = mesures[i - 1]?.getAttribute("right");
    const ending = m.parentElement?.localName === "ending" ? m.parentElement : null;
    // n="1", "2", "1, 2" ou "1-2"… on garde les numéros cités.
    const cases = ending ? (ending.getAttribute("n") ?? "").match(/\d+/g)?.map(Number) ?? null : null;
    res.push({
      id: m.getAttribute("xml:id") ?? "",
      debut: gauche === "rptstart" || gauche === "rptboth" || droitePrec === "rptboth",
      fin: droite === "rptend" || droite === "rptboth",
      cases,
    });
  });
  return res;
}

/** Indices des mesures dans l'ordre où on les joue. */
export function deplier(mesures: MesureLue[]): number[] {
  const ordre: number[] = [];
  let debutReprise = 0;
  let passage = 1;
  let i = 0;
  let precedenteDansCase = false;
  while (i < mesures.length && ordre.length < 10_000) {
    const m = mesures[i];
    // Un nouveau début de reprise ouvre un nouveau bloc.
    if (m.debut && i !== debutReprise) {
      debutReprise = i;
      passage = 1;
    }
    // Sortie des cases après le second passage : la suite est jouée une fois, normalement.
    if (precedenteDansCase && !m.cases && passage > 1) {
      passage = 1;
      debutReprise = i;
    }
    precedenteDansCase = m.cases !== null;
    if (m.cases && !m.cases.includes(passage)) {
      i++;
      continue;
    }
    ordre.push(i);
    if (m.fin && passage === 1) {
      passage = 2;
      i = debutReprise;
      precedenteDansCase = false; // on revient en arrière : on n'est plus « juste après une case »
      continue;
    }
    if (m.fin) {
      // Reprise terminée : une éventuelle reprise suivante repart d'ici.
      passage = 1;
      debutReprise = i + 1;
    }
    i++;
  }
  return ordre;
}
