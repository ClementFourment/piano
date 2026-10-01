// Palette d'outils de l'éditeur (colonne de gauche), reprise du prototype.

import { useEffect, useState } from "react";
import { DOIGTS, DYNAMICS, KEY_SIGNATURES, type Doigt, type Accidental, type Articulation, type Barre, type Clef, type Duration, type Dynamic, type KeySignature, type Letter, type Voix } from "../../shared/score";

export const NOMS_NOTES: Record<Letter, string> = { C: "Do", D: "Ré", E: "Mi", F: "Fa", G: "Sol", A: "La", B: "Si" };

const DUREES: { d: Duration; glyphe: string; nom: string; touche: string }[] = [
  { d: "whole", glyphe: "𝅝", nom: "Ronde", touche: "7" },
  { d: "half", glyphe: "𝅗𝅥", nom: "Blanche", touche: "6" },
  { d: "quarter", glyphe: "♩", nom: "Noire", touche: "5" },
  { d: "eighth", glyphe: "♪", nom: "Croche", touche: "4" },
  { d: "sixteenth", glyphe: "𝅘𝅥𝅯", nom: "Double croche", touche: "3" },
];

const ALTERATIONS: { a: NonNullable<Accidental>; glyphe: string; nom: string; touche: string }[] = [
  { a: "sharp", glyphe: "♯", nom: "Dièse", touche: "+" },
  { a: "flat", glyphe: "♭", nom: "Bémol", touche: "-" },
  { a: "natural", glyphe: "♮", nom: "Bécarre", touche: "=" },
];

const ARTICS: { a: Articulation; glyphe: string; nom: string }[] = [
  { a: "staccato", glyphe: "•", nom: "Staccato : note piquée, détachée (touche S)" },
  { a: "accent", glyphe: ">", nom: "Accent : note appuyée" },
  { a: "tenuto", glyphe: "–", nom: "Tenuto : note tenue sur toute sa durée" },
  { a: "marcato", glyphe: "^", nom: "Marcato : note très appuyée" },
  { a: "fermata", glyphe: "𝄐", nom: "Point d'orgue : note tenue plus longtemps" },
];

const NOMS_NUANCES: Record<Dynamic, string> = {
  pp: "pianissimo (très doux)", p: "piano (doux)", mp: "mezzo piano (moyennement doux)",
  mf: "mezzo forte (moyennement fort)", f: "forte (fort)", ff: "fortissimo (très fort)",
};

export const CHIFFRAGES = ["2/4", "3/4", "4/4", "5/4", "2/2", "3/8", "6/8", "9/8", "12/8"];

const NOMS_ARMURES: Record<KeySignature, string> = {
  C: "Do majeur / la mineur", G: "Sol majeur / mi mineur", D: "Ré majeur / si mineur", A: "La majeur / fa♯ mineur",
  E: "Mi majeur / do♯ mineur", B: "Si majeur / sol♯ mineur", "F#": "Fa♯ majeur / ré♯ mineur", "C#": "Do♯ majeur / la♯ mineur",
  F: "Fa majeur / ré mineur", Bb: "Si♭ majeur / sol mineur", Eb: "Mi♭ majeur / do mineur", Ab: "La♭ majeur / fa mineur",
  Db: "Ré♭ majeur / si♭ mineur", Gb: "Sol♭ majeur / mi♭ mineur", Cb: "Do♭ majeur / la♭ mineur",
};

function signeArmure(k: KeySignature): string {
  const n = KEY_SIGNATURES[k];
  return n === 0 ? "" : ` (${Math.abs(n)}${n > 0 ? "♯" : "♭"})`;
}

