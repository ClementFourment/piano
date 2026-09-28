// Côté page : pilote la transcription qui tourne dans un Web Worker.

import type { NoteEntendue } from "./partition";
import type { Demande, Reponse } from "./transcripteur.worker";

export class TranscripteurDistant {
  private worker = new Worker(new URL("./transcripteur.worker.ts", import.meta.url), { type: "module" });
  private enAttente = false;

  /** Appelé à chaque nouvelle liste de notes (provisoire, puis finale). */
  onNotes: (notes: NoteEntendue[], final: boolean, ms: number) => void = () => {};
  onErreur: (message: string) => void = () => {};

  /** Charge le modèle ; renvoie le moteur de calcul utilisé. */
  demarrer(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<Reponse>) => {
        const r = e.data;
        if (r.type === "pret") resolve(r.moteur);
        else if (r.type === "erreur") {
          this.enAttente = false;
          reject(new Error(r.message)); // sans effet si déjà démarré
          this.onErreur(r.message);
        } else if (r.type === "notes") {
          this.enAttente = false;
          this.onNotes(r.notes, r.final, r.ms);
        }
      };
      this.worker.onerror = (e) => {
        const message = e.message || "Le calcul de la transcription n'a pas pu démarrer.";
        reject(new Error(message));
        this.onErreur(message);
      };
      this.envoyer({ type: "demarrer" });
    });
  }

  pousser(bloc: Float32Array) {
    this.envoyer({ type: "audio", bloc }, [bloc.buffer]);
  }

  /** Demande une analyse, sauf si la précédente n'est pas finie (on ne s'accumule pas de retard). */
  analyser() {
    if (this.enAttente) return;
    this.enAttente = true;
    this.envoyer({ type: "analyser", final: false });
    // Si rien de nouveau n'était analysable, le worker ne répond pas : on libère après un délai.
    setTimeout(() => (this.enAttente = false), 3000);
  }

  finir() {
    this.envoyer({ type: "analyser", final: true });
  }

  fermer() {
    this.worker.terminate();
  }

  private envoyer(d: Demande, transfert: Transferable[] = []) {
    this.worker.postMessage(d, transfert);
  }
}
