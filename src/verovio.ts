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
 * doigts serrés presque parallèles ; paume et pouce d'un seul contour (le pouce prolonge
 * le bord du poignet), ouverte au poignet ; ongles.
 * Les formes sont tracées en trait épais puis remplies de blanc par-dessus : il ne reste
 * que le contour d'ensemble. (Coordonnées générées par un petit script, à la main.)
 */
const FORMES_MAIN = [
  "M 31.0 64.7 Q 28.5 46.3 27.9 27.8 C 27.4 22.7 29.6 21.6 33.0 21.2 C 36.4 20.8 38.8 21.5 39.4 26.6 Q 42.7 44.9 44.0 63.3 Z",
  "M 44.0 61.1 Q 43.0 39.6 44.0 18.1 C 43.9 12.9 46.2 12.0 49.6 12.0 C 53.1 11.9 55.4 12.7 55.5 17.9 Q 57.2 39.4 57.0 60.9 Z",
  "M 57.0 62.5 Q 57.8 43.1 60.5 23.7 C 60.8 18.5 63.2 17.8 66.6 18.1 C 70.1 18.3 72.3 19.3 72.0 24.5 Q 72.0 44.0 70.0 63.5 Z",
  "M 70.1 68.0 Q 72.1 53.1 76.0 38.5 C 76.9 33.9 79.1 33.5 82.2 34.0 C 85.3 34.6 87.2 35.7 86.4 40.4 Q 85.1 55.4 81.9 70.0 Z",
  "M 42 140 L 41 116 C 34 106, 22 92, 14 80 C 10 74, 15 66, 21 69 C 26 72, 30 78, 32.5 80 C 31 74, 30.5 68, 31 64 C 44 58, 70 59, 82.5 68 C 85 84, 83 98, 77 110 L 75 140 Z",
];
const DETAILS_MAIN = [
  "M 30.9 28.4 C 30.4 24.1 36.1 23.5 36.6 27.8",
  "M 46.9 18.9 C 46.8 14.6 52.6 14.5 52.6 18.8",
  "M 63.3 24.8 C 63.6 20.5 69.3 20.9 69.0 25.2",
  "M 78.5 39.8 C 79.2 35.9 84.3 36.8 83.7 40.7",
  "M 14.7 75.6 C 12.1 72.2 16.6 68.8 19.1 72.2",
].join(" ");

function svgMain(droite: boolean, x: number, y: number, largeur: number, hauteur: number): string {
  const miroir = droite ? "" : ' transform="translate(100 0) scale(-1 1)"';
  const formes = FORMES_MAIN.map((d) => `<path d="${d}"/>`).join("");
  // Style en ligne : une règle de la page impose un trait à tous les tracés de la partition.
  const remplissage = FORMES_MAIN.map((d) => `<path d="${d}" style="stroke:none"/>`).join("");
  return (
    `<svg xmlns="${SVG_NS}" x="${x}" y="${y}" width="${largeur}" height="${hauteur}" viewBox="0 0 100 124" class="dessin-main">` +
    `<g${miroir}>` +
    `<g fill="none" stroke="#000" stroke-width="4" stroke-linejoin="round">${formes}</g>` +
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
    const hauteur = taille * 1.9;
    const largeur = (hauteur * 100) / 124;
    const centre = ligne - taille * 0.2;
    const fragment = new DOMParser().parseFromString(
      svgMain(contenu.includes("M.D."), fin - largeur, centre - hauteur / 2, largeur, hauteur),
      "image/svg+xml",
    );
    texte.replaceWith(doc.importNode(fragment.documentElement, true));
  });
}
