const DEFAULT_SETTINGS = {
  musicVolume: 0.5,
  effectsEnabled: true,
  muted: false,
  showLegalMoves: true,
  boardTheme: 'green' as string,
};

let settings = { ...DEFAULT_SETTINGS };

if (typeof window !== 'undefined') {
  try {
    const saved = localStorage.getItem('checkmate_sound_settings');
    if (saved) {
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.warn("Failed to load sound settings", e);
  }
}

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
}

export function getSoundSettings() {
  return { ...settings };
}

export function updateSoundSettings(newSettings: Partial<typeof settings>) {
  settings = { ...settings, ...newSettings };
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('checkmate_sound_settings', JSON.stringify(settings));
    } catch (e) {}
  }
  adjustThemeVolume();
}

function adjustThemeVolume() {
  if (!audioCtx) return;
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const vol = settings.muted ? 0 : settings.musicVolume;
  const targetGain = 0.04 * vol;

  themeNodes.forEach(node => {
    try {
      node.gain.gain.cancelScheduledValues(now);
      node.gain.gain.setValueAtTime(node.gain.gain.value, now);
      node.gain.gain.linearRampToValueAtTime(targetGain, now + 0.1);
    } catch (e) {
      console.warn("Error adjusting theme node volume:", e);
    }
  });
}

// Professional Wood Click synthesizer
export function playWoodClickSound() {
  if (settings.muted || !settings.effectsEnabled) return;
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.type = 'triangle';
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(450, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 0.04);
    
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    
    osc.start(now);
    osc.stop(now + 0.05);
  } catch (e) {
    console.warn("Failed to play wood click sound:", e);
  }
}

let themeInterval: any = null;
let themeNodes: { oscs: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode }[] = [];

export function startCinematicTheme() {
  if (themeInterval) return; // Already running
  
  const ctx = getAudioContext();
  const chords = [
    [146.83, 220.00, 349.23, 440.00], // Dm (D3, A3, F4, A4)
    [116.54, 174.61, 293.66, 349.23], // Bb (Bb2, F3, D4, F4)
    [87.31, 130.81, 220.00, 261.63],  // F (F2, C3, A3, C4)
    [130.81, 196.00, 329.63, 392.00]   // C (C3, G3, E4, G4)
  ];
  
  let chordIdx = 0;
  
  const playNextChord = () => {
    try {
      if (ctx.state === 'suspended') return;
      const now = ctx.currentTime;
      const notes = chords[chordIdx];
      chordIdx = (chordIdx + 1) % chords.length;
      
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(300, now);
      filter.frequency.exponentialRampToValueAtTime(800, now + 4);
      filter.frequency.exponentialRampToValueAtTime(300, now + 8);
      
      const gain = ctx.createGain();
      const vol = settings.muted ? 0 : settings.musicVolume;
      const maxVolume = 0.04 * vol;

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(maxVolume, now + 2.5); // Very soft background volume
      gain.gain.setValueAtTime(maxVolume, now + 5.5);
      gain.gain.linearRampToValueAtTime(0, now + 8);
      
      const oscs = notes.map((freq) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);
        osc.detune.setValueAtTime((Math.random() - 0.5) * 12, now);
        osc.connect(filter);
        return osc;
      });
      
      filter.connect(gain);
      gain.connect(ctx.destination);
      
      oscs.forEach(osc => osc.start(now));
      
      const nodeRef = { oscs, gain, filter };
      themeNodes.push(nodeRef);
      
      setTimeout(() => {
        try {
          oscs.forEach(osc => osc.stop());
          themeNodes = themeNodes.filter(n => n !== nodeRef);
        } catch (err) {}
      }, 8500);
      
    } catch (e) {
      console.warn("Failed to play theme chord:", e);
    }
  };

  playNextChord();
  themeInterval = setInterval(playNextChord, 8000);
}

