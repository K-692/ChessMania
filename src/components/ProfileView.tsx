import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { db } from '../firebase';
import { doc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { ChevronLeft, Trophy, Calendar, Gamepad2, Award, Percent, Star, Lock, Globe, X, LineChart } from 'lucide-react';
import type { RatingLedgerEntry } from '../types';

import { ACHIEVEMENTS, getBestAchievement } from '../utils/achievements';

const isCountryChangeLocked = (lastChangedAt?: number | null) => {
  if (!lastChangedAt) return false;
  const lastDate = new Date(lastChangedAt);
  const nowDate = new Date();
  return lastDate.getFullYear() === nowDate.getFullYear() && lastDate.getMonth() === nowDate.getMonth();
};

const getNextCalendarMonthStart = (lastChangedAt: number) => {
  const date = new Date(lastChangedAt);
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
};

const getCountryFlag = (countryName: string): string => {
  const normalized = countryName.trim().toLowerCase();
  const flagMap: Record<string, string> = {
    india: '🇮🇳',
    in: '🇮🇳',
    'united states': '🇺🇸',
    usa: '🇺🇸',
    us: '🇺🇸',
    'united kingdom': '🇬🇧',
    uk: '🇬🇧',
    gb: '🇬🇧',
    england: '🇬🇧',
    canada: '🇨🇦',
    ca: '🇨🇦',
    australia: '🇦🇺',
    au: '🇦🇺',
    germany: '🇩🇪',
    de: '🇩🇪',
    france: '🇫🇷',
    fr: '🇫🇷',
    italy: '🇮🇹',
    it: '🇮🇹',
    spain: '🇪🇸',
    es: '🇪🇸',
    japan: '🇯🇵',
    jp: '🇯🇵',
    china: '🇨🇳',
    cn: '🇨🇳',
    brazil: '🇧🇷',
    br: '🇧🇷',
    russia: '🇷🇺',
    ru: '🇷🇺',
    mexico: '🇲🇽',
    mx: '🇲🇽',
    netherlands: '🇳🇱',
    nl: '🇳🇱',
    switzerland: '🇨🇭',
    ch: '🇨🇭',
    sweden: '🇸🇪',
    se: '🇸🇪',
    norway: '🇳🇴',
    no: '🇳🇴',
    finland: '🇫🇮',
    fi: '🇫🇮',
    denmark: '🇩🇰',
    dk: '🇩🇰',
    singapore: '🇸🇬',
    sg: '🇸🇬',
    'new zealand': '🇳🇿',
    nz: '🇳🇿',
    'south africa': '🇿🇦',
    za: '🇿🇦',
    'south korea': '🇰🇷',
    kr: '🇰🇷'
  };
  return flagMap[normalized] || '🏳️';
};

interface ProfileViewProps {
  onBack: () => void;
}

const MODE_DETAILS: Record<string, { label: string; price: string; tc: string }> = {
  beginner: { label: 'Beginner', price: '100 Coins', tc: '15 min' },
  casual_rapid: { label: 'Casual Rapid', price: '500 Coins', tc: '10 min' },
  standard_rapid: { label: 'Standard Rapid', price: '2.5K Coins', tc: '10 | 5' },
  competitive_rapid: { label: 'Competitive Rapid', price: '10K Coins', tc: '15 | 10' },
  classical_lite: { label: 'Classical Lite', price: '25K Coins', tc: '20 | 10' },
  blitz: { label: 'Blitz', price: '50K Coins', tc: '5 | 3' },
  competitive_blitz: { label: 'Competitive Blitz', price: '100K Coins', tc: '3 | 2' },
  bullet: { label: 'Bullet', price: '500K Coins', tc: '1 | 1' },
  arena_bullet: { label: 'Arena Bullet', price: '1M Coins', tc: '1 min' },
  championship: { label: 'Championship', price: '5M Coins', tc: '30 | 20' },
  all_in: { label: 'All In ‼️', price: 'Entire Balance', tc: "Player's Choice" }
};

export const ProfileView: React.FC<ProfileViewProps> = ({ onBack }) => {
  const { user, profile } = useAuth();
  const [isEditCountryOpen, setIsEditCountryOpen] = useState(false);
  const [countryInput, setCountryInput] = useState('');
  const [savingCountry, setSavingCountry] = useState(false);
  const [countryError, setCountryError] = useState('');

  // Elo rating history states
  const [ratingHistory, setRatingHistory] = useState<{ date: string; elo: number }[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; date: string; elo: number } | null>(null);

  useEffect(() => {
    if (!user || !profile) return;
    const fetchRatingHistory = async () => {
      try {
        const ratingLedgerRef = collection(db, 'ratingLedger');
        const q = query(ratingLedgerRef, where('uid', '==', user.uid));
        const snap = await getDocs(q);

        const entries = snap.docs.map(docSnap => docSnap.data() as RatingLedgerEntry);
        entries.sort((a, b) => a.createdAt - b.createdAt);

        let current = profile.rating;
        const history: { date: string; elo: number }[] = [];

        history.push({
          date: 'Now',
          elo: current
        });

        for (let i = entries.length - 1; i >= 0; i--) {
          current = Math.max(0, current - entries[i].delta);
          const dateStr = new Date(entries[i].createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          history.push({
            date: dateStr,
            elo: current
          });
        }

        history.reverse();

        if (history.length === 0) {
          history.push({
            date: new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            elo: profile.rating
          });
        }

        setRatingHistory(history);
      } catch (err) {
        console.warn("Failed to fetch rating history:", err);
      } finally {
        setLoadingHistory(false);
      }
    };

    fetchRatingHistory();
  }, [user, profile?.rating, profile?.createdAt]);

  const handleOpenEditCountry = () => {
    setCountryInput(profile?.country || '');
    setCountryError('');
    setIsEditCountryOpen(true);
  };

  const handleSaveCountry = async () => {
    if (!user || !profile) return;
    
    if (isCountryChangeLocked(profile.lastCountryChangedAt)) {
      setCountryError('Your represented country is currently locked this month.');
      return;
    }

    const trimmed = countryInput.trim();
    if (!trimmed) {
      setCountryError('Country name cannot be empty.');
      return;
    }

    setSavingCountry(true);
    setCountryError('');

    try {
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        country: trimmed,
        lastCountryChangedAt: Date.now()
      });
      setIsEditCountryOpen(false);
    } catch (err: any) {
      console.error('Error saving country:', err);
      setCountryError(err.message || 'Failed to update country. Please try again.');
    } finally {
      setSavingCountry(false);
    }
  };

  if (!user || !profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400">Loading profile details...</p>
      </div>
    );
  }

  // Calculate totals
  const wins = profile.wins || 0;
  const losses = profile.losses || 0;
  const draws = profile.draws || 0;
  const totalGames = wins + losses + draws;
  const winRate = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(1) : '0';

  // Get best achievement
  const bestAch = getBestAchievement(profile.gameplayCounts);

  // Parse Join Date
  const joinDate = new Date(profile.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long'
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8 text-left animate-fade-in">
      {/* Header Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center space-x-2 text-slate-400 hover:text-white transition-colors text-sm font-medium cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back to Play</span>
        </button>
      </div>

      {/* Profile Header Card */}
      <div className="glass p-6 sm:p-8 rounded-2xl border border-white/5 relative overflow-hidden shadow-2xl">
        {/* Glowing Background Glows */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-amber-600/5 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20" />

        <div className="flex flex-col md:flex-row items-center md:items-start gap-6 md:gap-8 relative z-10">
          {/* Avatar with Glow based on best achievement */}
          <div className="relative flex-shrink-0">
            <img
              src={profile.photoURL || user.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=150&h=150&fit=crop'}
              alt={profile.displayName}
              className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover ring-4 ring-white/10 shadow-2xl relative z-10"
            />
            <div className="absolute -bottom-2 -right-2 flex flex-col gap-1 items-end z-20">
              {profile.rating >= 2500 && (
                <span className="font-serif font-extrabold tracking-wider bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-500 bg-clip-text text-transparent drop-shadow-[0_0_8px_rgba(251,191,36,0.8)] border border-amber-400/60 bg-amber-950 px-2 py-0.5 rounded text-[10px] font-bold shadow-md">
                  GM
                </span>
              )}
              {bestAch && (
                <span className="bg-slate-900 border border-white/15 px-2 py-0.5 rounded-full text-xs font-bold text-slate-200 shadow-md flex items-center gap-1">
                  {bestAch.badge.split(' ')[0]} {bestAch.badge.split(' ')[1]}
                </span>
              )}
            </div>
          </div>

          {/* User Meta Data */}
          <div className="flex-grow space-y-3 text-center md:text-left">
            <div className="space-y-1">
              <h2 className="text-3xl font-extrabold tracking-wide text-white flex flex-wrap items-center justify-center md:justify-start gap-3">
                <span>{profile.displayName}</span>
                {profile.rating >= 2500 && (
                  <span className="font-serif font-extrabold tracking-wider bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-500 bg-clip-text text-transparent drop-shadow-[0_0_8px_rgba(251,191,36,0.8)] border border-amber-400/60 bg-amber-950/40 px-2.5 py-0.5 rounded-lg text-xs font-bold select-none animate-pulse" title="Grandmaster (Rating 2500+)">
                    GM
                  </span>
                )}
                {bestAch && (
                  <span className={`px-2.5 py-0.5 rounded-lg text-xs font-bold border ${bestAch.color.split(' ')[0]} ${bestAch.color.split(' ')[1]} ${bestAch.color.split(' ')[2]}`} title={bestAch.description}>
                    {bestAch.name}
                  </span>
                )}
              </h2>
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-4 gap-y-1 text-sm text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-violet-400" />
                  <span>Joined {joinDate}</span>
                </span>
                <span className="text-slate-600 hidden sm:inline">•</span>
                <span className="flex items-center gap-1.5">
                  <Trophy className="w-4 h-4 text-amber-400" />
                  <span>Elo: <strong className="text-amber-300 font-mono">{profile.rating}</strong></span>
                </span>
                <span className="text-slate-600 hidden sm:inline">•</span>
                <span className="flex items-center gap-1.5 bg-slate-900/40 px-2 py-0.5 rounded-lg border border-white/5 text-xs text-slate-300">
                  <span className="text-sm select-none mr-1">{getCountryFlag(profile.country || '')}</span>
                  <span>{profile.country || 'No Represented Country'}</span>
                  <button
                    onClick={handleOpenEditCountry}
                    className="ml-2 text-xs text-violet-400 hover:text-violet-300 underline cursor-pointer"
                  >
                    Edit
                  </button>
                </span>
              </div>
            </div>

            {bestAch ? (
              <p className="text-sm text-slate-300 bg-white/5 border border-white/5 px-4 py-2 rounded-xl inline-block max-w-xl font-light">
                🏆 <strong className="text-violet-300">Highest Accolade Unlocked:</strong> {bestAch.description}
              </p>
            ) : (
              <p className="text-sm text-slate-400 italic">
                Play 5 games in any format to unlock your first achievement milestone badge!
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Elo Rating Card */}
        <div className="glass p-5 rounded-xl border border-white/5 flex items-center space-x-4">
          <div className="p-3 bg-violet-500/10 rounded-xl border border-violet-500/20 text-violet-400">
            <Trophy className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-semibold">Chess Rating</span>
            <span className="text-2xl font-black font-mono text-violet-300">{profile.rating} Elo</span>
          </div>
        </div>

        {/* Total Coins Earned Card */}
        <div className="glass p-5 rounded-xl border border-white/5 flex items-center space-x-4">
          <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-400 flex items-center justify-center w-12 h-12">
            <img src="/coin_pack/100 coins.png" alt="Coin" className="w-6 h-6 object-contain" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-semibold">Total Coins Earned</span>
            <span className="text-2xl font-black font-mono text-amber-400 flex items-center gap-1.5 whitespace-nowrap">
              <span>{(profile.totalCoinsEarned ?? profile.bankBalance).toLocaleString()}</span>
              <img src="/coin_pack/100 coins.png" alt="Coin" className="w-5 h-5 object-contain" />
            </span>
          </div>
        </div>

        {/* Gameplay Summary Card */}
        <div className="glass p-5 rounded-xl border border-white/5 flex items-center space-x-4">
          <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 text-blue-400">
            <Gamepad2 className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-semibold">Total Gameplays</span>
            <span className="text-2xl font-black font-mono text-blue-300">{totalGames} Games</span>
          </div>
        </div>

        {/* Win Rate Card */}
        <div className="glass p-5 rounded-xl border border-white/5 flex items-center space-x-4">
          <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
            <Percent className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-semibold">Win Rate Ratio</span>
            <span className="text-2xl font-black font-mono text-emerald-300">{winRate}%</span>
          </div>
        </div>
      </div>

      {/* Elo Rating History Chart */}
      <div className="glass p-6 rounded-xl border border-white/5 space-y-5 relative">
        <h3 className="text-base font-bold text-slate-200 flex items-center gap-2">
          <LineChart className="w-5 h-5 text-violet-400" />
          <span>Elo Evolution History</span>
        </h3>

        {loadingHistory ? (
          <div className="h-[200px] flex items-center justify-center text-xs text-slate-500">
            Reconstructing rating timeline...
          </div>
        ) : ratingHistory.length <= 1 ? (
          <div className="h-[200px] flex flex-col items-center justify-center text-xs text-slate-500 italic space-y-2 text-center">
            <span>Not enough matches played yet to chart Elo history.</span>
            <span>Play rated matches to see your progress!</span>
          </div>
        ) : (
          <div className="relative w-full h-[220px] bg-slate-950/20 rounded-xl border border-white/5 p-4 flex items-center justify-center">
            {/* SVG Plot */}
            {(() => {
              const width = 500;
              const height = 180;
              const paddingLeft = 40;
              const paddingRight = 20;
              const paddingTop = 20;
              const paddingBottom = 30;
              const chartWidth = width - paddingLeft - paddingRight;
              const chartHeight = height - paddingTop - paddingBottom;

              const elos = ratingHistory.map((h) => h.elo);
              const maxElo = Math.max(...elos);
              const minElo = Math.min(...elos);
              const yMax = maxElo + 25;
              const yMin = Math.max(0, minElo - 25);
              const eloRange = yMax - yMin || 100;

              const points = ratingHistory.map((h, idx) => {
                const x = paddingLeft + (idx * chartWidth) / (ratingHistory.length - 1 || 1);
                const y = paddingTop + chartHeight - ((h.elo - yMin) * chartHeight) / eloRange;
                return { x, y, ...h };
              });

              const pathD = points.reduce((acc, p, idx) => {
                return idx === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
              }, '');

              const areaD = points.length > 0 
                ? `${pathD} L ${points[points.length - 1].x} ${height - paddingBottom} L ${points[0].x} ${height - paddingBottom} Z` 
                : '';

              const gridValues = [yMin, Math.round(yMin + eloRange / 2), yMax];

              return (
                <div className="w-full h-full relative">
                  <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
                    <defs>
                      <linearGradient id="chartLineGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#8b5cf6" />
                        <stop offset="100%" stopColor="#6366f1" />
                      </linearGradient>
                      <linearGradient id="chartAreaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.2" />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal Gridlines */}
                    {gridValues.map((val, idx) => {
                      const y = paddingTop + chartHeight - ((val - yMin) * chartHeight) / eloRange;
                      return (
                        <g key={idx} className="opacity-30">
                          <line
                            x1={paddingLeft}
                            y1={y}
                            x2={width - paddingRight}
                            y2={y}
                            stroke="#475569"
                            strokeWidth="1"
                            strokeDasharray="4 4"
                          />
                          <text
                            x={paddingLeft - 8}
                            y={y + 3}
                            fill="#94a3b8"
                            fontSize="8"
                            textAnchor="end"
                            className="font-mono"
                          >
                            {val}
                          </text>
                        </g>
                      );
                    })}

                    {/* Timeline Line Path */}
                    <path
                      d={pathD}
                      fill="none"
                      stroke="url(#chartLineGrad)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />

                    {/* Area under the line */}
                    <path d={areaD} fill="url(#chartAreaGrad)" />

                    {/* Timeline Data Circles */}
                    {points.map((p, idx) => {
                      const isHovered = hoveredPoint?.date === p.date && hoveredPoint?.elo === p.elo;
                      return (
                        <circle
                          key={idx}
                          cx={p.x}
                          cy={p.y}
                          r={isHovered ? 5.5 : 3.5}
                          fill={isHovered ? '#8b5cf6' : '#a78bfa'}
                          stroke="#ffffff"
                          strokeWidth={isHovered ? 2 : 1}
                          className="transition-all cursor-pointer"
                          onMouseEnter={() => setHoveredPoint(p)}
                          onMouseLeave={() => setHoveredPoint(null)}
                        />
                      );
                    })}
                  </svg>

                  {/* Tooltip Overlay */}
                  {hoveredPoint && (
                    <div
                      className="absolute bg-slate-900/95 backdrop-blur border border-violet-500/30 text-white rounded-lg px-2.5 py-1.5 shadow-2xl pointer-events-none text-left z-20 animate-scale-up"
                      style={{
                        left: `${((hoveredPoint.x - paddingLeft) / chartWidth) * 100}%`,
                        top: `${((hoveredPoint.y - paddingTop) / chartHeight) * 100 - 30}%`,
                        transform: 'translate(-50%, -100%)',
                      }}
                    >
                      <p className="text-[8px] text-slate-400 uppercase tracking-widest font-semibold">{hoveredPoint.date}</p>
                      <p className="text-xs font-black text-violet-300 font-mono">{hoveredPoint.elo} Elo</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Matchmaking Statistics details & Record */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Record Breakout */}
        <div className="glass p-6 rounded-xl border border-white/5 space-y-4">
          <h3 className="text-base font-bold text-slate-200 flex items-center gap-2">
            <Star className="w-5 h-5 text-amber-400" />
            <span>Match Outcome Records</span>
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <span className="text-sm text-slate-400">Wins</span>
              <span className="text-sm font-bold text-emerald-400 font-mono">{wins}</span>
            </div>
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <span className="text-sm text-slate-400">Losses</span>
              <span className="text-sm font-bold text-red-400 font-mono">{losses}</span>
            </div>
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <span className="text-sm text-slate-400">Draws</span>
              <span className="text-sm font-bold text-slate-400 font-mono">{draws}</span>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-sm text-slate-300 font-semibold">Total Settled</span>
              <span className="text-sm font-black text-violet-300 font-mono">{totalGames}</span>
            </div>
          </div>
        </div>

        {/* Gameplay counts by mode */}
        <div className="glass p-6 rounded-xl border border-white/5 md:col-span-2 space-y-4">
          <h3 className="text-base font-bold text-slate-200 flex items-center gap-2">
            <Gamepad2 className="w-5 h-5 text-violet-400" />
            <span>Arena Gameplay Frequency Counts</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[190px] overflow-y-auto scrollbar-thin pr-2">
            {Object.keys(MODE_DETAILS).map((modeKey) => {
              const details = MODE_DETAILS[modeKey];
              const plays = profile.gameplayCounts?.[modeKey] || 0;
              return (
                <div key={modeKey} className="flex items-center justify-between bg-slate-950/35 border border-white/5 px-3.5 py-2.5 rounded-lg">
                  <div>
                    <span className="text-xs font-bold text-slate-300 block">{details.label}</span>
                    <span className="text-[10px] text-slate-500 font-mono">{details.tc} • Entry: {details.price}</span>
                  </div>
                  <span className="text-xs font-bold font-mono bg-white/5 px-2 py-1 rounded text-violet-300">
                    {plays} {plays === 1 ? 'play' : 'plays'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Achievement Badges Showcase */}
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-slate-200 flex items-center gap-2">
            <Award className="w-5 h-5 text-violet-400" />
            <span>Arena Milestone Achievements</span>
          </h3>
          <p className="text-xs text-slate-500">
            Unlocking an achievement requires playing 5 matches in that specific game mode. Unlocked badges display next to your name.
          </p>
        </div>

        {/* GM — Special Elo-Based Achievement Card */}
        <div className={`relative glass p-5 rounded-xl border transition-all duration-300 overflow-hidden ${
          profile.rating >= 2500
            ? 'border-amber-500/50 bg-gradient-to-r from-amber-950/20 via-yellow-950/10 to-amber-950/20 shadow-lg shadow-amber-500/10'
            : 'border-white/5 opacity-50'
        }`}>
          {/* Gold shimmer effect on unlock */}
          {profile.rating >= 2500 && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-400/5 to-transparent animate-[shimmer_3s_ease-in-out_infinite]" />
            </div>
          )}
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* GM badge preview */}
              <div className={`flex items-center justify-center w-14 h-14 rounded-xl border text-2xl font-serif font-black tracking-widest select-none ${
                profile.rating >= 2500
                  ? 'border-amber-400/50 bg-amber-950/40 bg-gradient-to-br from-amber-400/10 to-yellow-500/5 shadow-[0_0_20px_rgba(251,191,36,0.3)]'
                  : 'border-white/5 bg-white/3'
              }`}>
                {profile.rating >= 2500 ? (
                  <span className="bg-gradient-to-b from-amber-300 via-yellow-200 to-amber-500 bg-clip-text text-transparent drop-shadow-[0_0_8px_rgba(251,191,36,0.9)] animate-pulse">
                    GM
                  </span>
                ) : (
                  <span className="text-slate-600 text-lg">GM</span>
                )}
              </div>

              <div className="space-y-0.5 text-left">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-slate-200">Grandmaster</span>
                  {profile.rating >= 2500 ? (
                    <span className="bg-amber-950/60 border border-amber-500/30 px-2 py-0.5 rounded text-[9px] font-bold text-amber-400 tracking-wider uppercase">
                      UNLOCKED
                    </span>
                  ) : (
                    <span className="bg-slate-900 border border-white/5 px-2 py-0.5 rounded text-[9px] font-bold text-slate-500 tracking-wider uppercase">
                      LOCKED
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 font-light max-w-md">
                  {profile.rating >= 2500
                    ? 'You have reached the pinnacle of chess mastery. The GM title is displayed alongside your name everywhere.'
                    : `Achieve a rating of 2500 Elo to unlock the Grandmaster title. Currently at ${profile.rating} Elo (${Math.max(0, 2500 - profile.rating)} to go).`}
                </p>
              </div>
            </div>

            {/* Elo progress bar to 2500 */}
            <div className="hidden sm:flex flex-col items-end gap-1.5 shrink-0 min-w-[100px]">
              <span className="text-[10px] text-slate-500 font-mono font-semibold">{Math.min(profile.rating, 2500)} / 2500 Elo</span>
              <div className="w-24 bg-slate-950 rounded-full h-1.5 overflow-hidden border border-white/5">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    profile.rating >= 2500
                      ? 'bg-gradient-to-r from-amber-500 to-yellow-300 shadow-[0_0_6px_rgba(251,191,36,0.7)]'
                      : 'bg-violet-600'
                  }`}
                  style={{ width: `${Math.min(100, (profile.rating / 2500) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ACHIEVEMENTS.map((ach) => {
            const count = profile.gameplayCounts?.[ach.id] || 0;
            const isUnlocked = count >= 5;
            const remaining = Math.max(0, 5 - count);

            return (
              <div
                key={ach.id}
                className={`glass p-5 rounded-xl border flex flex-col justify-between transition-all duration-300 hover:scale-[1.01] ${
                  isUnlocked
                    ? `${ach.color} border-white/10`
                    : 'border-white/5 opacity-60 hover:opacity-85'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-slate-200">{ach.name}</span>
                    {isUnlocked ? (
                      <span className="bg-emerald-950/50 border border-emerald-500/20 px-2 py-0.5 rounded text-[9px] font-bold text-emerald-400 tracking-wider">
                        UNLOCKED
                      </span>
                    ) : (
                      <span className="bg-slate-900 border border-white/5 px-2 py-0.5 rounded text-[9px] font-bold text-slate-400 tracking-wider">
                        LOCKED
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 leading-normal min-h-[32px] font-light">
                    {ach.description}
                  </p>
                </div>

                {/* Progress Tracks */}
                <div className="mt-4 pt-3 border-t border-white/5 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>Milestone Progress</span>
                    <span className="font-mono font-semibold text-slate-300">{count}/5 games</span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-white/5">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isUnlocked ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]' : 'bg-violet-600'
                      }`}
                      style={{ width: `${Math.min(100, (count / 5) * 100)}%` }}
                    />
                  </div>
                  {!isUnlocked && (
                    <p className="text-[9px] text-slate-500 text-right font-medium">
                      Need {remaining} more {remaining === 1 ? 'game' : 'games'} to unlock
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Edit Country Modal */}
      {isEditCountryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm px-4">
          <div className="glass max-w-md w-full rounded-2xl border border-white/10 p-6 shadow-2xl relative flex flex-col text-left">
            <button
              onClick={() => setIsEditCountryOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-2">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Globe className="w-5 h-5 text-violet-400" />
                <span>Represent Country</span>
              </h3>
              <p className="text-xs text-slate-400">
                Choose the country you want to represent. This can only be updated once per calendar month.
              </p>
            </div>

            <div className="mt-4">
              {(() => {
                const isLocked = isCountryChangeLocked(profile.lastCountryChangedAt);
                if (isLocked && profile.lastCountryChangedAt) {
                  const unlockDate = getNextCalendarMonthStart(profile.lastCountryChangedAt);
                  return (
                    <div className="bg-amber-950/20 border border-amber-500/10 rounded-xl p-4 space-y-3">
                      <div className="flex items-center space-x-2 text-amber-400 font-semibold text-xs">
                        <Lock className="w-4 h-4 animate-pulse" />
                        <span>Country Edit Locked</span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        You have already set your country representation for this calendar month. You can update it again in the next month.
                      </p>
                      <div className="flex items-center space-x-2 text-[10px] text-slate-500">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>Available on: <strong className="text-slate-400">{unlockDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</strong></span>
                      </div>
                      <button
                        onClick={() => setIsEditCountryOpen(false)}
                        className="w-full mt-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2.5 rounded-lg transition-all cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                  );
                }

                return (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Country Name
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. India, United States"
                        value={countryInput}
                        onChange={(e) => setCountryInput(e.target.value)}
                        className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500"
                        maxLength={50}
                        disabled={savingCountry}
                      />
                    </div>

                    {countryError && (
                      <p className="text-xs text-red-400 font-semibold">{countryError}</p>
                    )}

                    <div className="flex gap-3">
                      <button
                        onClick={() => setIsEditCountryOpen(false)}
                        className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold py-2.5 rounded-lg transition-all border border-white/5 cursor-pointer text-center"
                        disabled={savingCountry}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveCountry}
                        className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-bold py-2.5 rounded-lg transition-all border border-violet-500/20 cursor-pointer text-center shadow-lg shadow-violet-600/10"
                        disabled={savingCountry}
                      >
                        {savingCountry ? 'Saving...' : 'Represent'}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
