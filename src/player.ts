// Lecture audio avec un vrai piano échantillonné (smplr), pilotée par la « timemap » de Verovio :
// les instants et hauteurs viennent du moteur de gravure, donc de ce qui est affiché.

import { SplendidGrandPiano } from "smplr";
import type { VerovioToolkit } from "verovio/esm";
import { lireExpression } from "./expression";

type Piano = ReturnType<typeof SplendidGrandPiano>;

let audio: { ctx: AudioContext; piano: Piano } | null = null;

/** Charge les échantillons (quelques Mo, une seule fois). */
async function chargerPiano() {
  if (!audio) {
    const ctx = new AudioContext();
    audio = { ctx, piano: SplendidGrandPiano(ctx, { volume: 100 }) };
  }
  await audio.piano.ready;
  await audio.ctx.resume();
  return audio;
}

interface Evenement {
  /** Instant en secondes depuis le début. */
  t: number;
  on: string[];
  off: string[];
}

export interface Lecture {
  arreter(): void;
}

interface Options {
  /** Appelé à chaque note surlignée (pour faire défiler la page). */
  onNote?: (el: Element) => void;
  onFin?: () => void;
}

/**
 * Joue le document actuellement chargé dans Verovio et surligne les notes
 * dans `conteneur` (les éléments SVG portent les mêmes identifiants que le MEI).
 */
export async function jouer(tk: VerovioToolkit, conteneur: HTMLElement, opts: Options = {}): Promise<Lecture> {
  const { ctx, piano } = await chargerPiano();

  const timemap = tk.renderToTimemap();
  const evenements: Evenement[] = timemap.map((e) => ({ t: e.tstamp / 1000, on: e.on ?? [], off: e.off ?? [] }));
  const fin = evenements.length ? evenements[evenements.length - 1].t : 0;

  const expr = lireExpression(tk);
  const t0 = ctx.currentTime + 0.15;
  for (const e of evenements) {
    for (const id of e.on) {
      // Fin d'une prolongation : la note sonne déjà, on ne la rejoue pas.
      if (expr.finsDeProlongation.has(id)) continue;
      const { pitch, duration, time } = tk.getMIDIValuesForElement(id);
      if (!(pitch > 0 && duration > 0)) continue;
      // Début d'une prolongation : on tient la note jusqu'au bout de la chaîne.
      let total = duration;
      for (let suiv = expr.prolongations.get(id), n = 0; suiv && n < 64; suiv = expr.prolongations.get(suiv), n++) {
        total += tk.getMIDIValuesForElement(suiv).duration;
      }
      const artic = expr.articulation(id);
      const velocity = Math.max(1, Math.min(127, expr.velocite(time) + artic.bonus));
      piano.start({ note: pitch, time: t0 + e.t, duration: (total * artic.duree) / 1000, velocity });
    }
  }

  const trouver = (id: string) => conteneur.querySelector(`[id="${CSS.escape(id)}"]`);
  const allumees = new Set<Element>();
  let prochain = 0;
  let raf = 0;
  let finie = false;

  const eteindreTout = () => {
    allumees.forEach((el) => el.classList.remove("en-lecture"));
    allumees.clear();
  };

  const tick = () => {
    const ecoule = ctx.currentTime - t0;
    while (prochain < evenements.length && evenements[prochain].t <= ecoule) {
      const e = evenements[prochain++];
      for (const id of e.off) {
        const el = trouver(id);
        if (el) {
          el.classList.remove("en-lecture");
          allumees.delete(el);
        }
      }
      let premiere: Element | null = null;
      for (const id of e.on) {
        const el = trouver(id);
        if (el) {
          el.classList.add("en-lecture");
          allumees.add(el);
          premiere ??= el;
        }
      }
      if (premiere) opts.onNote?.(premiere);
    }
    raf = requestAnimationFrame(tick);
  };

  // La fin est détectée par un minuteur : requestAnimationFrame est suspendu
  // quand l'onglet passe en arrière-plan, alors que le son, lui, continue.
  const minuteur = setTimeout(() => terminer(), (t0 - ctx.currentTime + fin + 0.3) * 1000);

  function terminer() {
    if (finie) return;
    finie = true;
    clearTimeout(minuteur);
    cancelAnimationFrame(raf);
    piano.stop();
    eteindreTout();
    opts.onFin?.();
  }

  raf = requestAnimationFrame(tick);
  return { arreter: terminer };
}
