// Banc d'essai de la transcription (développement uniquement, jamais importé par l'appli) :
// synthétise une partition connue avec un son proche du piano (le rendu hors temps réel
// de smplr reste silencieux), passe le son dans la même
// chaîne que le micro (par blocs, comme en temps réel), et compare avec l'original.
//
// Dans la console du serveur de développement :
//   const { essai } = await import("/src/micro/banc-essai.ts"); await essai();

import { noteBeats, type KeySignature, type Measure } from "../../shared/score";
import { TAUX } from "./capture";
import { versMesures } from "./partition";
import type { NoteEntendue } from "./partition";
import { TranscripteurDistant } from "./transcripteur";
import { chargerModele, detecter, Transcripteur } from "./transcription";

interface NoteRef {
  temps: number; // en noires depuis le premier temps
  duree: number;
  midi: number;
}

/** Petite pièce : mélodie en noires/croches, basse en blanches, un accord. */
export const PIECE: NoteRef[] = [
  ...[[0, 1, 64], [1, 1, 62], [2, 0.5, 60], [2.5, 0.5, 62], [3, 1, 64],
    [4, 1, 64], [5, 1, 64], [6, 2, 67],
    [8, 1, 69], [9, 0.5, 67], [9.5, 0.5, 65], [10, 1, 64], [11, 1, 62],
    [12, 4, 60], [12, 4, 64], [12, 4, 67]].map(([temps, duree, midi]) => ({ temps, duree, midi })),
  ...[[0, 2, 48], [2, 2, 55], [4, 2, 53], [6, 2, 52], [8, 2, 50], [10, 2, 55], [12, 4, 48]].map(([temps, duree, midi]) => ({ temps, duree, midi })),
];

export async function essai(tempo = 90, armure: KeySignature = "C") {
  const noire = 60 / tempo;
  const decompte = 4 * noire;
  const t0 = performance.now();

  const audio = await synthetiser(PIECE.map((n) => ({ debut: decompte + n.temps * noire, duree: n.duree * noire * 0.95, midi: n.midi })), decompte + 17 * noire);
  const tRendu = performance.now();

  // Même chemin que le micro : Web Worker, blocs de 2048 échantillons, analyses successives.
  const tr = new TranscripteurDistant();
  const moteur = await tr.demarrer();
  const tModele = performance.now();
  const temps: number[] = [];
  let resoudre!: (n: NoteEntendue[]) => void;
  let echouer!: (e: Error) => void;
  const finies = new Promise<NoteEntendue[]>((r, j) => ((resoudre = r), (echouer = j)));
  tr.onErreur = (m) => echouer(new Error(m));
  let enCours: (() => void) | null = null;
  tr.onNotes = (n, final, ms) => {
    temps.push(ms);
    if (final) resoudre(n);
    enCours?.();
  };
  // Une analyse par seconde de son, en attendant chaque réponse (comme en direct, mais sans attendre le son).
  for (let i = 0; i < audio.length; i += 2048) {
    tr.pousser(audio.slice(i, i + 2048));
    if ((i / 2048) % 11 === 10) {
      await new Promise<void>((r) => {
        enCours = r;
        tr.analyser();
        setTimeout(r, 5000);
      });
      enCours = null;
    }
  }
  tr.finir();
  const notes = await finies;
  tr.fermer();
  const tAnalyse = performance.now();

  const mesures = versMesures(notes, { tempo, timeSig: { num: 4, den: 4 }, armure, grille: 0.25, premierTemps: decompte });

  const { trouves, attendus, enTrop, manquees } = comparer(PIECE, mesures);
  return {
    moteur,
    rendu_ms: Math.round(tRendu - t0),
    chargement_modele_ms: Math.round(tModele - tRendu),
    analyse_ms: Math.round(tAnalyse - tModele),
    ms_par_analyse: temps,
    duree_audio_s: +(audio.length / TAUX).toFixed(1),
    notes_detectees: notes.length,
    trouvees: `${trouves}/${attendus}`,
    manquees,
    en_trop: enTrop,
  };
}

/**
 * Son de test « façon piano » : fondamentale + harmoniques légèrement inharmoniques,
 * attaque brève, extinction exponentielle, arrêt au relâchement. Rendu hors temps réel.
 */
async function synthetiser(notes: { debut: number; duree: number; midi: number }[], total: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(total * TAUX), TAUX);
  const sortie = ctx.createGain();
  sortie.gain.value = 0.25;
  sortie.connect(ctx.destination);
  for (const n of notes) {
    const f0 = 440 * 2 ** ((n.midi - 69) / 12);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, n.debut);
    env.gain.linearRampToValueAtTime(1, n.debut + 0.005);
    env.gain.setTargetAtTime(0.35, n.debut + 0.005, 0.25);
    env.gain.setTargetAtTime(0, n.debut + n.duree, 0.06);
    env.connect(sortie);
    for (let h = 1; h <= 6; h++) {
      const f = f0 * h * Math.sqrt(1 + 0.0004 * h * h);
      if (f > TAUX / 2 - 500) break;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = f;
      g.gain.value = 1 / h ** 1.3;
      osc.connect(g).connect(env);
      osc.start(n.debut);
      osc.stop(n.debut + n.duree + 0.5);
    }
  }
  return (await ctx.startRendering()).getChannelData(0);
}

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ALT: Record<string, number> = { sharp: 1, flat: -1, natural: 0 };
const ARMURE_ALT: Record<string, Record<string, number>> = { C: {}, G: { F: 1 } };