export interface PaletteProps {
  cle: Clef;
  voix: Voix;
  onVoix: (v: Voix) => void;
  octave: number;
  duree: Duration;
  pointee: boolean;
  triolet: boolean;
  alteration: Accidental;
  modeAccord: boolean;
  /** Une note est sélectionnée : les boutons la modifient au lieu d'en saisir une nouvelle. */
  selection: boolean;
  statut: string;
  mesure: number;
  nbMesures: number;
  tempo: number;
  tempoVisible: boolean;
  mains: boolean;
  chiffrage: string;
  armure: KeySignature;
  peutAnnuler: boolean;
  peutRetablir: boolean;
  onCle: (c: Clef) => void;
  onOctave: (delta: number) => void;
  onDuree: (d: Duration) => void;
  onPointee: () => void;
  onTriolet: () => void;
  /** Articulations de la note visée. */
  articulations: Articulation[];
  onArticulation: (a: Articulation) => void;
  arpege: boolean;
  onArpege: () => void;
  /** Doigtés de la note visée, du grave à l'aigu (vide : silence ou aucune note). */
  doigts: (Doigt | undefined)[];
  onDoigt: (d: Doigt | null) => void;
  onAlteration: (a: NonNullable<Accidental>) => void;
  onNote: (l: Letter) => void;
  onModeAccord: (v: boolean) => void;
  onSilence: () => void;
  onSupprimer: () => void;
  /** Nuance de la note visée (sélection ou dernière saisie), pour l'afficher enfoncée. */
  nuance: Dynamic | null;
  onLier: () => void;
  onDelier: () => void;
  onNuance: (d: Dynamic) => void;
  onSoufflet: (f: "cres" | "dim") => void;
  onSansNuance: () => void;
  onMesure: (delta: -1 | 1) => void;
  onAjouterMesures: (n: number) => void;
  onSupprimerMesure: () => void;
  /** Réglages de la mesure courante. */
  barre: Barre;
  repriseDebut: boolean;
  volta: 1 | 2 | null;
  onBarre: (b: Barre) => void;
  onRepriseDebut: (v: boolean) => void;
  onVolta: (v: 1 | 2 | null) => void;
  texte: string;
  onTexte: (t: string) => void;
  onDupliquerMesure: () => void;
  onDupliquerLigne: () => void;
  onTempo: (t: number) => void;
  onTempoVisible: (v: boolean) => void;
  onMains: (v: boolean) => void;
  onChiffrage: (c: string) => void;
  onArmure: (k: KeySignature) => void;
  onAnnuler: () => void;
  onRetablir: () => void;
  onFermer: () => void;
}

