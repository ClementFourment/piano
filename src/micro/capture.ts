// Micro + métronome, dans un même AudioContext (donc une même horloge).

/** Fréquence attendue par le modèle de transcription. */
export const TAUX = 22050;

export interface Micro {
  ctx: AudioContext;
  /** Instant (horloge de l'AudioContext) du premier échantillon capturé. */
  debutCapture: number;
  /** Niveau sonore récent (0–1), pour l'indicateur. */
  niveau(): number;
  /** Programme un clic de métronome à l'instant `t` (horloge de l'AudioContext). */
  clic(t: number, fort: boolean, volume: number): void;
  fermer(): void;
}

/**
 * Ouvre le micro, sans les traitements prévus pour la voix (annulation d'écho,
 * réduction de bruit, gain automatique) qui abîment le son d'un piano.
 * `onAudio` reçoit le son en blocs, déjà à 22 050 Hz.
 */
export async function ouvrirMicro(onAudio: (bloc: Float32Array) => void): Promise<Micro> {
  const flux = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });

  // Chrome ré-échantillonne proprement le micro si on lui demande 22 050 Hz ;
  // sinon (Firefox…), on prend la fréquence native et on ré-échantillonne nous-mêmes.
  let ctx: AudioContext;
  let source: MediaStreamAudioSourceNode;
  try {
    ctx = new AudioContext({ sampleRate: TAUX });
    source = ctx.createMediaStreamSource(flux);
  } catch {
    ctx = new AudioContext();
    source = ctx.createMediaStreamSource(flux);
  }
  await ctx.audioWorklet.addModule("/micro-worklet.js");
  const noeud = new AudioWorkletNode(ctx, "capture-micro");
  const reechantillonner = ctx.sampleRate === TAUX ? (b: Float32Array) => b : reechantillonneur(ctx.sampleRate, TAUX);

  let niveau = 0;
  let premier: number | null = null;
  const pret = new Promise<void>((resolve) => {
    noeud.port.onmessage = (e: MessageEvent<{ debut: number; audio: Float32Array }>) => {
      if (premier === null) {
        premier = e.data.debut / ctx.sampleRate;
        resolve();
      }
      let somme = 0;
      for (const x of e.data.audio) somme += x * x;
      niveau = Math.max(niveau * 0.8, Math.sqrt(somme / e.data.audio.length));
      onAudio(reechantillonner(e.data.audio));
    };
  });
  source.connect(noeud);
  await ctx.resume();
  await pret;

  return {
    ctx,
    debutCapture: premier!,
    niveau: () => Math.min(1, niveau * 4),
    clic(t, fort, volume) {
      // Clic aigu, au-dessus de la dernière touche du piano : le modèle ne le prend pas pour une note.
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = fort ? 6000 : 5000;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume * (fort ? 0.5 : 0.3), t + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.05);
    },
    fermer() {
      flux.getTracks().forEach((p) => p.stop());
      noeud.port.onmessage = null;
      source.disconnect();
      ctx.close();
    },
  };
}

/** Ré-échantillonnage simple (filtre passe-bas par moyenne, puis interpolation linéaire). */
function reechantillonneur(de: number, vers: number) {
  const rapport = de / vers;
  let reste = new Float32Array(0);
  let phase = 0;
  return (bloc: Float32Array): Float32Array => {
    const entree = new Float32Array(reste.length + bloc.length);
    entree.set(reste);
    entree.set(bloc, reste.length);
    const largeur = Math.max(1, Math.round(rapport));
    const sortie: number[] = [];
    let pos = phase;
    while (pos + largeur < entree.length) {
      const i = Math.floor(pos);
      let s = 0;
      for (let k = 0; k < largeur; k++) s += entree[i + k];
      sortie.push(s / largeur);
      pos += rapport;
    }
    const garde = Math.floor(pos);
    reste = entree.slice(garde);
    phase = pos - garde;
    return Float32Array.from(sortie);
  };
}
