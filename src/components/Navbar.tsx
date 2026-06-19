import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { LogIn, LogOut, Volume2, VolumeX, Plus } from 'lucide-react';
import { formatCoins } from '../utils/format';
import { getBestAchievement } from '../utils/achievements';
import { getSoundSettings, updateSoundSettings } from '../utils/sound';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

interface NavbarProps {
  onNavigate: (view: 'dashboard' | 'ledger' | 'leaderboard' | 'profile' | 'social' | 'settings') => void;
  currentView: string;
  isGameActive?: boolean;
  onAddFunds?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onNavigate, currentView, isGameActive = false, onAddFunds }) => {
  const { user, profile, login, logout, loading } = useAuth();
  const [muted, setMuted] = useState(() => getSoundSettings().muted);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const currentMuted = getSoundSettings().muted;
      if (currentMuted !== muted) {
        setMuted(currentMuted);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [muted]);

  useEffect(() => {
    if (!user) {
      setPendingCount(0);
      return;
    }

    let fCount = 0;
    let cCount = 0;

    const qFriendships = query(
      collection(db, 'friendships'),
      where('receiverUid', '==', user.uid),
      where('status', '==', 'pending')
    );
    const unsubFriendships = onSnapshot(qFriendships, (snap) => {
      fCount = snap.size;
      setPendingCount(fCount + cCount);
    }, (err) => {
      console.warn("Error listening to pending friendships in Navbar:", err);
    });

    const qChallenges = query(
      collection(db, 'challenges'),
      where('challengedUid', '==', user.uid),
      where('status', '==', 'pending')
    );
    const unsubChallenges = onSnapshot(qChallenges, (snap) => {
      cCount = snap.size;
      setPendingCount(fCount + cCount);
    }, (err) => {
      console.warn("Error listening to pending challenges in Navbar:", err);
    });

    return () => {
      unsubFriendships();
      unsubChallenges();
    };
  }, [user]);

  const toggleMute = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    updateSoundSettings({ muted: nextMuted });
  };

  return (
    <nav className="glass sticky top-0 z-50 flex items-center justify-between px-6 py-4 border-b border-white/5 backdrop-blur-md">
      <div 
        className="flex items-center space-x-3 cursor-pointer"
        onClick={() => {
          if (!isGameActive) {
            onNavigate('dashboard');
          }
        }}
      >
        <div className="flex items-center justify-center bg-slate-900/60 p-0.5 rounded-xl shadow-lg border border-white/5 overflow-hidden w-11 h-11 shrink-0">
          <img src="/game_logo.png" alt="Check & Mate Logo" className="w-full h-full object-cover" />
        </div>
        <div className="flex flex-col text-left leading-[1.05] tracking-widest bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent select-none font-black py-0.5">
          <span className="text-[11px] uppercase font-black">CHECK</span>
          <span className="text-[9px] font-bold text-slate-400 text-left">&</span>
          <span className="text-[11px] uppercase font-black">MATE</span>
        </div>
      </div>

      <div className="flex items-center space-x-6">
        {!isGameActive && (
          user ? (
            <>
              <button
                onClick={() => onNavigate('dashboard')}
                className={`text-sm font-medium transition-colors cursor-pointer ${
                  currentView === 'dashboard' ? 'text-violet-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Play
              </button>
              <button
                onClick={() => onNavigate('leaderboard')}
                className={`text-sm font-medium transition-colors cursor-pointer ${
                  currentView === 'leaderboard' ? 'text-violet-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Leaderboard
              </button>
              <button
                onClick={() => onNavigate('ledger')}
                className={`text-sm font-medium transition-colors cursor-pointer ${
                  currentView === 'ledger' ? 'text-violet-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Wallet
              </button>
              <button
                onClick={() => onNavigate('profile')}
                className={`text-sm font-medium transition-colors cursor-pointer ${
                  currentView === 'profile' ? 'text-violet-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Profile
              </button>
              <button
                onClick={() => onNavigate('settings')}
                className={`text-sm font-medium transition-colors cursor-pointer ${
                  currentView === 'settings' ? 'text-violet-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Settings
              </button>
              <button
                onClick={() => onNavigate('social')}
                className={`relative text-sm font-medium transition-colors cursor-pointer flex items-center ${
                  currentView === 'social' ? 'text-violet-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>Friends</span>
                {pendingCount > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white ring-2 ring-slate-950 animate-pulse">
                    {pendingCount}
                  </span>
                )}
              </button>

              {/* Wallet Info */}
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2 bg-slate-900/60 border border-white/5 pl-3 pr-2 py-1.5 rounded-lg">
                  <img src="/coin_pack/100 coins.png" alt="Coin" className="w-5 h-5 object-contain shrink-0" />
                  <span className="text-amber-300 font-semibold text-sm mr-1">
                    {profile ? formatCoins(profile.bankBalance) : '---'}
                  </span>
                  {onAddFunds && (
                    <button
                      onClick={onAddFunds}
                      className="p-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded transition-all cursor-pointer flex items-center justify-center"
                      title="Add Funds"
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                    </button>
                  )}
                </div>

                {/* Rating Info */}
                <div className="flex items-center space-x-2 bg-slate-900/60 border border-white/5 px-3 py-1.5 rounded-lg">
                  <img src="https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg" alt="Rook" className="w-5 h-5 filter invert drop-shadow-[0_0_2px_rgba(139,92,246,0.5)] brightness-125" />
                  <span className="text-violet-300 font-semibold text-sm">
                    {profile ? profile.rating : '---'}
                  </span>
                  <span className="text-slate-500 text-xs">Elo</span>
                </div>
              </div>

              {/* User Profile Card */}
              <div 
                className="flex items-center space-x-3 border-l border-white/10 pl-5 cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => onNavigate('profile')}
              >
                <img
                  src={profile?.photoURL || user.photoURL || ''}
                  alt={profile?.displayName || ''}
                  className={`w-9 h-9 rounded-full object-cover ring-2 transition-all ${
                    currentView === 'profile' ? 'ring-violet-500' : 'ring-violet-500/30'
                  }`}
                />
                <div className="hidden md:block text-left">
                  <p className="text-sm font-medium text-slate-200 leading-none flex items-center gap-1.5 flex-wrap">
                    <span>{profile?.displayName || user.displayName}</span>
                    {profile && profile.rating >= 2500 && (
                      <span className="font-serif font-extrabold tracking-wider bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-500 bg-clip-text text-transparent drop-shadow-[0_0_8px_rgba(251,191,36,0.8)] border border-amber-400/60 bg-amber-950/40 px-1 py-0.2 rounded text-[8px] uppercase select-none font-bold" title="Grandmaster (Rating 2500+)">
                        GM
                      </span>
                    )}
                    {(() => {
                      const bestAch = getBestAchievement(profile?.gameplayCounts);
                      if (bestAch) {
                        return (
                          <span className="text-[10px] filter saturate-150" title={bestAch.name}>
                            {bestAch.badge.split(' ')[0]}
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {(() => {
                      const bestAch = getBestAchievement(profile?.gameplayCounts);
                      const label = bestAch ? bestAch.badge.split(' ').slice(1).join(' ') : 'Active User';
                      if (profile && profile.rating >= 2500) {
                        return `Grandmaster • ${label}`;
                      }
                      return label;
                    })()}
                  </p>
                </div>
              </div>
              <button
                onClick={logout}
                disabled={loading}
                className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
          ) : (
            <div className="flex items-center space-x-3">
              <button
                onClick={toggleMute}
                className="p-2.5 bg-slate-900/60 text-slate-400 hover:text-white hover:bg-white/5 rounded-xl border border-white/5 transition-all cursor-pointer flex items-center justify-center"
                title={muted ? "Unmute Sounds" : "Mute Sounds"}
              >
                {muted ? <VolumeX className="w-4.5 h-4.5 text-red-400" /> : <Volume2 className="w-4.5 h-4.5" />}
              </button>
              <button
                onClick={login}
                disabled={loading}
                className="flex items-center space-x-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white px-5 py-2.5 rounded-xl font-medium shadow-lg shadow-violet-600/20 hover:shadow-violet-600/30 transition-all border border-violet-500/20 disabled:opacity-50 cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                <span>Sign in with Google</span>
              </button>
            </div>
          )
        )}
      </div>
    </nav>
  );
};
