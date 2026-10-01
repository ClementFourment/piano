// Chargement de Verovio (moteur de gravure, ~7 Mo de WebAssembly) et rendu en SVG.

import type { VerovioToolkit } from "verovio/esm";

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
  return new XMLSerializer().serializeToString(doc.documentElement);
}
