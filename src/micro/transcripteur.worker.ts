// Fil de calcul séparé : la transcription ne bloque pas la page (métronome, affichage).

import { chargerModele, moteur, Transcripteur } from "./transcription";

export type Demande =
  | { type: "demarrer" }
  | { type: "audio"; bloc: Float32Array }
  | { type: "analyser"; final: boolean };

export type Reponse =
  | { type: "pret"; moteur: string }
  | { type: "notes"; notes: import("./partition").NoteEntendue[]; duree: number; final: boolean; ms: number }
  | { type: "erreur"; message: string };

let tr: Transcripteur | null = null;
const envoyer = (r: Reponse) => (self as unknown as Worker).postMessage(r);

self.onmessage = async (e: MessageEvent<Demande>) => {
  const d = e.data;
  try {
    if (d.type === "demarrer") {
      tr = new Transcripteur(await chargerModele());
      envoyer({ type: "pret", moteur: moteur() });
    } else if (d.type === "audio") {
      tr?.pousser(d.bloc);
    } else if (d.type === "analyser" && tr) {
      const t0 = performance.now();
      const nouveau = await tr.analyser(d.final);
      if (nouveau || d.final) envoyer({ type: "notes", notes: tr.notes(), duree: tr.duree, final: d.final, ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    envoyer({ type: "erreur", message: (err as Error).message });
  }
};
