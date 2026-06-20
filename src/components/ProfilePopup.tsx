import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { UserProfile } from '../types';
import { getBestAchievement } from '../utils/achievements';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../auth/AuthContext';

interface ProfilePopupProps {
  profile: UserProfile;
  onClose: () => void;
}

const getCountryFlag = (countryName?: string): string => {
  if (!countryName) return '🏳️';
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

export const ProfilePopup: React.FC<ProfilePopupProps> = ({ profile, onClose }) => {
  const { user } = useAuth();
  const [h2h, setH2h] = useState<{ wins: number; losses: number; draws: number } | null>(null);
  const bestAch = getBestAchievement(profile.gameplayCounts);

  useEffect(() => {
    if (!user || user.uid === profile.uid || profile.uid.startsWith('bot_')) {
      setH2h(null);
      return;
    }

    const fetchH2H = async () => {
      try {
        const pair = [user.uid, profile.uid].sort().join('_');
        const q = query(
          collection(db, 'matches'),
          where('playerPair', '==', pair)
        );
        const snap = await getDocs(q);
        let wins = 0;
        let losses = 0;
        let draws = 0;
        snap.forEach((docSnap) => {
          const matchData = docSnap.data();
          if (matchData.status === 'active') return;
          const isDraw = matchData.status === 'draw' || matchData.status === 'stalemate';
          if (isDraw) {
            draws++;
          } else if (matchData.winnerUid === user.uid) {
            wins++;
          } else if (matchData.winnerUid) {
            losses++;
          }
        });
        setH2h({ wins, losses, draws });
      } catch (err) {
        console.warn('Failed to fetch head-to-head records:', err);
      }
    };

    fetchH2H();
  }, [user, profile.uid]);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4" style={{ zIndex: 10000 }}>
      <div className="glass w-full max-w-sm rounded-2xl border border-white/10 flex flex-col shadow-2xl p-6 text-left space-y-4 max-h-[calc(100vh-120px)] overflow-y-auto relative animate-fade-in">
        <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
          <h3 className="text-sm font-bold text-slate-200">User Profile Details</h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="flex items-center space-x-3">
          <img
            src={profile.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop'}
            alt={profile.displayName}
            className="w-14 h-14 rounded-full object-cover ring-2 ring-violet-500/50"
          />
          <div className="space-y-0.5">
            <h4 className="text-base font-bold text-white flex items-center gap-1.5 flex-wrap">
              <span>{profile.displayName}</span>
              {profile.currentEloRating >= 2500 && (
                <span className="font-serif font-extrabold bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-500 bg-clip-text text-transparent border border-amber-400/60 bg-amber-950/40 px-1 rounded text-[7px] uppercase" title="Grandmaster">
                  GM
                </span>
              )}
              {profile.country && (
                <span className="text-xs" title={`Representing ${profile.country}`}>
                  {getCountryFlag(profile.country)}
                </span>
              )}
            </h4>
            <p className="text-[10px] text-slate-400 font-mono">Member since: {new Date(profile.createdAt).toLocaleDateString()}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-900/60 border border-white/5 p-2 rounded-lg text-center">
            <p className="text-[8px] text-slate-500 uppercase tracking-wider">Elo Rating</p>
            <p className="text-base font-bold text-violet-300 mt-0.5">{profile.currentEloRating}</p>
          </div>
          <div className="bg-slate-900/60 border border-white/5 p-2 rounded-lg text-center flex flex-col justify-center items-center">
            <p className="text-[8px] text-slate-500 uppercase tracking-wider">Coins Balance</p>
            <div className="flex items-center space-x-1 mt-0.5">
              <span className="text-base font-bold text-amber-400 font-mono">{profile.currentBalance.toLocaleString()}</span>
              <img src="/coin_pack/100 coins.png" alt="Coin" className="w-3.5 h-3.5 object-contain" />
            </div>
          </div>
        </div>

        <div className="bg-slate-900/60 border border-white/5 p-3 rounded-xl space-y-2">
          <h5 className="text-[10px] font-semibold text-slate-300 uppercase tracking-wide border-b border-white/5 pb-1">Record</h5>
          <div className="grid grid-cols-3 gap-1 text-center text-xs">
            <div className="text-emerald-400 font-bold">
              <p className="text-[8px] text-slate-500 uppercase">Wins</p>
              <p className="text-xs mt-0.5">{profile.wins || 0}</p>
            </div>
            <div className="text-red-400 font-bold">
              <p className="text-[8px] text-slate-500 uppercase">Losses</p>
              <p className="text-xs mt-0.5">{profile.losses || 0}</p>
            </div>
            <div className="text-slate-400 font-bold">
              <p className="text-[8px] text-slate-500 uppercase">Draws</p>
              <p className="text-xs mt-0.5">{profile.draws || 0}</p>
            </div>
          </div>
        </div>

        {h2h && (
          <div className="bg-slate-900/60 border border-white/5 p-3 rounded-xl space-y-2 animate-fade-in">
            <h5 className="text-[10px] font-semibold text-slate-300 uppercase tracking-wide border-b border-white/5 pb-1">H2H Record (vs you)</h5>
            <div className="grid grid-cols-3 gap-1 text-center text-xs">
              <div className="text-emerald-400 font-bold">
                <p className="text-[8px] text-slate-500 uppercase">Wins</p>
                <p className="text-xs mt-0.5">{h2h.wins}</p>
              </div>
              <div className="text-red-400 font-bold">
                <p className="text-[8px] text-slate-500 uppercase">Losses</p>
                <p className="text-xs mt-0.5">{h2h.losses}</p>
              </div>
              <div className="text-slate-400 font-bold">
                <p className="text-[8px] text-slate-500 uppercase">Draws</p>
                <p className="text-xs mt-0.5">{h2h.draws}</p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-slate-900/60 border border-white/5 p-3 rounded-xl space-y-2">
          <h5 className="text-[10px] font-semibold text-slate-300 uppercase tracking-wide border-b border-white/5 pb-1">Best Achievement</h5>
          {bestAch ? (
            <div className="flex items-center space-x-2.5 bg-violet-950/20 border border-violet-500/20 p-2 rounded-lg">
              <span className="text-xl">{bestAch.badge.split(' ')[0]}</span>
              <div className="text-left">
                <p className="text-xs font-bold text-violet-300">{bestAch.name}</p>
                <p className="text-[9px] text-slate-400 leading-tight">{bestAch.description}</p>
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-slate-500 italic text-center">No achievements unlocked yet.</p>
          )}
        </div>
      </div>
    </div>
  );
};
