// Chargement de Verovio (moteur de gravure, ~7 Mo de WebAssembly) et rendu en SVG.

import type { VerovioToolkit } from "verovio/esm";
import { MARQUE_DESSIN_MAIN } from "./mei";

let toolkit: Promise<VerovioToolkit> | null = null;

/** Charge Verovio une seule fois, à la première partition affichée. */
export function getToolkit(): Promise<VerovioToolkit> {
  toolkit ??= (async () => {
    const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
      import("verovio/wasm"),
      import("verovio/esm"),
    ]);
    return new VerovioToolkit(await createVerovioModule());
  })();
  toolkit.catch(() => (toolkit = null)); // permet de réessayer après une erreur réseau
  return toolkit;
}

/** Format d'une page : A4 pour l'impression, plus étroit sur petit écran (moins de mesures par ligne). */
export type Format = "a4" | "etroit";

const FORMATS: Record<Format, Record<string, unknown>> = {
  a4: { pageWidth: 2100, pageHeight: 2970, scale: 100, pageMarginTop: 130, pageMarginBottom: 110, pageMarginLeft: 150, pageMarginRight: 150 },
  etroit: { pageWidth: 1300, pageHeight: 1840, scale: 100, pageMarginTop: 90, pageMarginBottom: 80, pageMarginLeft: 90, pageMarginRight: 90 },
};

/** Charge un document MEI (ou MusicXML) et renvoie une chaîne SVG par page. */
export function rendre(tk: VerovioToolkit, data: string, format: Format): string[] {
  tk.setOptions({
    ...FORMATS[format],
    // Un peu d'air entre le chiffrage (ou l'armure) et la première note.
    rightMarginMeterSig: 2,
    rightMarginKeySig: 1.5,
    adjustPageHeight: format === "etroit",
    breaks: "auto",
    header: "auto",
    footer: "none",
    svgViewBox: true,
    svgRemoveXlink: true,
    justifyVertically: false,
  });
  if (!tk.loadData(data)) throw new Error("Partition illisible.");
  const pages: string[] = [];
  for (let p = 1; p <= tk.getPageCount(); p++) pages.push(nettoyerSvg(tk.renderToSVG(p)));
  return pages;
}

/**
 * Retire de l'SVG tout ce qui pourrait exécuter du code (un fichier importé
 * est rendu tel quel, et une partition partagée est vue par d'autres personnes).
 */
function nettoyerSvg(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  doc.querySelectorAll("script, foreignObject, iframe, object, embed").forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const nom = attr.name.toLowerCase();
      if (nom.startsWith("on")) el.removeAttribute(attr.name);
      else if ((nom === "href" || nom.endsWith(":href")) && !attr.value.startsWith("#")) el.removeAttribute(attr.name);
    }
  });
  dessinerMains(doc);
  return new XMLSerializer().serializeToString(doc.documentElement);
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Main droite vue du dessus (dos de la main, pouce à gauche), dans une boîte de 100 × 120 :
 * contour des doigts et du pouce, ouvert au poignet, avec les ongles et les plis des doigts.
 */
const CONTOUR_MAIN =
  "M 40 118 C 39 108, 37 100, 33 93 C 26 86, 16 76, 11 66 C 8 60, 13 54, 19 58 C 25 62, 30 69, 35 72 " +
  "C 34 60, 31 42, 30 30 C 29 22, 39 20, 40 28 C 41 40, 42 50, 43 58 C 44 44, 44 26, 45 16 " +
  "C 46 8, 56 8, 56 16 C 56 28, 55 44, 55 57 C 57 46, 59 32, 61 23 C 63 16, 71 18, 70 26 " +
  "C 69 38, 67 50, 66 60 C 69 52, 72 44, 75 38 C 78 32, 85 34, 84 41 C 82 52, 80 64, 80 74 " +
  "C 80 88, 78 100, 74 118";
const DETAILS_MAIN = [
  // Ongles
  "M 32 31 C 33 26, 38 25, 38.5 30",
  "M 47 17 C 48 12, 54 12, 54.5 17",
  "M 62.5 25 C 64 20, 69 20, 68.5 26",
  "M 76.5 40 C 78 36, 83 36, 82.5 41",
  "M 13.5 64 C 13 60, 17 57, 20 60",
  // Plis des articulations
  "M 33 50 C 35 49, 38 49, 40 50",
  "M 46 44 C 48 43, 52 43, 54 44",
  "M 60 46 C 62 45, 65 45, 67 46",
  "M 73 54 C 75 53, 78 53, 80 54",
  "M 20 74 C 22 72, 25 71, 27 72",
].join(" ");

function svgMain(droite: boolean, x: number, y: number, largeur: number, hauteur: number): string {
  const miroir = droite ? "" : ' transform="translate(100 0) scale(-1 1)"';
  return (
    `<svg xmlns="${SVG_NS}" x="${x}" y="${y}" width="${largeur}" height="${hauteur}" viewBox="0 0 100 120" class="dessin-main">` +
    `<g${miroir} fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${CONTOUR_MAIN} Z" fill="#fff" stroke="none"/>` +
    `<path d="${CONTOUR_MAIN}" stroke-width="4.5"/>` +
    `<path d="${DETAILS_MAIN}" stroke-width="2.4"/>` +
    `</g></svg>`
  );
}

/** Remplace les noms de mains marqués (« M.D. », « M.G. ») par un dessin de main, à la même place. */
function dessinerMains(doc: Document) {
  doc.querySelectorAll(".label text, .labelAbbr text").forEach((texte) => {
    const contenu = texte.textContent ?? "";
    if (!contenu.includes(MARQUE_DESSIN_MAIN)) return;
    const taille = parseFloat(texte.querySelector("[font-size]:not([font-size='0px'])")?.getAttribute("font-size") ?? "") || 400;
    const fin = parseFloat(texte.getAttribute("x") ?? "0");
    const ligne = parseFloat(texte.getAttribute("y") ?? "0");
    // À peu près la hauteur de la portée, centré sur le texte.
    const hauteur = taille * 2.4;
    const largeur = (hauteur * 100) / 120;
    const centre = ligne - taille * 0.2;
    const fragment = new DOMParser().parseFromString(
      svgMain(contenu.includes("M.D."), fin - largeur, centre - hauteur / 2, largeur, hauteur),
      "image/svg+xml",
    );
    texte.replaceWith(doc.importNode(fragment.documentElement, true));
  });
}
