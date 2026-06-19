const DEFAULT_SETTINGS = {
  musicVolume: 0.5,
  effectsEnabled: true,
  muted: false,
  showLegalMoves: true,
  boardTheme: '8_bit' as string,
  pieceTheme: 'neo' as string,
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
  const vol = settings.muted ? 0 : settings.musicVolume;
  if (themeAudio) {
    themeAudio.volume = vol * 0.3;
    if (vol > 0) {
      themeAudio.play().catch(() => {});
    } else {
      themeAudio.pause();
    }
  }
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

let themeAudio: HTMLAudioElement | null = null;

export function startCinematicTheme() {
  if (themeAudio) return; // Already running
  
  try {
    themeAudio = new Audio('/Checkmate Horizon.mp3');
    themeAudio.loop = true;
    const vol = settings.muted ? 0 : settings.musicVolume;
    themeAudio.volume = vol * 0.3;
    if (vol > 0) {
      themeAudio.play().catch(e => {
        console.warn("Failed to play background theme song automatically:", e);
      });
    }
  } catch (e) {
    console.warn("Failed to initialize background audio:", e);
  }
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
