// Import et export de fichiers.

import type { ScoreKind } from "../shared/api";
import { LIMITES, lireScore } from "../shared/score";
import { getToolkit } from "./verovio";

export interface Importe {
  kind: ScoreKind;
  data: string;
  title: string;
  composer: string;
}

export const EXTENSIONS_IMPORT = ".json,.musicxml,.xml,.mxl,.mei";

/**
 * Lit un fichier choisi par l'utilisateur :
 * - .json : partition du prototype ou de cette appli → partition éditable ;
 * - .musicxml / .xml / .mxl / .mei : converti en MEI par Verovio → partition en lecture seule.
 */
export async function importerFichier(file: File): Promise<Importe> {
  const nom = file.name.replace(/\.[^.]+$/, "");
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "json") {
    let brut: unknown;
    try {
      brut = JSON.parse(await file.text());
    } catch {
      throw new Error("Ce fichier JSON est illisible.");
    }
    const score = lireScore(brut);
    if (typeof score === "string") throw new Error(score);
    if (score.title === "Sans titre" && nom) score.title = nom;
    return { kind: "score", data: JSON.stringify(score), title: score.title, composer: score.composer };
  }

  const tk = await getToolkit();
  tk.setOptions({ breaks: "auto" });
  const ok = ext === "mxl" ? tk.loadZipDataBuffer(await file.arrayBuffer()) : tk.loadData(await file.text());
  if (!ok) throw new Error("Format non reconnu. Formats acceptés : MusicXML (.musicxml, .xml, .mxl), MEI, ou .json.");
  const mei = tk.getMEI({ removeIds: false });
  if (new TextEncoder().encode(mei).length > LIMITES.donnees) throw new Error("Partition trop grande pour être enregistrée.");

  const doc = new DOMParser().parseFromString(mei, "application/xml");
  const texte = (sel: string) => doc.querySelector(sel)?.textContent?.trim() ?? "";
  return {
    kind: "mei",
    data: mei,
    title: (texte("titleStmt > title") || nom || "Sans titre").slice(0, LIMITES.titre),
    composer: texte('titleStmt persName[role="composer"], titleStmt composer').slice(0, LIMITES.titre),
  };
}

export function telecharger(contenu: BlobPart, type: string, nomFichier: string) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nomFichier;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function nomDeFichier(titre: string): string {
  return titre.trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").slice(0, 80) || "partition";
}

/** Verovio renvoie le MIDI en base64. */
export function base64EnOctets(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
