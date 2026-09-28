// Capture du micro (AudioWorklet) : envoie le son par blocs d'environ 0,1 s,
// avec l'instant (en échantillons de l'AudioContext) du premier échantillon du bloc.

const TAILLE_BLOC = 2048;

class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bloc = new Float32Array(TAILLE_BLOC);
    this.rempli = 0;
    this.debutBloc = 0;
  }

  process(inputs) {
    const canal = inputs[0] && inputs[0][0];
    if (!canal) return true;
    for (let i = 0; i < canal.length; i++) {
      if (this.rempli === 0) this.debutBloc = currentFrame + i;
      this.bloc[this.rempli++] = canal[i];
      if (this.rempli === TAILLE_BLOC) {
        this.port.postMessage({ debut: this.debutBloc, audio: this.bloc }, [this.bloc.buffer]);
        this.bloc = new Float32Array(TAILLE_BLOC);
        this.rempli = 0;
      }
    }
    return true;
  }
}

registerProcessor("capture-micro", Capture);
