import React, { useEffect, useState } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, limit, onSnapshot, doc, getDoc } from 'firebase/firestore';
import type { UserProfile } from '../types';
import { formatCoins } from '../utils/format';
import { ChevronLeft, Trophy, Medal, Star } from 'lucide-react';
import { getBestAchievement } from '../utils/achievements';
import { ProfilePopup } from './ProfilePopup';

interface LeaderboardProps {
  onBack: () => void;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ onBack }) => {
  const [leaders, setLeaders] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedProfile, setSelectedProfile] = useState<UserProfile | null>(null);

  const handleViewProfile = async (uid: string) => {
    try {
      const docRef = doc(db, 'users', uid);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        setSelectedProfile(snap.data() as UserProfile);
      } else {
        const leader = leaders.find(l => l.uid === uid);
        if (leader) setSelectedProfile(leader);
      }
    } catch (err) {
      console.error("Error fetching user profile:", err);
      const leader = leaders.find(l => l.uid === uid);
      if (leader) setSelectedProfile(leader);
    }
  };

  useEffect(() => {
    const q = query(
      collection(db, 'leaderboards', 'global', 'players'),
      orderBy('eloRating', 'desc'),
      limit(10)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const topProfiles: UserProfile[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        topProfiles.push({
          uid: data.uid,
          displayName: data.displayName || 'Chess Player',
          photoURL: data.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop',
          currentEloRating: data.eloRating || 0,
          rating: data.eloRating || 0, // compatibility
          currentBalance: data.coinsEarned || 0,
          bankBalance: data.coinsEarned || 0, // compatibility
          totalCoinsEarned: data.coinsEarned || 0,
          gameplayCounts: data.gameplayCounts || {},
          totalGamesPlayed: data.totalGamesPlayed || 0,
          winRateRatio: data.winRateRatio || 0,
          createdAt: data.updatedAt || Date.now(),
          lastActiveAt: data.updatedAt || Date.now(),
          zeroBalanceAt: null
        } as UserProfile);
      });
      setLeaders(topProfiles);
      setLoading(false);
    }, (err) => {
      console.error("Error loading leaderboard:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const getRankBadge = (rank: number) => {
    switch (rank) {
      case 1:
        return <Trophy className="w-5 h-5 text-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.6)]" />;
      case 2:
        return <Medal className="w-5 h-5 text-slate-300 drop-shadow-[0_0_4px_rgba(203,213,225,0.6)]" />;
      case 3:
        return <Medal className="w-5 h-5 text-amber-600 drop-shadow-[0_0_4px_rgba(180,83,9,0.6)]" />;
      default:
        return <span className="font-mono text-slate-500 font-semibold">{rank}</span>;
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6 text-left">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center space-x-2 text-slate-400 hover:text-white transition-colors text-sm font-medium cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </button>
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center space-x-2.5">
          {/* Wikimedia Queen Vector SVG */}
          <img src="https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg" alt="Queen" className="w-6 h-6 filter invert drop-shadow-[0_0_4px_rgba(139,92,246,0.5)] brightness-125" />
          <span>Global Grandmasters Leaderboard</span>
        </h2>
        <p className="text-sm text-slate-500">
          Real-time tracking of the top players by standard Elo rating and coin balances.
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Loading standings...</p>
        </div>
      ) : leaders.length === 0 ? (
        <div className="glass p-12 rounded-xl text-center border border-white/5 space-y-2">
          <Star className="w-8 h-8 text-slate-500 mx-auto" />
          <p className="text-slate-400 font-medium">No standings found</p>
        </div>
      ) : (
        <div className="glass rounded-xl border border-white/5 overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse text-left">
              <thead>
                <tr className="bg-slate-950/40 border-b border-white/5 text-slate-400 font-semibold text-xs uppercase tracking-wider">
                  <th className="px-6 py-4 w-20 text-center">Rank</th>
                  <th className="px-6 py-4">Player</th>
                  <th className="px-6 py-4">Elo Rating</th>
                  <th className="px-6 py-4">Total Coins Earned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-slate-950/10">
                {leaders.map((player, idx) => (
                  <tr 
                    key={player.uid} 
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    {/* Rank */}
                    <td className="px-6 py-4 text-center flex items-center justify-center">
                      {getRankBadge(idx + 1)}
                    </td>

                    {/* Profile */}
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <img 
                          src={player.photoURL} 
                          alt={player.displayName} 
                          className="w-8 h-8 rounded-full object-cover border border-white/10 cursor-pointer hover:opacity-85 transition-opacity"
                          title="View Profile"
                          onClick={() => handleViewProfile(player.uid)}
                        />
                        <span className="font-semibold text-slate-200 flex items-center gap-2 flex-wrap">
                          <span>{player.displayName}</span>
                          {player.rating >= 2500 && (
                            <span className="font-serif font-extrabold tracking-wider bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-500 bg-clip-text text-transparent drop-shadow-[0_0_8px_rgba(251,191,36,0.8)] border border-amber-400/60 bg-amber-950/40 px-2 py-0.5 rounded text-[10px] uppercase select-none font-bold animate-pulse" title="Grandmaster (Rating 2500+)">
                              GM
                            </span>
                          )}
                          {(() => {
                            const bestAch = getBestAchievement(player.gameplayCounts);
                            if (bestAch) {
                              return (
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${bestAch.color.split(' ')[0]} ${bestAch.color.split(' ')[1]} ${bestAch.color.split(' ')[2]}`} title={bestAch.name}>
                                  {bestAch.badge}
                                </span>
                              );
                            }
                            return null;
                          })()}
                        </span>
                      </div>
                    </td>

                    {/* Elo Rating */}
                    <td className="px-6 py-4 font-mono font-bold text-violet-300">
                      {player.rating}
                    </td>

                    {/* Coins Balance */}
                    <td className="px-6 py-4 font-mono font-semibold text-amber-400">
                      <div className="flex items-center space-x-1">
                        <span>{formatCoins(player.totalCoinsEarned ?? player.bankBalance)}</span>
                        <img src="/coin_pack/100 coins.png" alt="Coin" className="w-4 h-4 object-contain" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {selectedProfile && (
        <ProfilePopup 
          profile={selectedProfile} 
          onClose={() => setSelectedProfile(null)} 
        />
      )}
    </div>
  );
};
