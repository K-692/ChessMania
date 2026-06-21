import React, { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { X, ShieldAlert } from 'lucide-react';
import type { GameMode } from '../types';
import { formatCoins } from '../utils/format';

interface PlayModalProps {
  isOpen: boolean;
  onClose: () => void;
  pieceTheme?: string;
  onStartSearch: (
    mode: GameMode,
    stake: number,
    timeControl?: string
  ) => void;
}

export const CLASSICAL_TIME_CONTROLS = [
  { tc: '15 min', price: 100, difficulty: '🌱 Beginner', originalMode: 'beginner', purpose: 'Learning fundamentals and building confidence.' },
  { tc: '10 min', price: 500, difficulty: '🍃 Casual', originalMode: 'casual_rapid', purpose: 'Low-pressure daily rapid chess.' },
  { tc: '10 | 5', price: 2500, difficulty: '⚔️ Standard', originalMode: 'standard_rapid', purpose: 'Balanced rapid format with incremental buffers.' },
  { tc: '15 | 10', price: 10000, difficulty: '🛡️ Competitive', originalMode: 'competitive_rapid', purpose: 'Serious strategic rapid play.' },
  { tc: '20 | 10', price: 25000, difficulty: '🧠 Positional', originalMode: 'classical_lite', purpose: 'Deep calculation and tactical strategy.' },
  { tc: '5 | 3', price: 50000, difficulty: '⏱️ Blitz', originalMode: 'blitz', purpose: 'Fast tactical battles under speed pressure.' },
  { tc: '3 | 2', price: 100000, difficulty: '⚡ Speed Blitz', originalMode: 'competitive_blitz', purpose: 'High-skill competitive speed format.' },
  { tc: '1 | 1', price: 500000, difficulty: '🔥 Bullet Master', originalMode: 'bullet', purpose: 'Superfast reflexes and intuition under pressure.' },
  { tc: '1 min', price: 1000000, difficulty: '💀 Speed Demon', originalMode: 'arena_bullet', purpose: 'Extreme single-minute speed chess.' },
  { tc: '30 | 20', price: 5000000, difficulty: '🏆 Champion', originalMode: 'championship', purpose: 'Premium high-stakes professional arena.' }
];

export const PlayModal: React.FC<PlayModalProps> = ({ isOpen, onClose, pieceTheme, onStartSearch }) => {
  const { profile } = useAuth();
  const [selectedTcIdx, setSelectedTcIdx] = useState<number>(2); // Default to '10 | 5'

  if (!isOpen) return null;

  const userBalance = (profile?.currentBalance !== undefined ? profile.currentBalance : profile?.bankBalance) || 0;
  const selectedTc = CLASSICAL_TIME_CONTROLS[selectedTcIdx];

  const isInsufficient = userBalance < selectedTc.price;
  const count = profile?.gameplayCounts?.[selectedTc.originalMode] || 0;
  const isUnlocked = count >= 5;

  const getModeRules = (price: number, timeControl: string) => {
    return [
      `Rating Constraints: Paired within your Elo bracket (+/- 100) to keep matches balanced.`,
      `Chosen Time Control: ${timeControl}.`,
      `Entry Fee: Deducts exactly ${formatCoins(price)} from your wallet.`,
      `Prize Pool: Winner claims double the entry fee (${formatCoins(price * 2)}) directly to their wallet.`,
      `Rating Delta: Standard Elo points are updated dynamically upon match termination.`
    ];
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isInsufficient) return;
    onStartSearch('classical', selectedTc.price, selectedTc.tc);
    onClose();
  };

  const knightImgSrc = `/pieces/${pieceTheme || 'classic'}/wn.png`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in">
      <div
        className="glass-card w-full max-w-4xl rounded-2xl overflow-hidden border border-white/10 flex flex-col shadow-2xl relative z-10 animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-slate-900/50">
          <div>
            <h3 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
              <img src={knightImgSrc} alt="Knight" className="w-5 h-5 object-contain animate-pulse" />
              <span>Select Your Classical Arena Clash</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Wallet: <strong className="text-amber-400 font-mono">{formatCoins(userBalance)}</strong> &nbsp;•&nbsp; Choose your clock controls below
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/8 rounded-lg transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Layout */}
        <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-white/10 flex-grow overflow-hidden h-[480px] md:h-[450px]">
          
          {/* Left Column: Mode Showcase & Selector (55% width) */}
          <div className="md:w-[55%] flex flex-col justify-between p-5 bg-slate-900/20 overflow-y-auto">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="text-left">
                  <span className="bg-violet-500/10 border border-violet-500/20 text-violet-400 px-2 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase">
                    Classical Mode
                  </span>
                  <h4 className="text-lg font-extrabold text-white mt-1.5 uppercase">Classical Matchmaking</h4>
                </div>
                <div className="w-16 h-16 rounded-xl overflow-hidden border border-white/10 shrink-0 bg-slate-950">
                  <img src="/game_modes/classical.png" alt="Classical" className="w-full h-full object-cover" />
                </div>
              </div>
              <p className="text-xs text-slate-400 font-light leading-relaxed text-left">
                Test your calculation and chess strategy. Select your preferred time control from the options below. Each choice maps to standard entry stakes and lets you earn wins toward milestones.
              </p>

              {/* Time Control Options Grid */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block text-left">
                  Select Time Control
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {CLASSICAL_TIME_CONTROLS.map((mode, idx) => {
                    const isSelected = selectedTcIdx === idx;
                    return (
                      <button
                        key={mode.tc}
                        type="button"
                        onClick={() => setSelectedTcIdx(idx)}
                        className={`p-2 rounded-xl border text-left flex flex-col justify-between h-[58px] transition-all cursor-pointer ${
                          isSelected
                            ? 'border-violet-500 bg-violet-500/10 text-violet-300 ring-1 ring-violet-500 shadow-md'
                            : 'border-white/5 bg-slate-950/40 hover:bg-slate-900/40 text-slate-400'
                        }`}
                      >
                        <div className="flex justify-between items-center w-full">
                          <span className="text-[10.5px] font-bold truncate">{mode.difficulty}</span>
                          <span className="text-[9px] font-mono bg-white/5 px-1 py-0.2 rounded text-slate-300 shrink-0">{mode.tc}</span>
                        </div>
                        <span className="text-[10px] font-mono font-bold text-amber-400 flex items-center space-x-1 mt-1">
                          <img src="/coin_pack/100 coins.png" alt="Coins" className="w-3 h-3 object-contain shrink-0" />
                          <span>{formatCoins(mode.price)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Detail Panel (45% width) */}
          <div className="md:w-[45%] flex flex-col justify-between p-5 bg-slate-950/50 overflow-y-auto">
            <div className="space-y-4">
              <div className="text-left space-y-1">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Selected Clock details</h4>
                <div className="flex justify-between items-center bg-slate-900/60 p-3 rounded-xl border border-white/5 mt-1.5">
                  <div className="text-left">
                    <p className="text-sm font-extrabold text-white font-mono">{selectedTc.tc}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{selectedTc.purpose}</p>
                  </div>
                  <span className="bg-violet-500/10 border border-violet-500/25 px-2.5 py-0.5 rounded text-[10px] font-bold text-violet-300 font-mono">
                    {selectedTc.difficulty}
                  </span>
                </div>
              </div>

              {/* Detailed Rules List */}
              <div className="space-y-2 border-t border-white/5 pt-3">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left">
                  Arena Rules & Match Details
                </h4>
                <ul className="space-y-2 text-left">
                  {getModeRules(selectedTc.price, selectedTc.tc).map((rule, rIdx) => (
                    <li key={rIdx} className="text-xs text-slate-300 flex items-start space-x-2">
                      <span className="text-violet-400 mt-0.5 shrink-0">•</span>
                      <span className="font-light leading-tight">{rule}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Milestone progress bar */}
              <div className="space-y-1.5 border-t border-white/5 pt-3 text-left">
                <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                  <span>Milestone Wins</span>
                  <span className="font-mono font-bold text-slate-300">{count}/5</span>
                </div>
                <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isUnlocked
                        ? 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]'
                        : 'bg-violet-500'
                    }`}
                    style={{ width: `${Math.min(100, (count / 5) * 100)}%` }}
                  />
                </div>
                <p className="text-[9.5px] text-slate-500 font-light mt-1">
                  Win 5 matches with this time control to unlock the {selectedTc.difficulty} badge.
                </p>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="pt-4 border-t border-white/5 space-y-3 mt-4 flex-shrink-0">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Total Entry Stake:</span>
                <div className="flex items-center space-x-1.5">
                  <img src="/coin_pack/100 coins.png" alt="Coin" className="w-4 h-4 object-contain" />
                  <span className="font-mono font-bold text-amber-400 text-sm">
                    {formatCoins(selectedTc.price)}
                  </span>
                </div>
              </div>

              {isInsufficient ? (
                <div className="flex items-center space-x-1.5 text-red-400 text-xs bg-red-950/30 border border-red-900/30 p-2.5 rounded-lg justify-center font-medium">
                  <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                  <span>
                    Needs {formatCoins(selectedTc.price - userBalance)} more coins
                  </span>
                </div>
              ) : (
                <button
                  onClick={handleSubmit}
                  className="w-full flex items-center justify-center space-x-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white py-2.5 rounded-xl font-bold shadow-lg shadow-violet-600/20 hover:shadow-violet-600/30 border border-violet-500/20 transition-all cursor-pointer text-xs uppercase tracking-wider"
                >
                  <span>Find Match</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
