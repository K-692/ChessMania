import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Music, ArrowLeft, Eye, Check, Palette } from 'lucide-react';
import { getSoundSettings, updateSoundSettings } from '../utils/sound';

interface SettingsViewProps {
  onBack: () => void;
}

const BOARD_THEMES: Record<string, { dark: string; light: string; label: string; isAngle?: boolean }> = {
  green:         { dark: '#779556', light: '#ebecd0', label: 'Green' },
  wood:          { dark: '#b58863', light: '#f0d9b5', label: 'Wood' },
  'green-angle': { dark: '#779556', light: '#ebecd0', label: 'Green Angle', isAngle: true },
  'wood-angle':  { dark: '#b58863', light: '#f0d9b5', label: 'Wood Angle', isAngle: true },
  blue:          { dark: '#4b7db8', light: '#dee3e6', label: 'Blue' },
  'blue-angle':  { dark: '#4b7db8', light: '#dee3e6', label: 'Blue Angle', isAngle: true },
};

const PIECE_IMAGES: Record<string, string> = {
  P: 'https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg', // White Pawn
  N: 'https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg', // White Knight
  p: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg', // Black Pawn
  n: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg', // Black Knight
};

export const SettingsView: React.FC<SettingsViewProps> = ({ onBack }) => {
  const [settings, setSettings] = useState(getSoundSettings());

  useEffect(() => {
    // Sync external changes (e.g. if muted from landing page)
    const interval = setInterval(() => {
      setSettings(getSoundSettings());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const musicVolume = parseFloat(e.target.value);
    const newMuted = musicVolume === 0 ? true : settings.muted;
    const updated = { musicVolume, muted: newMuted };
    setSettings(prev => ({ ...prev, ...updated }));
    updateSoundSettings(updated);
  };

  const handleToggleEffects = () => {
    const effectsEnabled = !settings.effectsEnabled;
    setSettings(prev => ({ ...prev, effectsEnabled }));
    updateSoundSettings({ effectsEnabled });
  };

  const handleToggleMute = () => {
    const muted = !settings.muted;
    setSettings(prev => ({ ...prev, muted }));
    updateSoundSettings({ muted });
  };

  const handleToggleLegalMoves = () => {
    const showLegalMoves = !settings.showLegalMoves;
    setSettings(prev => ({ ...prev, showLegalMoves }));
    updateSoundSettings({ showLegalMoves });
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-8 text-left animate-fade-in">
      <div className="flex items-center space-x-4">
        <button
          onClick={onBack}
          className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-all border border-white/5 cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-3xl font-extrabold tracking-wide text-white">
            Game Settings
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Customize audio preferences and game experience
          </p>
        </div>
      </div>

      <div className="glass rounded-2xl border border-white/10 divide-y divide-white/5 overflow-hidden shadow-2xl">
        {/* Row 1: Theme Music Volume Setting */}
        <div className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:bg-white/[0.01] transition-colors">
          <div className="flex items-center space-x-4">
            <div className="p-2.5 bg-violet-500/10 rounded-xl border border-violet-500/20 text-violet-400 shrink-0">
              <Music className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-200">Theme Music</h4>
              <p className="text-xs text-slate-500">Looping cinematic background soundtrack</p>
            </div>
          </div>

          <div className="flex items-center space-x-4 w-full md:w-auto md:justify-end">
            <div className="flex items-center space-x-3 w-full md:w-48">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={settings.musicVolume}
                onChange={handleVolumeChange}
                className="w-full accent-violet-500 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-xs text-slate-400 font-mono w-8 text-right shrink-0">
                {Math.round(settings.musicVolume * 100)}%
              </span>
            </div>
            <button
              onClick={handleToggleMute}
              className={`p-2.5 rounded-xl border transition-all cursor-pointer shrink-0 ${
                settings.muted
                  ? 'border-red-500/30 bg-red-500/10 text-red-400'
                  : 'border-white/5 bg-slate-900/60 text-slate-400 hover:text-white hover:bg-white/5'
              }`}
              title={settings.muted ? "Unmute All" : "Mute All"}
            >
              {settings.muted ? <VolumeX className="w-4.5 h-4.5" /> : <Volume2 className="w-4.5 h-4.5" />}
            </button>
          </div>
        </div>

        {/* Row 2: Sound Effects Checkbox Setting */}
        <div className="p-6 flex items-center justify-between gap-6 hover:bg-white/[0.01] transition-colors">
          <div className="flex items-center space-x-4">
            <div className="p-2.5 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400 shrink-0">
              <Volume2 className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-200">Sound Effects</h4>
              <p className="text-xs text-slate-500">Board moves, captures, check warnings, and click feedback</p>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={settings.effectsEnabled}
              onChange={handleToggleEffects}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600 peer-checked:after:bg-white peer-checked:after:border-white"></div>
          </label>
        </div>

        {/* Row 3: Show Legal Moves Toggle Setting */}
        <div className="p-6 flex items-center justify-between gap-6 hover:bg-white/[0.01] transition-colors">
          <div className="flex items-center space-x-4">
            <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400 shrink-0">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-200">Legal Moves Hint</h4>
              <p className="text-xs text-slate-500">Show available legal moves as dots on the board when selecting a piece</p>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={!!settings.showLegalMoves}
              onChange={handleToggleLegalMoves}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600 peer-checked:after:bg-white peer-checked:after:border-white"></div>
          </label>
        </div>

        {/* Row 4: Board Theme Selection */}
        <div className="p-6 space-y-4 hover:bg-white/[0.01] transition-colors">
          <div className="flex items-center space-x-4">
            <div className="p-2.5 bg-pink-500/10 rounded-xl border border-pink-500/20 text-pink-400 shrink-0">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-200">Board Theme</h4>
              <p className="text-xs text-slate-500">Customize the colors and styling of the chessboard</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {Object.entries(BOARD_THEMES).map(([key, theme]) => {
              const isActive = settings.boardTheme === key;
              return (
                <button
                  key={key}
                  onClick={() => {
                    updateSoundSettings({ boardTheme: key });
                    setSettings(s => ({ ...s, boardTheme: key }));
                  }}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer text-left ${
                    isActive
                      ? 'border-violet-500 bg-violet-500/10 text-white font-bold'
                      : 'border-white/5 bg-slate-900/40 hover:bg-slate-900/60 text-slate-300'
                  }`}
                >
                  <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <span>{theme.label}</span>
                    {isActive && <Check className="w-4 h-4 text-violet-400" />}
                  </span>

                  {/* 2x2 Swatch Grid Preview */}
                  <div className="grid grid-cols-2 w-12 h-12 rounded-lg overflow-hidden border border-white/10 shrink-0 select-none shadow-md">
                    {theme.isAngle ? (
                      <>
                        <div style={{ backgroundColor: theme.light }} className="w-6 h-6 flex items-center justify-center p-0.5">
                          <img src={PIECE_IMAGES['N']} alt="N" className="w-full h-full object-contain" />
                        </div>
                        <div style={{ backgroundColor: theme.dark }} className="w-6 h-6 flex items-center justify-center p-0.5">
                          <img src={PIECE_IMAGES['p']} alt="p" className="w-full h-full object-contain" />
                        </div>
                        <div style={{ backgroundColor: theme.dark }} className="w-6 h-6 flex items-center justify-center p-0.5">
                          <img src={PIECE_IMAGES['n']} alt="n" className="w-full h-full object-contain" />
                        </div>
                        <div style={{ backgroundColor: theme.light }} className="w-6 h-6 flex items-center justify-center p-0.5">
                          <img src={PIECE_IMAGES['P']} alt="P" className="w-full h-full object-contain" />
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ backgroundColor: theme.dark }} className="w-6 h-6 flex items-center justify-center p-0.5">
                          <img src={PIECE_IMAGES['n']} alt="n" className="w-full h-full object-contain" />
                        </div>
                        <div style={{ backgroundColor: theme.light }} className="w-6 h-6 flex items-center justify-center p-0.5">
                          <img src={PIECE_IMAGES['N']} alt="N" className="w-full h-full object-contain" />
                        </div>
                        <div style={{ backgroundColor: theme.dark }} className="w-6 h-6 flex items-center justify-center p-0.5">
                          <img src={PIECE_IMAGES['p']} alt="p" className="w-full h-full object-contain" />
                        </div>
                        <div style={{ backgroundColor: theme.light }} className="w-6 h-6 flex items-center justify-center p-0.5">
                          <img src={PIECE_IMAGES['P']} alt="P" className="w-full h-full object-contain" />
                        </div>
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