// Global click event to initialize/resume AudioContext and play wooden clicks on interactives
if (typeof window !== 'undefined') {
  const initAudio = () => {
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      startCinematicTheme();
      window.removeEventListener('click', initAudio);
      window.removeEventListener('touchstart', initAudio);
    } catch (e) {
      console.warn("Failed to init audio context:", e);
    }
  };
  window.addEventListener('click', initAudio);
  window.addEventListener('touchstart', initAudio);

  window.addEventListener('click', (e) => {
    if (settings.muted || !settings.effectsEnabled) return;
    const target = e.target as HTMLElement;
    if (!target) return;
    
    // Play wood click on all click events, except moves on the board
    const isBoard = target.closest('.chessboard-container') || target.closest('[data-board-element]');
    if (!isBoard) {
      playWoodClickSound();
    }
  });
}

/**
 * Play a realistic wooden thud when a chess piece is placed on the board.
 */
export function playMoveSound() {
  if (settings.muted || !settings.effectsEnabled) return;
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;

    // White noise burst (wooden thud body)
    const bufferSize = ctx.sampleRate * 0.07;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) noiseData[i] = Math.random() * 2 - 1;
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    // Lowpass filter: gives the wood resonance warmth
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, now);
    filter.Q.setValueAtTime(3.5, now);

    // Short attack + fast decay envelope
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noiseSource.start(now);
    noiseSource.stop(now + 0.08);

    // Second layer: deep wooden resonant tone
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.05);
    oscGain.gain.setValueAtTime(0.25, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  } catch (e) {
    console.warn('Failed to play move sound:', e);
  }
}

/**
 * Play a harder wooden knock when a chess piece captures another.
 */
export function playCaptureSound() {
  if (settings.muted || !settings.effectsEnabled) return;
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;

    // Louder, longer noise burst for the impact
    const bufferSize = ctx.sampleRate * 0.12;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) noiseData[i] = Math.random() * 2 - 1;
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(500, now);
    filter.Q.setValueAtTime(4.0, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.85, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noiseSource.start(now);
    noiseSource.stop(now + 0.13);

    // Deep knock resonance
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.09);
    oscGain.gain.setValueAtTime(0.4, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.11);
  } catch (e) {
    console.warn('Failed to play capture sound:', e);
  }
}

/**
 * Play a double chime warning when the King is in check.
 */
export function playCheckSound() {
  if (settings.muted || !settings.effectsEnabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    const playChime = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      
      gain.gain.setValueAtTime(0.2, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      
      osc.start(start);
      osc.stop(start + duration + 0.02);
    };
    
    playChime(523.25, now, 0.15);      // C5
    playChime(659.25, now + 0.08, 0.2); // E5
  } catch (e) {
    console.warn("Failed to play synthesized sound:", e);
  }
}

/**
 * Play a double chime chord when a queue pairing succeeds.
 */
export function playMatchFoundSound() {
  if (settings.muted || !settings.effectsEnabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    const playNote = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      
      gain.gain.setValueAtTime(0.25, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      
      osc.start(start);
      osc.stop(start + duration + 0.05);
    };
    
    playNote(440, now, 0.15);          // A4
    playNote(554.37, now + 0.08, 0.15); // C#5
    playNote(659.25, now + 0.16, 0.3);  // E5
  } catch (e) {
    console.warn("Failed to play synthesized sound:", e);
  }
}

/**
 * Play an ascending major arpeggio upon winning a match.
 */
export function playWinSound() {
  if (settings.muted || !settings.effectsEnabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    const playNote = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      
      gain.gain.setValueAtTime(0.2, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      
      osc.start(start);
      osc.stop(start + duration + 0.05);
    };
    
    playNote(261.63, now, 0.2);         // C4
    playNote(329.63, now + 0.12, 0.2);  // E4
    playNote(392.00, now + 0.24, 0.2);  // G4
    playNote(523.25, now + 0.36, 0.45); // C5
  } catch (e) {
    console.warn("Failed to play synthesized sound:", e);
  }
}

/**
 * Play a descending minor arpeggio upon losing a match.
 */
export function playLoseSound() {
  if (settings.muted || !settings.effectsEnabled) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    const playNote = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      
      gain.gain.setValueAtTime(0.2, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      
      osc.start(start);
      osc.stop(start + duration + 0.05);
    };
    
    playNote(261.63, now, 0.22);        // C4
    playNote(220.00, now + 0.18, 0.22); // A3 (Minor third slide down from C)
    playNote(174.61, now + 0.36, 0.55); // F3
  } catch (e) {
    console.warn("Failed to play synthesized sound:", e);
  }
}