export function Palette(p: PaletteProps) {
  return (
    <aside className="rail" aria-label="Palette d'outils">
      <div className="rail-close">
        <span className="t">Outils</span>
        <button onClick={p.onFermer} aria-label="Fermer la palette">
          ✕
        </button>
      </div>

      <section className="rail-section">
        <div className="rail-title">Portée</div>
        <div className="seg" role="group" aria-label="Portée active">
          <button className={p.cle === "treble" ? "active" : ""} onClick={() => p.onCle("treble")} title="Tab">
            Main droite (sol)
          </button>
          <button className={p.cle === "bass" ? "active" : ""} onClick={() => p.onCle("bass")} title="Tab">
            Main gauche (fa)
          </button>
        </div>
        <div className="seg espace-seg" role="group" aria-label="Voix">
          <button className={p.voix === 1 ? "active" : ""} onClick={() => p.onVoix(1)} title="Touche V">
            Voix 1 (hampes en haut)
          </button>
          <button className={p.voix === 2 ? "active" : ""} onClick={() => p.onVoix(2)} title="Touche V">
            Voix 2 (hampes en bas)
          </button>
        </div>
        {p.voix === 2 && (
          <p className="chord-hint">Voix 2 : des notes jouées en même temps que la voix 1, sur la même portée (ex. une ronde tenue sous des noires).</p>
        )}
        <div className="octave-row">
          <span className="small muted">Octave</span>
          <div className="stepper">
            <button onClick={() => p.onOctave(-1)} aria-label="Octave plus grave">
              −
            </button>
            <span className="val">{p.octave}</span>
            <button onClick={() => p.onOctave(1)} aria-label="Octave plus aiguë">
              +
            </button>
          </div>
        </div>
      </section>

      <section className="rail-section">
        <div className="rail-title">Durée</div>
        <div className="dur-grid">
          {DUREES.map((d) => (
            <button
              key={d.d}
              className={`dur-btn${p.duree === d.d ? " active" : ""}`}
              onClick={() => p.onDuree(d.d)}
              title={`${d.nom} (touche ${d.touche})`}
              aria-label={d.nom}
              aria-pressed={p.duree === d.d}
            >
              {d.glyphe}
            </button>
          ))}
        </div>
        <div className="checks">
          <label className="dot-row" title="Touche .">
            <input type="checkbox" checked={p.pointee} onChange={p.onPointee} /> Pointée
          </label>
          <label className="dot-row" title="Touche T : 3 notes dans le temps de 2">
            <input type="checkbox" checked={p.triolet} onChange={p.onTriolet} /> Triolet
          </label>
        </div>
        {p.triolet && !p.selection && <p className="chord-hint">Les notes saisies forment des triolets. Décochez après le groupe.</p>}
      </section>

      <section className="rail-section">
        <div className="rail-title">{p.selection ? "Note sélectionnée" : "Notes"}</div>
        <div className="alt-grid">
          {ALTERATIONS.map((a) => (
            <button
              key={a.a}
              className={`alt-btn${p.alteration === a.a ? " active" : ""}`}
              onClick={() => p.onAlteration(a.a)}
              title={`${a.nom} (touche ${a.touche})`}
              aria-label={a.nom}
              aria-pressed={p.alteration === a.a}
            >
              {a.glyphe}
            </button>
          ))}
        </div>
        <div className="pitch-grid">
          {(Object.keys(NOMS_NOTES) as Letter[]).map((l) => (
            <button key={l} className="pitch-btn" onClick={() => p.onNote(l)} title={`${NOMS_NOTES[l]} (touche ${l})`}>
              {NOMS_NOTES[l]}
            </button>
          ))}
          <button className="pitch-btn rest" onClick={p.onSilence} title="Silence (touche 0)">
            𝄽
          </button>
        </div>
        <label className="dot-row" title="Maj + lettre">
          <input type="checkbox" checked={p.modeAccord} onChange={(e) => p.onModeAccord(e.target.checked)} /> Mode accord
        </label>
        <p className="chord-hint">
          {p.modeAccord
            ? "Les notes s'ajoutent à la dernière note saisie pour former un accord."
            : p.selection
              ? "Les boutons modifient la note sélectionnée. Échap pour reprendre la saisie."
              : "Astuce : Maj + lettre ajoute une note à l'accord."}
        </p>
        <button className="btn small danger-outline full" onClick={p.onSupprimer} title="Retour arrière / Suppr">
          ⌫ Effacer la note
        </button>
        <p className="fill-status" aria-live="polite">
          {p.statut}
        </p>
      </section>

      <section className="rail-section">
        <div className="rail-title">Articulations</div>
        <div className="artic-grid" role="group" aria-label="Articulations">
          {ARTICS.map((a) => (
            <button
              key={a.a}
              className={`dyn-btn artic${p.articulations.includes(a.a) ? " active" : ""}`}
              onClick={() => p.onArticulation(a.a)}
              aria-pressed={p.articulations.includes(a.a)}
              title={a.nom}
              aria-label={a.nom}
            >
              {a.glyphe}
            </button>
          ))}
          <button
            className={`dyn-btn artic${p.arpege ? " active" : ""}`}
            onClick={p.onArpege}
            aria-pressed={p.arpege}
            title="Arpège : notes de l'accord égrenées du grave vers l'aigu"
            aria-label="Arpège"
          >
            ⌇
          </button>
        </div>
      </section>

      <section className="rail-section">
        <div className="rail-title">Doigtés</div>
        <div className="artic-grid" role="group" aria-label="Doigtés">
          {DOIGTS.map((d) => (
            <button
              key={d}
              className={`dyn-btn${p.doigts.length === 1 && p.doigts[0] === d ? " active" : ""}`}
              onClick={() => p.onDoigt(d)}
              title={`Doigt ${d} (Alt + ${d})`}
            >
              {d}
            </button>
          ))}
          <button className="dyn-btn" onClick={() => p.onDoigt(null)} title="Retirer les doigtés de la note" aria-label="Retirer les doigtés">
            ✕
          </button>
        </div>
        {p.doigts.length > 1 && (
          <p className="chord-hint">
            Accord : chaque chiffre va sur la note suivante, du grave à l'aigu ({p.doigts.map((d) => d ?? "·").join(" ")}).
          </p>
        )}
      </section>

      <section className="rail-section">
        <div className="rail-title">Liaisons et nuances</div>
        <div className="row2">
          <button className="btn small" onClick={p.onLier} title="Relie la note à la suivante (touche L) ; appuyer encore allonge la liaison">
            ‿ Lier
          </button>
          <button className="btn small" onClick={p.onDelier} title="Maj + L">
            Délier
          </button>
        </div>
        <div className="dyn-grid" role="group" aria-label="Nuances">
          {DYNAMICS.map((d) => (
            <button
              key={d}
              className={`dyn-btn${p.nuance === d ? " active" : ""}`}
              onClick={() => p.onNuance(d)}
              aria-pressed={p.nuance === d}
              title={NOMS_NUANCES[d]}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="row2">
          <button className="btn small" onClick={() => p.onSoufflet("cres")} title="Crescendo (touche <) ; appuyer encore l'allonge">
            <span className="soufflet">&lt;</span> cresc.
          </button>
          <button className="btn small" onClick={() => p.onSoufflet("dim")} title="Decrescendo (touche >) ; appuyer encore l'allonge">
            <span className="soufflet">&gt;</span> decresc.
          </button>
        </div>
        <button className="btn small ghost full" onClick={p.onSansNuance}>
          Retirer nuance et soufflet
        </button>
      </section>

      <section className="rail-section">
        <div className="rail-title">Mesures</div>
        <div className="measure-nav">
          <button className="btn small icon" onClick={() => p.onMesure(-1)} aria-label="Mesure précédente">
            ‹
          </button>
          <div className="label">
            Mesure {p.mesure + 1} / {p.nbMesures}
          </div>
          <button className="btn small icon" onClick={() => p.onMesure(1)} aria-label="Mesure suivante">
            ›
          </button>
        </div>
        <div className="row2">
          <button className="btn small" onClick={() => p.onAjouterMesures(1)}>
            + 1 mesure
          </button>
          <button className="btn small" onClick={() => p.onAjouterMesures(4)}>
            + 4 mesures
          </button>
        </div>
        <label className="dot-row" title="La reprise recommence à cette mesure">
          <input type="checkbox" checked={p.repriseDebut} onChange={(e) => p.onRepriseDebut(e.target.checked)} /> Début de reprise ‖:
        </label>
        <label className="field-label" htmlFor="barre">
          Barre de fin de mesure
        </label>
        <select id="barre" value={p.barre} onChange={(e) => p.onBarre(e.target.value as Barre)}>
          <option value="simple">Simple │</option>
          <option value="double">Double ‖</option>
          <option value="final">Finale (fin du morceau)</option>
          <option value="reprise">Fin de reprise :‖</option>
        </select>
        <label className="field-label" htmlFor="volta">
          Case
        </label>
        <select
          id="volta"
          value={p.volta ?? ""}
          onChange={(e) => p.onVolta(e.target.value ? (Number(e.target.value) as 1 | 2) : null)}
        >
          <option value="">Aucune</option>
          <option value="1">1re fois (jouée avant de reprendre)</option>
          <option value="2">2e fois (jouée après la reprise)</option>
        </select>
        <label className="field-label" htmlFor="texte-mesure">
          Texte au-dessus de la mesure
        </label>
        <ChampTexte key={p.mesure} id="texte-mesure" valeur={p.texte} onValider={p.onTexte} placeholder="Ex. 1 : main droite seule" />
        <button className="btn small full espace" onClick={p.onDupliquerMesure} title="Recopie la mesure juste après elle">
          ⧉ Dupliquer la mesure
        </button>
        <button className="btn small full espace-petit" onClick={p.onDupliquerLigne} title="Recopie toute la ligne (le système) de la mesure courante, juste après elle">
          ⧉ Dupliquer la ligne
        </button>
        <button className="btn small danger-outline full espace" onClick={p.onSupprimerMesure}>
          Supprimer cette mesure
        </button>
      </section>

      <section className="rail-section">
        <div className="rail-title">Réglages</div>
        <label className="field-label" htmlFor="tempo">
          Tempo (noires par minute)
        </label>
        <ChampTempo tempo={p.tempo} onTempo={p.onTempo} />
        <label className="dot-row">
          <input type="checkbox" checked={p.tempoVisible} onChange={(e) => p.onTempoVisible(e.target.checked)} /> Afficher le tempo sur la partition
        </label>
        <label className="dot-row" title="M.D. devant la portée du haut, M.G. devant celle du bas">
          <input type="checkbox" checked={p.mains} onChange={(e) => p.onMains(e.target.checked)} /> Écrire M.D. / M.G. devant les portées
        </label>
        <label className="field-label" htmlFor="chiffrage">
          Chiffrage
        </label>
        <select id="chiffrage" value={p.chiffrage} onChange={(e) => p.onChiffrage(e.target.value)}>
          {(CHIFFRAGES.includes(p.chiffrage) ? CHIFFRAGES : [p.chiffrage, ...CHIFFRAGES]).map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label className="field-label" htmlFor="armure">
          Armure
        </label>
        <select id="armure" value={p.armure} onChange={(e) => p.onArmure(e.target.value as KeySignature)}>
          {(Object.keys(NOMS_ARMURES) as KeySignature[]).map((k) => (
            <option key={k} value={k}>
              {NOMS_ARMURES[k]}
              {signeArmure(k)}
            </option>
          ))}
        </select>
      </section>

      <section className="rail-section">
        <div className="row2">
          <button className="btn small" onClick={p.onAnnuler} disabled={!p.peutAnnuler} title="Ctrl+Z">
            ↩ Annuler
          </button>
          <button className="btn small" onClick={p.onRetablir} disabled={!p.peutRetablir} title="Ctrl+Y">
            ↪ Rétablir
          </button>
        </div>
        <details className="raccourcis">
          <summary>Raccourcis clavier</summary>
          <dl>
            <dt>A à G</dt><dd>La, Si, Do, Ré, Mi, Fa, Sol</dd>
            <dt>Maj + lettre</dt><dd>ajouter à l'accord</dd>
            <dt>0</dt><dd>silence</dd>
            <dt>3 à 7</dt><dd>double croche → ronde</dd>
            <dt>.</dt><dd>pointée</dd>
            <dt>+ − =</dt><dd>dièse, bémol, bécarre</dd>
            <dt>↑ ↓</dt><dd>monter/descendre la note (Ctrl : octave)</dd>
            <dt>← →</dt><dd>note précédente / suivante</dd>
            <dt>Tab</dt><dd>changer de portée</dd>
            <dt>V</dt><dd>voix 1 / voix 2</dd>
            <dt>T</dt><dd>triolet</dd>
            <dt>S</dt><dd>staccato</dd>
            <dt>Alt + 1 à 5</dt><dd>doigté</dd>
            <dt>L / Maj+L</dt><dd>lier / délier</dd>
            <dt>&lt; &gt;</dt><dd>crescendo / decrescendo</dd>
            <dt>⌫ / Suppr</dt><dd>effacer</dd>
            <dt>Échap</dt><dd>désélectionner</dd>
            <dt>Espace</dt><dd>écouter / arrêter</dd>
            <dt>Ctrl+Z / Ctrl+Y</dt><dd>annuler / rétablir</dd>
          </dl>
        </details>
      </section>
    </aside>
  );
}

const TEMPO_MIN = 20;
const TEMPO_MAX = 300;

/** Tempo tapé au clavier : appliqué dès qu'il est valable, corrigé en quittant le champ. */
function ChampTempo({ tempo, onTempo }: { tempo: number; onTempo: (t: number) => void }) {
  const [texte, setTexte] = useState(String(tempo));
  useEffect(() => setTexte(String(tempo)), [tempo]);

  function valider() {
    const t = parseInt(texte);
    const corrige = Number.isNaN(t) ? tempo : Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, t));
    setTexte(String(corrige));
    if (corrige !== tempo) onTempo(corrige);
  }

  return (
    <input
      id="tempo"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={texte}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, "").slice(0, 3);
        setTexte(v);
        const t = parseInt(v);
        if (t >= TEMPO_MIN && t <= TEMPO_MAX) onTempo(t);
      }}
      onBlur={valider}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

/** Champ texte appliqué en quittant le champ (ou avec Entrée), pour ne pas remplir l'historique à chaque lettre. */
function ChampTexte({ id, valeur, onValider, placeholder }: { id: string; valeur: string; onValider: (t: string) => void; placeholder?: string }) {
  const [texte, setTexte] = useState(valeur);
  useEffect(() => setTexte(valeur), [valeur]);
  return (
    <input
      id={id}
      type="text"
      maxLength={200}
      value={texte}
      placeholder={placeholder}
      onChange={(e) => setTexte(e.target.value)}
      onBlur={() => texte.trim() !== valeur && onValider(texte.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}
