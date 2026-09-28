// Transcription en continu avec Basic Pitch (Spotify), dans le navigateur.
// Le modèle travaille sur des fenêtres de 2 s : on l'applique régulièrement au son
// nouvellement capturé (avec un peu de contexte avant), et on ne garde pour de bon
// que ce qui n'est plus tout au bout — la fin sera refaite avec plus de contexte.

import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import { BasicPitch, noteFramesToTime, outputToNotesPoly } from "@spotify/basic-pitch";
import type { NoteEntendue } from "./partition";
import { TAUX } from "./capture";

const HOP = 256; // échantillons par trame du modèle
const TRAMES_PAR_S = TAUX / HOP;
const CONTEXTE = Math.round(0.5 * TRAMES_PAR_S);
const MARGE = Math.round(0.35 * TRAMES_PAR_S);
/** On n'analyse pas moins d'une seconde de son nouveau à la fois (sauf à la fin). */
const MINIMUM = TAUX;

// Constantes de Basic Pitch (fenêtres de 2 s qui se chevauchent de 30 trames).
const N_ECHANTILLONS_FENETRE = TAUX * 2 - HOP;
const CHEVAUCHEMENT = 30 * HOP;
const PAS_FENETRE = N_ECHANTILLONS_FENETRE - CHEVAUCHEMENT;

/**
 * Basic Pitch découpe le son avec tf.signal.frame(…, padEnd = true), qui complète la dernière
 * fenêtre avec un tf.fill sans type : le moteur WebAssembly (tfjs 3.21) ne le supporte pas.
 * On complète donc le son nous-mêmes avec des zéros, pour obtenir exactement les mêmes fenêtres.
 */
class BasicPitchWasm extends BasicPitch {
  async prepareData(audio: Float32Array): Promise<[tf.Tensor3D, number]> {
    const avecDebut = CHEVAUCHEMENT / 2 + audio.length;
    const nbFenetres = Math.max(1, Math.ceil(avecDebut / PAS_FENETRE));
    const longueur = (nbFenetres - 1) * PAS_FENETRE + N_ECHANTILLONS_FENETRE;
    const signal = new Float32Array(longueur);
    signal.set(audio, CHEVAUCHEMENT / 2);
    const fenetres = tf.tidy(() =>
      tf.expandDims(tf.signal.frame(tf.tensor1d(signal), N_ECHANTILLONS_FENETRE, PAS_FENETRE, false), -1),
    ) as tf.Tensor3D;
    return [fenetres, audio.length];
  }
}

let modele: Promise<BasicPitch> | null = null;

/** Moteur de calcul utilisé (pour le diagnostic). */
export const moteur = () => tf.getBackend();

/** Charge le modèle (≈ 900 Ko, servi par le site) une seule fois. */
export function chargerModele(): Promise<BasicPitch> {
  modele ??= (async () => {
    // WebAssembly : rapide sur n'importe quel processeur, sans dépendre de la carte graphique
    // (souvent émulée, donc très lente, avec WebGL). Fichiers .wasm servis par le site.
    setWasmPaths("/tfjs-wasm/");
    if (!(await tf.setBackend("wasm"))) await tf.setBackend("cpu");
    await tf.ready();
    // Modèle entièrement chargé avant toute analyse : ses poids ne doivent pas être
    // créés à l'intérieur d'une analyse (ils seraient libérés avec le reste, voir analyser()).
    const graphe = await tf.loadGraphModel("/basic-pitch/model.json");
    return new BasicPitchWasm(Promise.resolve(graphe));
  })();
  modele.catch(() => (modele = null));
  return modele;
}

export class Transcripteur {
  private audio = new Float32Array(TAUX * 60);
  private longueur = 0;
  private trames: number[][] = [];
  private attaques: number[][] = [];
  /** Nombre de trames définitives. */
  private confirmees = 0;
  private enCours = false;

  constructor(private bp: BasicPitch) {}

  pousser(bloc: Float32Array) {
    if (this.longueur + bloc.length > this.audio.length) {
      const plus = new Float32Array(Math.max(this.audio.length * 2, this.longueur + bloc.length));
      plus.set(this.audio.subarray(0, this.longueur));
      this.audio = plus;
    }
    this.audio.set(bloc, this.longueur);
    this.longueur += bloc.length;
  }

