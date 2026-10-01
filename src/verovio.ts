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
 * Main droite vue du dessus (dos de la main, pouce à gauche), dans une boîte de 100 × 124 :
 * doigts effilés en éventail, pouce, paume ouverte au poignet ; ongles et plis des doigts.
 * Les formes sont tracées en trait épais puis remplies de blanc par-dessus : il ne reste
 * que le contour d'ensemble. (Coordonnées générées par un petit script, à la main.)
 */
const FORMES_MAIN = [
  "M 33.6 62.9 Q 30.1 41.2 28.7 19.2 C 28.0 14.5 30.0 13.4 33.1 13.0 C 36.2 12.5 38.4 13.0 39.1 17.7 Q 43.7 39.3 46.4 61.1 Z",
  "M 46.8 58.1 Q 45.9 33.1 47.1 8.1 C 47.0 3.2 49.2 2.3 52.5 2.2 C 55.8 2.2 58.0 3.0 58.1 7.9 Q 60.2 32.9 60.2 57.9 Z",
  "M 60.0 59.3 Q 62.0 36.9 66.0 14.7 C 66.5 10.0 68.6 9.4 71.8 9.8 C 74.9 10.1 76.9 11.1 76.4 15.8 Q 75.7 38.3 73.0 60.7 Z",
  "M 72.4 64.5 Q 76.5 48.0 82.5 32.0 C 83.5 28.1 85.4 27.9 88.0 28.6 C 90.6 29.3 92.2 30.4 91.1 34.3 Q 88.3 51.2 83.6 67.5 Z",
  "M 30.5 99.5 Q 19.2 85.4 9.5 70.1 C 6.1 66.2 7.3 64.0 10.0 61.8 C 12.6 59.6 14.9 58.8 18.3 62.7 Q 31.7 75.0 43.5 88.5 Z",
  "M 34 60 C 46 54, 72 56, 84 66 C 87 80, 83 96, 77 110 L 75 140 L 43 140 L 41 112 C 36 104, 31 94, 30 84 C 29 74, 30 65, 34 60 Z",
];
const DETAILS_MAIN = [
  "M 31.4 19.6 C 30.8 15.7 36.0 14.9 36.6 18.8",
  "M 33.0 34.7 Q 36.2 35.2 39.2 33.8",
  "M 49.9 8.9 C 49.8 4.8 55.3 4.7 55.4 8.8",
  "M 49.6 26.1 Q 53.0 26.9 56.2 25.9",
  "M 68.5 15.8 C 68.9 11.8 74.1 12.4 73.7 16.3",
  "M 66.4 30.8 Q 69.4 32.1 72.7 31.5",
  "M 84.5 33.2 C 85.3 30.0 89.7 31.1 88.8 34.4",
  "M 81.1 44.1 Q 83.5 45.6 86.3 45.4",
  "M 12.2 68.9 C 9.4 65.6 13.8 61.9 16.6 65.2",
  "M 20.9 80.1 Q 24.1 78.6 26.1 75.7",
].join(" ");

function svgMain(droite: boolean, x: number, y: number, largeur: number, hauteur: number): string {
  const miroir = droite ? "" : ' transform="translate(100 0) scale(-1 1)"';
  const formes = FORMES_MAIN.map((d) => `<path d="${d}"/>`).join("");
  // Style en ligne : une règle de la page impose un trait à tous les tracés de la partition.
  const remplissage = FORMES_MAIN.map((d) => `<path d="${d}" style="stroke:none"/>`).join("");
  return (
    `<svg xmlns="${SVG_NS}" x="${x}" y="${y}" width="${largeur}" height="${hauteur}" viewBox="0 0 100 124" class="dessin-main">` +
    `<g${miroir}>` +
    `<g fill="none" stroke="#000" stroke-width="6" stroke-linejoin="round">${formes}</g>` +
    `<g fill="#fff">${remplissage}</g>` +
    `<path d="${DETAILS_MAIN}" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"/>` +
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
    const largeur = (hauteur * 100) / 124;
    const centre = ligne - taille * 0.2;
    const fragment = new DOMParser().parseFromString(
      svgMain(contenu.includes("M.D."), fin - largeur, centre - hauteur / 2, largeur, hauteur),
      "image/svg+xml",
    );
    texte.replaceWith(doc.importNode(fragment.documentElement, true));
  });
}