/** Compare les attaques (temps, hauteur MIDI) de la partition obtenue avec celles attendues. */
export function comparer(piece: NoteRef[], mesures: Measure[], armure = "C") {
  const cle = (t: number, m: number) => `${t}:${m}`;
  const attendus = new Set(piece.map((n) => cle(n.temps, n.midi)));
  const obtenus = new Set<string>();
  mesures.forEach((m, mi) => {
    for (const portee of [m.treble, m.bass]) {
      let pos = mi * 4;
      let lie = false;
      const courantes = new Map<string, number>();
      for (const n of portee) {
        if (!n.rest && !lie) {
          for (const p of n.pitches) {
            const k = p.letter + p.octave;
            if (p.accidental) courantes.set(k, ALT[p.accidental]);
            const alt = courantes.get(k) ?? ARMURE_ALT[armure]?.[p.letter] ?? 0;
            obtenus.add(cle(pos, (p.octave + 1) * 12 + NOTE[p.letter] + alt));
          }
        }
        lie = !!n.tie;
        pos += noteBeats(n);
      }
    }
  });
  const trouves = [...attendus].filter((x) => obtenus.has(x)).length;
  const enTrop = [...obtenus].filter((x) => !attendus.has(x));
  return { trouves, attendus: attendus.size, enTrop, manquees: [...attendus].filter((x) => !obtenus.has(x)) };
}

/** Seconde pièce, plus exigeante : Sol majeur (Fa♯), doubles croches, notes répétées. */
export const PIECE2: NoteRef[] = [
  ...[[0, 0.25, 67], [0.25, 0.25, 69], [0.5, 0.25, 71], [0.75, 0.25, 72], [1, 1, 74], [2, 0.5, 74], [2.5, 0.5, 74], [3, 1, 71],
    [4, 0.5, 72], [4.5, 0.5, 71], [5, 0.5, 69], [5.5, 0.5, 66], [6, 2, 67],
    [8, 1.5, 71], [9.5, 0.5, 69], [10, 1, 66], [11, 1, 62], [12, 4, 67], [12, 4, 71]].map(([temps, duree, midi]) => ({ temps, duree, midi })),
  ...[[0, 1, 43], [1, 1, 50], [2, 1, 55], [3, 1, 50], [4, 2, 48], [6, 2, 43], [8, 2, 50], [10, 2, 54], [12, 4, 43], [12, 4, 50]].map(([temps, duree, midi]) => ({ temps, duree, midi })),
];

/**
 * Cherche les meilleurs réglages de détection et de mise en partition sur les deux pièces :
 * chaque pièce n'est analysée qu'une fois, puis on rejoue seulement le post-traitement.
 */
export async function rechercheReglages() {
  const bp = await chargerModele();
  const pieces = [
    { piece: PIECE, tempo: 90, armure: "C" as KeySignature },
    { piece: PIECE2, tempo: 110, armure: "G" as KeySignature },
  ];
  const analyses = [];
  for (const p of pieces) {
    const noire = 60 / p.tempo;
    const decompte = 4 * noire;
    const audio = await synthetiser(p.piece.map((n) => ({ debut: decompte + n.temps * noire, duree: n.duree * noire * 0.95, midi: n.midi })), decompte + 17 * noire);
    const tr = new Transcripteur(bp);
    tr.pousser(audio);
    await tr.analyser(true);
    analyses.push({ ...p, decompte, brut: tr.brut() });
  }
  const resultats = [];
  for (const seuilAttaque of [0.5, 0.6, 0.7, 0.8, 0.9])
    for (const seuilTrame of [0.3, 0.4])
      for (const amplitudeMin of [0.3, 0.4, 0.5, 0.6])
        for (const rapportHarmonique of [0.7, 0.8, 0.9, 1.0]) {
          let trouves = 0, attendus = 0, enTrop = 0;
          for (const a of analyses) {
            const notes = detecter(a.brut.trames, a.brut.attaques, 0, { seuilAttaque, seuilTrame, dureeMin: 8 });
            const mesures = versMesures(notes, { tempo: a.tempo, timeSig: { num: 4, den: 4 }, armure: a.armure, grille: 0.25, premierTemps: a.decompte, amplitudeMin, rapportHarmonique });
            const c = comparer(a.piece, mesures, a.armure);
            trouves += c.trouves;
            attendus += c.attendus;
            enTrop += c.enTrop.length;
          }
          const rappel = trouves / attendus;
          const precision = trouves / Math.max(1, trouves + enTrop);
          resultats.push({ seuilAttaque, seuilTrame, amplitudeMin, rapportHarmonique, trouves, attendus, enTrop, f1: +((2 * rappel * precision) / (rappel + precision || 1)).toFixed(3) });
        }
  return resultats.sort((a, b) => b.f1 - a.f1);
}
