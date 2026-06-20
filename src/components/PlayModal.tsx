import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { X, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';
import type { GameMode } from '../types';
import { formatCoins } from '../utils/format';

interface PlayModalProps {
  isOpen: boolean;
  onClose: () => void;
  pieceTheme?: string;
  onStartSearch: (
    mode: GameMode,
    stake: number,
    timeControl?: string,
    practiceConfig?: { elo: number; color: 'white' | 'black' | 'random' }
  ) => void;
}

const GAME_MODES_INFO = [
  {
    id: 'beginner' as GameMode,
    name: 'Beginner',
    timeControl: '15 min',
    purpose: 'Learning fundamentals and building confidence',
    entryPrice: 100,
    difficulty: '⭐ Easy',
    image: '/game_modes/beginner.png',
    themeColor: 'border-slate-500/30 text-slate-400 shadow-slate-500/5 hover:border-slate-500/80',
    selectedGlow: 'ring-2 ring-slate-500 border-slate-500 shadow-slate-500/20 bg-slate-500/5',
  },
  {
    id: 'casual_rapid' as GameMode,
    name: 'Casual Rapid',
    timeControl: '10 min',
    purpose: 'Low-pressure daily games',
    entryPrice: 500,
    difficulty: '⭐⭐ Casual',
    image: '/game_modes/casual_rapid.png',
    themeColor: 'border-teal-500/30 text-teal-400 shadow-teal-500/5 hover:border-teal-500/80',
    selectedGlow: 'ring-2 ring-teal-500 border-teal-500 shadow-teal-500/20 bg-teal-500/5',
  },
  {
    id: 'standard_rapid' as GameMode,
    name: 'Standard Rapid',
    timeControl: '10 | 5',
    purpose: 'Most balanced format for general players',
    entryPrice: 2500,
    difficulty: '⭐⭐⭐ Medium',
    image: '/game_modes/standard_rapid.png',
    themeColor: 'border-emerald-500/30 text-emerald-400 shadow-emerald-500/5 hover:border-emerald-500/80',
    selectedGlow: 'ring-2 ring-emerald-500 border-emerald-500 shadow-emerald-500/20 bg-emerald-500/5',
  },
  {
    id: 'competitive_rapid' as GameMode,
    name: 'Competitive Rapid',
    timeControl: '15 | 10',
    purpose: 'Serious strategic play',
    entryPrice: 10000,
    difficulty: '⭐⭐⭐⭐ Advanced',
    image: '/game_modes/competitive_rapid.png',
    themeColor: 'border-blue-500/30 text-blue-400 shadow-blue-500/5 hover:border-blue-500/80',
    selectedGlow: 'ring-2 ring-blue-500 border-blue-500 shadow-blue-500/20 bg-blue-500/5',
  },
  {
    id: 'classical_lite' as GameMode,
    name: 'Classical Lite',
    timeControl: '20 | 10',
    purpose: 'Deep calculation and positional understanding',
    entryPrice: 25000,
    difficulty: '⭐⭐⭐⭐⭐ Positional',
    image: '/game_modes/classical_lite.png',
    themeColor: 'border-indigo-500/30 text-indigo-400 shadow-indigo-500/5 hover:border-indigo-500/80',
    selectedGlow: 'ring-2 ring-indigo-500 border-indigo-500 shadow-indigo-500/20 bg-indigo-500/5',
  },
  {
    id: 'blitz' as GameMode,
    name: 'Blitz',
    timeControl: '5 | 3',
    purpose: 'Fast tactical battles',
    entryPrice: 50000,
    difficulty: '⚡⭐⭐⭐⭐ Blitz',
    image: '/game_modes/blitz.png',
    themeColor: 'border-amber-500/30 text-amber-400 shadow-amber-500/5 hover:border-amber-500/80',
    selectedGlow: 'ring-2 ring-amber-500 border-amber-500 shadow-amber-500/20 bg-amber-500/5',
  },
  {
    id: 'competitive_blitz' as GameMode,
    name: 'Competitive Blitz',
    timeControl: '3 | 2',
    purpose: 'High-skill online competitive format',
    entryPrice: 100000,
    difficulty: '⚡⭐⭐⭐⭐⭐ Speed',
    image: '/game_modes/competitive_blitz.png',
    themeColor: 'border-pink-500/30 text-pink-400 shadow-pink-500/5 hover:border-pink-500/80',
    selectedGlow: 'ring-2 ring-pink-500 border-pink-500 shadow-pink-500/20 bg-pink-500/5',
  },
  {
    id: 'bullet' as GameMode,
    name: 'Bullet',
    timeControl: '1 | 1',
    purpose: 'Reflexes and intuition under pressure',
    entryPrice: 500000,
    difficulty: '🔥 Bullet Master',
    image: '/game_modes/bullet.png',
    themeColor: 'border-red-500/30 text-red-400 shadow-red-500/5 hover:border-red-500/80',
    selectedGlow: 'ring-2 ring-red-500 border-red-500 shadow-red-500/20 bg-red-500/5',
  },
  {
    id: 'arena_bullet' as GameMode,
    name: 'Arena Bullet',
    timeControl: '1 min',
    purpose: 'Elite speed-chess specialists',
    entryPrice: 1000000,
    difficulty: '💀 Speed Demon',
    image: '/game_modes/arena_bullet.png',
    themeColor: 'border-fuchsia-500/30 text-fuchsia-400 shadow-fuchsia-500/5 hover:border-fuchsia-500/80',
    selectedGlow: 'ring-2 ring-fuchsia-500 border-fuchsia-500 shadow-fuchsia-500/20 bg-fuchsia-500/5',
  },
  {
    id: 'championship' as GameMode,
    name: 'Championship',
    timeControl: '30 | 20',
    purpose: 'Premium high-level chess',
    entryPrice: 5000000,
    difficulty: '💪🏻 Master',
    image: '/game_modes/championship.png',
    themeColor: 'border-yellow-500/30 text-yellow-400 shadow-yellow-500/5 hover:border-yellow-500/80',
    selectedGlow: 'ring-2 ring-yellow-500 border-yellow-500 shadow-yellow-500/20 bg-yellow-500/5',
  },
  {
    id: 'all_in' as GameMode,
    name: 'All In ‼️',
    timeControl: 'Player\'s Choice',
    purpose: 'All-In mode does not check rating or coins. Whoever is in the queue matches up. Winner claims total combined balance pool.',
    entryPrice: 'all_in',
    difficulty: '🌋 Maximum Risk',
    image: '/game_modes/all_in.png',
    themeColor: 'border-purple-500/40 text-purple-400 shadow-purple-500/10 hover:border-purple-500/80',
    selectedGlow: 'ring-2 ring-purple-500 border-purple-500 shadow-purple-500/30 bg-purple-500/10',
  },
  {
    id: 'practice' as GameMode,
    name: 'Practice',
    timeControl: 'No Timer',
    purpose: 'Practice your skills against an AI Chess Engine bot with selectable ELO rating and piece color.',
    entryPrice: 0,
    difficulty: '🤖 Bot Engine',
    image: '/game_modes/practice.png',
    themeColor: 'border-violet-500/30 text-violet-400 shadow-violet-500/5 hover:border-violet-500/80',
    selectedGlow: 'ring-2 ring-violet-500 border-violet-500 shadow-violet-500/20 bg-violet-500/5',
  }
];

export const PlayModal: React.FC<PlayModalProps> = ({ isOpen, onClose, pieceTheme, onStartSearch }) => {
  const { profile } = useAuth();
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [allInChoice, setAllInChoice] = useState<string>('10 | 5');
  const [practiceColor, setPracticeColor] = useState<'white' | 'black' | 'random'>('white');
  const userElo = (profile?.currentEloRating !== undefined ? profile.currentEloRating : profile?.rating) || 800;
  const [practiceElo, setPracticeElo] = useState<number>(Math.max(400, userElo));
  const carouselRef = useRef<HTMLDivElement>(null);

  // Sync user ELO on profile load
  useEffect(() => {
    if (profile?.currentEloRating !== undefined) {
      setPracticeElo(Math.max(400, profile.currentEloRating));
    } else if (profile?.rating) {
      setPracticeElo(Math.max(400, profile.rating));
    }
  }, [profile?.currentEloRating, profile?.rating]);

  const knightImgSrc = `/pieces/${pieceTheme || 'classic'}/wn.png`;

  // Auto-scroll selected card into center view
  useEffect(() => {
    if (isOpen && carouselRef.current) {
      const carousel = carouselRef.current;
      const children = carousel.children;
      if (children && children[selectedIndex]) {
        const selectedCardElement = children[selectedIndex] as HTMLElement;
        selectedCardElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center'
        });
      }
    }
  }, [selectedIndex, isOpen]);

  if (!isOpen) return null;

  const userBalance = (profile?.currentBalance !== undefined ? profile.currentBalance : profile?.bankBalance) || 0;
  const selectedMode = GAME_MODES_INFO[selectedIndex];

  const selectedStake = selectedMode.entryPrice === 'all_in' ? userBalance : (selectedMode.entryPrice as number);
  const isInsufficient = selectedMode.entryPrice === 'all_in' ? userBalance <= 0 : userBalance < (selectedMode.entryPrice as number);

  const getModeRules = (mode: GameMode, price: number | 'all_in') => {
    if (mode === 'practice') {
      return [
        "Bot Opponent: Play against an AI engine parameterized to your selected rating level.",
        "Free Play: No coins will be deducted from your wallet, and no payouts will be rewarded.",
        "Unrated: This match does not affect your chess Elo rating.",
        "Activity Feed: Your practice match outcomes will still be logged in your activity history."
      ];
    }

    if (mode === 'all_in') {
      return [
        "Bypasses Rating: Bypasses Elo rating limits; you can get matched against any player in the queue.",
        "Unequal Stakes Allowed: Matches even if balances differ. Each player puts their entire balance on the line.",
        "Total Pool Reward: Winner claims the combined sum of both players' stakes.",
        "Time Control Selectable: Queue entries use the time control you select here."
      ];
    }

    return [
      `Rating Constraints: Paired within your Elo bracket (+/- 100) to keep matches balanced.`,
      `Entry Fee: Deducts exactly ${formatCoins(price as number)} from your wallet.`,
      `Prize Pool: Winner claims double the entry fee (${formatCoins((price as number) * 2)}) directly to their wallet.`,
      `Rating Delta: Standard Elo points are updated dynamically upon match termination.`
    ];
  };

  const handleScroll = (direction: 'left' | 'right') => {
    if (direction === 'left') {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else {
      setSelectedIndex((prev) => Math.min(GAME_MODES_INFO.length - 1, prev + 1));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedMode.id !== 'practice' && (isInsufficient || selectedStake <= 0)) return;
    
    if (selectedMode.id === 'practice') {
      onStartSearch(
        'practice',
        0,
        undefined,
        { elo: practiceElo, color: practiceColor }
      );
    } else {
      const finalTC = selectedMode.id === 'all_in' ? allInChoice : undefined;
      onStartSearch(selectedMode.id, selectedStake, finalTC);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in">
      <div
        className="glass-card w-full max-w-4xl rounded-2xl overflow-hidden border border-white/10 flex flex-col shadow-2xl relative z-10 animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-slate-900/50">
          <div>
            <h3 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
              <img src={knightImgSrc} alt="Knight" className="w-5 h-5 object-contain animate-pulse" />
              <span>Select Your Arena Clash</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Wallet: <strong className="text-amber-400 font-mono">{formatCoins(userBalance)}</strong> &nbsp;•&nbsp; {GAME_MODES_INFO.length} formats available
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/8 rounded-lg transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Side-by-Side Content Grid */}
        <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-white/10 flex-grow overflow-hidden h-[460px] md:h-[440px]">
          
          {/* Left Column: Carousel Showcase (58% width) */}
          <div className="md:w-[58%] flex flex-col justify-center relative px-2 py-4 bg-slate-900/20">
            {/* Left Arrow */}
            <button
              onClick={() => handleScroll('left')}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-9 h-9 rounded-full bg-slate-950/85 hover:bg-violet-600 border border-white/10 text-slate-300 hover:text-white shadow-xl transition-all duration-200 cursor-pointer group hover:scale-105"
              aria-label="Scroll left"
            >
              <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
            </button>

            {/* Right Arrow */}
            <button
              onClick={() => handleScroll('right')}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-9 h-9 rounded-full bg-slate-950/85 hover:bg-violet-600 border border-white/10 text-slate-300 hover:text-white shadow-xl transition-all duration-200 cursor-pointer group hover:scale-105"
              aria-label="Scroll right"
            >
              <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
            </button>

            {/* Scrollable Track */}
            <div
              ref={carouselRef}
              className="flex gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory px-10 py-1.5 h-full items-center"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {GAME_MODES_INFO.map((modeInfo, idx) => {
                const isSelected = selectedIndex === idx;
                const hasBalance = modeInfo.entryPrice === 'all_in' ? userBalance > 0 : userBalance >= (modeInfo.entryPrice as number);
                const count = profile?.gameplayCounts?.[modeInfo.id] || 0;
                const isUnlocked = count >= 5;

                return (
                  <div
                    key={modeInfo.id}
                    onClick={() => setSelectedIndex(idx)}
                    className={`flex-shrink-0 w-[210px] h-[350px] rounded-2xl overflow-hidden cursor-pointer snap-center flex flex-col bg-slate-950/80 border border-white/5 relative transition-all duration-300 ${
                      isSelected
                        ? `ring-2 ${modeInfo.selectedGlow} scale-[1.02] shadow-2xl`
                        : 'opacity-50 hover:opacity-85 hover:scale-[1.01]'
                    }`}
                  >
                    {/* Image container with blurred backdrop */}
                    <div className="w-full h-32 relative overflow-hidden bg-slate-900/50 flex-shrink-0 border-b border-white/5">
                      <img
                        src={modeInfo.image}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover blur-md opacity-35 scale-110 pointer-events-none"
                      />
                      <img
                        src={modeInfo.image}
                        alt={modeInfo.name}
                        className="relative w-full h-full object-contain z-10 p-2 pointer-events-none"
                      />

                      {/* Difficulty tag */}
                      <div className="absolute top-2 left-2 z-20">
                        <span className="bg-black/75 backdrop-blur-md px-2 py-0.5 rounded-full text-[8px] font-bold text-slate-300 border border-white/5">
                          {modeInfo.difficulty}
                        </span>
                      </div>

                      {/* LOCKED badge */}
                      {!hasBalance && (
                        <div className="absolute top-2 right-2 z-20">
                          <span className="bg-red-950/90 border border-red-500/30 backdrop-blur-md px-2 py-0.5 rounded-full text-[8px] font-bold text-red-400 tracking-wider">
                            LOCKED
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Card Body */}
                    <div className="p-3 flex flex-col justify-between flex-grow space-y-2">
                      <div className="space-y-1">
                        <div className="flex items-start justify-between gap-1">
                          <h4 className="font-bold text-white text-xs leading-tight tracking-wide uppercase">{modeInfo.name}</h4>
                          <span className="flex-shrink-0 text-[9px] bg-violet-500/10 border border-violet-500/25 px-1.5 py-0.5 rounded font-mono font-semibold text-violet-300">
                            {modeInfo.id === 'all_in' ? allInChoice : modeInfo.timeControl}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-light leading-snug line-clamp-4 min-h-[48px]">
                          {modeInfo.purpose}
                        </p>
                      </div>

                      {/* Entry fee */}
                      <div className="flex items-center justify-between pt-1.5 border-t border-white/5">
                        <span className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Entry</span>
                        <div className="flex items-center space-x-1.5">
                          {modeInfo.entryPrice !== 'practice' && modeInfo.entryPrice !== 0 && (
                            <img src="/coin_pack/100 coins.png" alt="Coin" className="w-3.5 h-3.5 object-contain" />
                          )}
                          <span className="font-mono text-[10px] font-bold text-amber-400">
                            {modeInfo.entryPrice === 'practice' || modeInfo.entryPrice === 0
                              ? 'FREE'
                              : modeInfo.entryPrice === 'all_in'
                              ? 'ALL IN'
                              : formatCoins(modeInfo.entryPrice as number)}
                          </span>
                        </div>
                      </div>

                      {/* Milestone progress bar */}
                      {modeInfo.id !== 'practice' && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[9px] text-slate-500">
                            <span>Milestone</span>
                            <span className="font-mono font-bold text-slate-300">{count}/5</span>
                          </div>
                          <div className="w-full bg-white/5 rounded-full h-1 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                isUnlocked
                                  ? 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]'
                                  : 'bg-violet-500'
                              }`}
                              style={{ width: `${Math.min(100, (count / 5) * 100)}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Dedicated Detail Panel (42% width) */}
          <div className="md:w-[42%] flex flex-col justify-between p-5 bg-slate-950/50 overflow-y-auto">
            <div className="space-y-4">
              {/* Mode Header */}
              <div className="space-y-1">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-base font-extrabold text-white tracking-wide uppercase flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-violet-400 animate-pulse" />
                    <span>{selectedMode.name}</span>
                  </h3>
                  <span className="bg-white/5 border border-white/10 px-2 py-0.5 rounded text-[9px] font-bold text-slate-300">
                    {selectedMode.difficulty}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-light leading-relaxed">
                  {selectedMode.purpose}
                </p>
              </div>

              {/* Time Control Chooser (Inside Panel for All-In Mode) */}
              {selectedMode.id === 'all_in' && (
                <div className="space-y-2 border-t border-white/5 pt-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                    Choose Time Control
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['1 min', '3 | 2', '5 | 3', '10 | 5', '15 | 10', '30 | 10'].map((tc) => (
                      <button
                        key={tc}
                        type="button"
                        onClick={() => setAllInChoice(tc)}
                        className={`py-1.5 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${
                          allInChoice === tc
                            ? 'border-purple-500 bg-purple-500/20 text-purple-300'
                            : 'border-white/5 bg-slate-900/40 hover:bg-slate-900 text-slate-400'
                        }`}
                      >
                        {tc}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Bot settings (Inside Panel for Practice Mode) */}
              {selectedMode.id === 'practice' && (
                <div className="space-y-4 border-t border-white/5 pt-3 animate-fade-in">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block text-left">
                      Choose Bot's Elo
                    </label>
                    <div className="space-y-2 bg-slate-900/60 p-3 rounded-xl border border-white/5">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] text-slate-500 font-mono">400 ELO</span>
                        <span className="text-violet-400 font-bold text-xs bg-violet-500/10 px-2.5 py-0.5 rounded border border-violet-500/20 font-mono">
                          {practiceElo} ELO
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">2850 ELO</span>
                      </div>
                      <input
                        type="range"
                        min="400"
                        max="2850"
                        step="10"
                        value={practiceElo}
                        onChange={(e) => setPracticeElo(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-violet-500 border border-white/5"
                      />
                      <div className="text-[10px] font-medium text-slate-400 mt-1 text-center bg-white/5 py-1 px-2 rounded border border-white/5">
                        {practiceElo <= 1000 && "⭐ Beginner Bot (Depth 4-6)"}
                        {practiceElo > 1000 && practiceElo <= 1800 && "⭐⭐ Intermediate Bot (Depth 7-10)"}
                        {practiceElo > 1800 && practiceElo <= 2350 && "⭐⭐⭐ IM Eric Rosen / Levy Rozman level (Depth 12)"}
                        {practiceElo > 2350 && practiceElo <= 2750 && "⚡ GM Hikaru Nakamura level (Depth 18)"}
                        {practiceElo > 2750 && "💀 GM Magnus Carlsen level (Depth 20)"}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                      Choose Your Color
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'white', label: 'White' },
                        { id: 'random', label: 'Random' },
                        { id: 'black', label: 'Black' },
                      ].map((col) => (
                        <button
                          key={col.id}
                          type="button"
                          onClick={() => setPracticeColor(col.id as any)}
                          className={`py-2 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${
                            practiceColor === col.id
                              ? 'border-violet-500 bg-violet-500/20 text-violet-300'
                              : 'border-white/5 bg-slate-900/40 hover:bg-slate-900 text-slate-400'
                          }`}
                        >
                          {col.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Detailed Rules List */}
              <div className="space-y-2 border-t border-white/5 pt-3">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Arena Rules & Match Details
                </h4>
                <ul className="space-y-2">
                  {getModeRules(selectedMode.id, selectedMode.entryPrice as number | 'all_in').map((rule, rIdx) => (
                    <li key={rIdx} className="text-xs text-slate-300 flex items-start space-x-2">
                      <span className="text-violet-400 mt-0.5 shrink-0">•</span>
                      <span className="font-light leading-tight">{rule}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="pt-4 border-t border-white/5 space-y-3 mt-4 flex-shrink-0">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Total Play Stake:</span>
                <div className="flex items-center space-x-1.5">
                  {selectedMode.id !== 'practice' && (
                    <img src="/coin_pack/100 coins.png" alt="Coin" className="w-4 h-4 object-contain" />
                  )}
                  <span className="font-mono font-bold text-amber-400 text-sm">
                    {selectedMode.id === 'practice'
                      ? 'FREE'
                      : selectedMode.entryPrice === 'all_in'
                      ? `ALL IN (${formatCoins(userBalance)})`
                      : formatCoins(selectedMode.entryPrice as number)}
                  </span>
                </div>
              </div>

              {isInsufficient && selectedMode.id !== 'practice' ? (
                <div className="flex items-center space-x-1.5 text-red-400 text-xs bg-red-950/30 border border-red-900/30 p-2.5 rounded-lg justify-center font-medium">
                  <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                  <span>
                    {selectedMode.entryPrice === 'all_in'
                      ? 'No coins in wallet'
                      : `Needs ${formatCoins((selectedMode.entryPrice as number) - userBalance)} more`}
                  </span>
                </div>
              ) : (
                <button
                  onClick={handleSubmit}
                  className="w-full flex items-center justify-center space-x-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white py-2.5 rounded-xl font-bold shadow-lg shadow-violet-600/20 hover:shadow-violet-600/30 border border-violet-500/20 transition-all cursor-pointer text-xs uppercase tracking-wider"
                >
                  <span>{selectedMode.id === 'practice' ? 'Start Practice Match' : 'Find Match'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
