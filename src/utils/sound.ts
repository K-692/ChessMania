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
 * Play a realistic wooden thud when a chess piece is placed on the board using /sound/move-self.mp3.
 */
export function playMoveSound() {
  if (settings.muted || !settings.effectsEnabled) return;
  try {
    const audio = new Audio('/sound/move-self.mp3');
    audio.play().catch(e => console.warn('Failed to play move sound:', e));
  } catch (e) {
    console.warn('Failed to play move sound:', e);
  }
}

/**
 * Play a harder wooden knock when a chess piece captures another using /sound/capture.mp3.
 */
export function playCaptureSound() {
  if (settings.muted || !settings.effectsEnabled) return;
  try {
    const audio = new Audio('/sound/capture.mp3');
    audio.play().catch(e => console.warn('Failed to play capture sound:', e));
  } catch (e) {
    console.warn('Failed to play capture sound:', e);
  }
}

/**
 * Play a notification chime when a new message or challenge is received using /sound/notify.mp3.
 */
export function playNotifySound() {
  if (settings.muted || !settings.effectsEnabled) return;
  try {
    const audio = new Audio('/sound/notify.mp3');
    audio.play().catch(e => console.warn('Failed to play notify sound:', e));
  } catch (e) {
    console.warn('Failed to play notify sound:', e);
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