  /** Durée capturée, en secondes. */
  get duree() {
    return this.longueur / TAUX;
  }

  /**
   * Analyse le son en attente. Renvoie false s'il n'y avait pas assez de son nouveau
   * (ou si une analyse est déjà en cours). `final` : tout analyser, jusqu'au bout.
   */
  async analyser(final = false): Promise<boolean> {
    if (this.enCours) return false;
    const nouveau = this.longueur - this.confirmees * HOP;
    if (nouveau <= 0 || (!final && nouveau < MINIMUM)) return false;
    this.enCours = true;
    try {
      const debut = Math.max(0, this.confirmees - CONTEXTE);
      const segment = this.audio.slice(debut * HOP, this.longueur);
      const trames: number[][] = [];
      const attaques: number[][] = [];
      // La bibliothèque ne libère pas ses tenseurs : on les ramasse nous-mêmes à chaque analyse.
      tf.engine().startScope();
      try {
        await this.bp.evaluateModel(
          segment,
          (f, o) => {
            trames.push(...f);
            attaques.push(...o);
          },
          () => {},
        );
      } finally {
        tf.engine().endScope();
      }
      const fin = debut + trames.length - (final ? 0 : MARGE);
      for (let g = this.confirmees; g < fin; g++) {
        this.trames[g] = trames[g - debut];
        this.attaques[g] = attaques[g - debut];
      }
      this.confirmees = Math.max(this.confirmees, fin);
      return true;
    } finally {
      this.enCours = false;
    }
  }

  /** Notes figées : elles ne changeront plus (le son correspondant est loin derrière). */
  private figees: NoteEntendue[] = [];
  private limiteFigee = 0; // en secondes

  /**
   * Notes entendues jusqu'ici. Pour que le coût ne grandisse pas avec la durée,
   * seules les ~12 dernières secondes sont recalculées ; le reste est figé.
   */
  notes(reglages: ReglagesDetection = REGLAGES_DETECTION): NoteEntendue[] {
    if (!this.trames.length) return [];
    // Un peu de contexte avant la limite, pour voir les notes commencées juste avant.
    const debut = Math.max(0, Math.floor((this.limiteFigee - 3) * TRAMES_PAR_S));
    const recentes = detecter(this.trames.slice(debut), this.attaques.slice(debut), debut / TRAMES_PAR_S, reglages).filter(
      (n) => n.debut >= this.limiteFigee,
    );
    const toutes = [...this.figees, ...recentes];
    const maintenant = this.confirmees / TRAMES_PAR_S;
    if (maintenant - this.limiteFigee > 12) {
      const limite = maintenant - 6;
      this.figees.push(...recentes.filter((n) => n.debut < limite));
      this.limiteFigee = limite;
    }
    return toutes;
  }

  /** Pour le banc d'essai : trames brutes (réglages de détection à comparer). */
  brut() {
    return { trames: this.trames, attaques: this.attaques };
  }
}

export interface ReglagesDetection {
  seuilAttaque: number;
  seuilTrame: number;
  /** Durée minimale d'une note, en trames (~11,6 ms). */
  dureeMin: number;
}

// Réglages choisis avec le banc d'essai (src/micro/banc-essai.ts, rechercheReglages).
export const REGLAGES_DETECTION: ReglagesDetection = { seuilAttaque: 0.7, seuilTrame: 0.4, dureeMin: 8 };

/** Post-traitement de Basic Pitch : trames → notes (instants décalés de `decalage` s). */
export function detecter(trames: number[][], attaques: number[][], decalage: number, r: ReglagesDetection): NoteEntendue[] {
  // Le post-traitement modifie ses entrées : on lui passe des copies.
  const brutes = outputToNotesPoly(
    trames.map((l) => l.slice()),
    attaques.map((l) => l.slice()),
    r.seuilAttaque,
    r.seuilTrame,
    r.dureeMin,
    true,
    null,
    null,
    true,
    11,
  );
  return noteFramesToTime(brutes).map((n) => ({
    debut: n.startTimeSeconds + decalage,
    duree: n.durationSeconds,
    midi: n.pitchMidi,
    amplitude: n.amplitude,
  }));
}
