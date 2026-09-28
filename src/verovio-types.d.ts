// Verovio n'est pas livré avec ses types : déclaration minimale de ce que l'appli utilise.
declare module "verovio/wasm" {
  const createVerovioModule: () => Promise<unknown>;
  export default createVerovioModule;
}

declare module "verovio/esm" {
  export interface TimemapEntry {
    tstamp: number;
    qstamp: number;
    on?: string[];
    off?: string[];
    tempo?: number;
    measureOn?: string;
  }
  export class VerovioToolkit {
    constructor(module: unknown);
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): boolean;
    loadZipDataBuffer(data: ArrayBuffer): boolean;
    getPageCount(): number;
    renderToSVG(page?: number): string;
    renderToMIDI(): string;
    renderToTimemap(options?: Record<string, unknown>): TimemapEntry[];
    getMIDIValuesForElement(id: string): { pitch: number; duration: number; time: number };
    getMEI(options?: Record<string, unknown>): string;
    getLog(): string;
    redoLayout(options?: Record<string, unknown>): void;
  }
}
