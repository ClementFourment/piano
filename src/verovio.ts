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
 * Main droite vue du dessus (dos de la main, pouce à gauche), dans une boîte de 104 × 120.
 * Dessinée deux fois : un trait épais, puis un remplissage blanc par-dessus, ce qui donne
 * le contour de l'ensemble sans les traits intérieurs.
 */
const FORMES_MAIN =
  '<rect x="30" y="56" width="52" height="56" rx="18"/>' +
  '<rect x="30" y="22" width="13" height="50" rx="6.5"/>' +
  '<rect x="44.5" y="11" width="13" height="60" rx="6.5"/>' +
  '<rect x="59" y="17" width="13" height="56" rx="6.5"/>' +
  '<rect x="72.5" y="33" width="11" height="42" rx="5.5"/>' +
  '<rect x="27" y="54" width="14" height="46" rx="7" transform="rotate(-40 34 100)"/>';

function svgMain(droite: boolean, x: number, y: number, largeur: number, hauteur: number): string {
  const miroir = droite ? "" : ' transform="translate(100 0) scale(-1 1)"';
  return (
    `<svg xmlns="${SVG_NS}" x="${x}" y="${y}" width="${largeur}" height="${hauteur}" viewBox="-4 0 104 120" class="dessin-main">` +
    `<g${miroir}>` +
    `<g fill="none" stroke="#000" stroke-width="7" stroke-linejoin="round">${FORMES_MAIN}</g>` +
    `<g fill="#fff">${FORMES_MAIN}</g>` +
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
    const hauteur = taille * 2.1;
    const largeur = (hauteur * 104) / 120;
    const centre = ligne - taille * 0.2;
    const fragment = new DOMParser().parseFromString(
      svgMain(contenu.includes("M.D."), fin - largeur, centre - hauteur / 2, largeur, hauteur),
      "image/svg+xml",
    );
    texte.replaceWith(doc.importNode(fragment.documentElement, true));
  });
}
