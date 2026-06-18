import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Music, ArrowLeft } from 'lucide-react';
import { getSoundSettings, updateSoundSettings } from '../utils/sound';

interface SettingsViewProps {
  onBack: () => void;
}

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

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-8 text-left animate-fade-in">
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Theme Music Volume Setting */}
        <div className="glass p-6 rounded-2xl border border-white/5 flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-violet-500/10 rounded-lg border border-violet-500/20 text-violet-400">
                <Music className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-200">Theme Music</h4>
                <p className="text-xs text-slate-500">Looping cinematic background soundtrack</p>
              </div>
            </div>
            <button
              onClick={handleToggleMute}
              className={`p-2 rounded-lg border transition-all cursor-pointer ${
                settings.muted
                  ? 'border-red-500/30 bg-red-500/10 text-red-400'
                  : 'border-white/5 bg-slate-900/60 text-slate-400 hover:text-white'
              }`}
              title={settings.muted ? "Unmute All" : "Mute All"}
            >
              {settings.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>

          <div className="space-y-3 pt-2">
            <div className="flex justify-between text-xs text-slate-400 font-mono">
              <span>Volume</span>
              <span>{Math.round(settings.musicVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={settings.musicVolume}
              onChange={handleVolumeChange}
              className="w-full accent-violet-500 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>

        {/* Sound Effects Checkbox Setting */}
        <div className="glass p-6 rounded-2xl border border-white/5 flex flex-col justify-between space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/20 text-indigo-400">
                <Volume2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-200">Sound Effects</h4>
                <p className="text-xs text-slate-500">Board moves, captures, check warnings, and click feedback</p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-white/5">
            <span className="text-xs text-slate-400">Enable Interaction Sounds</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.effectsEnabled}
                onChange={handleToggleEffects}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600 peer-checked:after:bg-white peer-checked:after:border-white"></div>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
