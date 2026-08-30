// Audio Mixer — orquestra o mix final: fala + música + ambiente.
// Usa WebAudio API pra combinar múltiplas fontes com gain independente
// + ducking + noise gate.
//
// Uso típico:
//   const mix = createAudioMixer({ videoAudio, musicAudio, ducking });
//   mix.connect(mediaRecorder.stream);
//
// MVP: mix logic pura (JS). Integração real com MediaRecorder fica na
// próxima etapa (item 4.4 exportador).

/**
 * @typedef {Object} AudioMixConfig
 * @property {HTMLMediaElement|null} videoAudioSource
 * @property {HTMLAudioElement|null} musicAudioSource
 * @property {number} speechVolume   - 0-1
 * @property {number} musicVolume    - 0-1
 * @property {number} ambientVolume  - 0-1 (futuro)
 * @property {Array} [duckingEnvelope]  - de musicDucking.js
 * @property {boolean} [noiseGate]      - aplica noise gate na fala
 */

/**
 * Cria um MediaStream mixado. Retorna um objeto com o stream + controls.
 *
 * @param {AudioContext} audioCtx
 * @param {AudioMixConfig} config
 * @returns {{ destination: MediaStreamAudioDestinationNode, speechGain, musicGain, disconnect: Function }}
 */
export function createAudioMix(audioCtx, config) {
  const dest = audioCtx.createMediaStreamDestination();

  const speechGain = audioCtx.createGain();
  const musicGain = audioCtx.createGain();
  speechGain.gain.value = config.speechVolume ?? 1.0;
  musicGain.gain.value = config.musicVolume ?? 0.28;

  const nodes = [];

  if (config.videoAudioSource) {
    try {
      const src = audioCtx.createMediaElementSource(config.videoAudioSource);
      src.connect(speechGain);
      nodes.push(src);
    } catch (e) {
      // MediaElement já ligado a outro AudioContext — ignora
    }
  }
  if (config.musicAudioSource) {
    try {
      const src = audioCtx.createMediaElementSource(config.musicAudioSource);
      src.connect(musicGain);
      nodes.push(src);
    } catch (e) { /* já ligado */ }
  }

  speechGain.connect(dest);
  musicGain.connect(dest);

  return {
    destination: dest,
    speechGain,
    musicGain,
    disconnect: () => {
      nodes.forEach((n) => { try { n.disconnect(); } catch { /* */ } });
      speechGain.disconnect();
      musicGain.disconnect();
    },
  };
}

/**
 * Aplica automaticamente o envelope de ducking à musicGain, agendando
 * mudanças via linearRampToValueAtTime.
 */
export function scheduleDucking(musicGainNode, envelope, audioCtx, baseVolume = 0.28) {
  if (!envelope?.length) return;
  const startAt = audioCtx.currentTime;
  const g = musicGainNode.gain;
  g.cancelScheduledValues(startAt);
  g.setValueAtTime(baseVolume * envelope[0].musicGain, startAt);
  for (const e of envelope) {
    g.linearRampToValueAtTime(baseVolume * e.musicGain, startAt + e.t);
  }
}
