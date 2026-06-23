import React, { useState, useEffect } from 'react';
import { X, History, User } from 'lucide-react';
import type { UserProfile } from '../types';
import { collection, query, where, getDocs, limit, orderBy, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../auth/AuthContext';

interface ProfilePopupProps {
  profile: UserProfile;
  onClose: () => void;
}

export const ProfilePopup: React.FC<ProfilePopupProps> = ({ profile, onClose }) => {
  const { user } = useAuth();
  const [h2h, setH2h] = useState<{ wins: number; losses: number; draws: number } | null>(null);

  useEffect(() => {
    if (!user || user.uid === profile.uid) {
      setH2h(null);
      return;
    }

    const fetchH2H = async () => {
      try {
        const q = query(
          collection(db, 'matches'),
          where('players', 'array-contains', user.uid)
        );
        const snap = await getDocs(q);
        let wins = 0;
        let losses = 0;
        let draws = 0;
        snap.forEach((docSnap) => {
          const matchData = docSnap.data();
          if (matchData.status === 'active') return;

          // Check if this match is against the current profile
          const oppUid = matchData.players.find((p: string) => p !== user.uid);
          if (oppUid !== profile.uid) return;

          if (matchData.winnerUid === user.uid) {
            wins++;
          } else if (matchData.winnerUid) {
            losses++;
          } else {
            draws++;
          }
        });
        setH2h({ wins, losses, draws });
      } catch (err) {
        console.warn('Failed to fetch head-to-head records:', err);
      }
    };

    fetchH2H();
  }, [user, profile.uid]);

  const [recentMatches, setRecentMatches] = useState<any[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [opponentProfiles, setOpponentProfiles] = useState<Record<string, UserProfile>>({});

  useEffect(() => {
    const fetchMatches = async () => {
      setLoadingMatches(true);
      try {
        const q = query(
          collection(db, 'matches'),
          where('players', 'array-contains', profile.uid),
          orderBy('createdAt', 'desc'),
          limit(5)
        );
        const querySnap = await getDocs(q);
        const matches: any[] = [];
        const oppUids = new Set<string>();

        querySnap.forEach((docSnap) => {
          const m = docSnap.data();
          if (m.status === 'completed' || m.status === 'terminated') {
            matches.push({ id: docSnap.id, ...m });
            const oppUid = m.players.find((p: string) => p !== profile.uid);
            if (oppUid) oppUids.add(oppUid);
          }
        });

        setRecentMatches(matches);

        // Fetch opponent profiles for display
        const fetched: Record<string, UserProfile> = {};
        for (const oId of Array.from(oppUids)) {
          if (oId === user?.uid && user) {
            fetched[oId] = {
              uid: user.uid,
              displayName: user.displayName || 'You',
              photoURL: user.photoURL || '',
            } as UserProfile;
          } else {
            try {
              const uDoc = await getDoc(doc(db, 'users', oId));
              if (uDoc.exists()) {
                fetched[oId] = uDoc.data() as UserProfile;
              }
            } catch (e) {}
          }
        }
        setOpponentProfiles(fetched);
      } catch (err) {
        console.warn("Failed to fetch match history for popup:", err);
      } finally {
        setLoadingMatches(false);
      }
    };

    fetchMatches();
  }, [user, profile.uid]);

  const wins = profile.wins || 0;
  const losses = profile.losses || 0;
  const draws = profile.draws || 0;
  const totalGames = wins + losses + draws;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-scale-up">
      <div className="bg-zinc-900 border border-zinc-800 w-full max-w-sm rounded-2xl flex flex-col shadow-2xl p-6 text-left space-y-5 relative max-h-[calc(100vh-120px)] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <h3 className="text-sm font-bold text-slate-200">User Profile Details</h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Profile Card Info */}
        <div className="flex items-center space-x-3.5">
          <img
            src={profile.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop'}
            alt={profile.displayName}
            className="w-14 h-14 rounded-full object-cover border border-zinc-850 ring-2 ring-violet-500/20"
          />
          <div className="space-y-0.5">
            <h4 className="text-base font-extrabold text-white">
              {profile.displayName}
            </h4>
            <p className="text-[10px] text-slate-500 font-mono">
              Member since: {new Date(profile.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        {/* Total Games Card */}
        <div className="bg-zinc-950 border border-zinc-850 p-3.5 rounded-xl text-center">
          <p className="text-[8px] text-slate-500 uppercase tracking-wider font-semibold">Total Battles</p>
          <p className="text-base font-bold text-violet-300 font-mono mt-1">{totalGames} Matches</p>
        </div>

        {/* Match records */}
        <div className="bg-zinc-950 border border-zinc-850 p-4 rounded-xl space-y-2">
          <h5 className="text-[9px] font-bold text-slate-400 uppercase tracking-wider border-b border-zinc-850 pb-1.5">
            Career Records
          </h5>
          <div className="grid grid-cols-3 gap-1 text-center font-mono">
            <div>
              <p className="text-[8px] text-slate-500 uppercase font-semibold">Wins</p>
              <p className="text-xs font-bold text-emerald-400 mt-1">{wins}</p>
            </div>
            <div>
              <p className="text-[8px] text-slate-500 uppercase font-semibold">Losses</p>
              <p className="text-xs font-bold text-red-400 mt-1">{losses}</p>
            </div>
            <div>
              <p className="text-[8px] text-slate-500 uppercase font-semibold">Draws</p>
              <p className="text-xs font-bold text-zinc-400 mt-1">{draws}</p>
            </div>
          </div>
        </div>

        {/* Head-to-Head */}
        {h2h && (
          <div className="bg-zinc-950 border border-zinc-850 p-4 rounded-xl space-y-2 animate-fade-in">
            <h5 className="text-[9px] font-bold text-slate-400 uppercase tracking-wider border-b border-zinc-850 pb-1.5">
              H2H Record (vs you)
            </h5>
            <div className="grid grid-cols-3 gap-1 text-center font-mono">
              <div>
                <p className="text-[8px] text-slate-500 uppercase font-semibold font-sans">Wins</p>
                <p className="text-xs font-bold text-emerald-400 mt-1">{h2h.wins}</p>
              </div>
              <div>
                <p className="text-[8px] text-slate-500 uppercase font-semibold font-sans">Losses</p>
                <p className="text-xs font-bold text-red-400 mt-1">{h2h.losses}</p>
              </div>
              <div>
                <p className="text-[8px] text-slate-500 uppercase font-semibold font-sans">Draws</p>
                <p className="text-xs font-bold text-zinc-400 mt-1">{h2h.draws}</p>
              </div>
            </div>
          </div>
        )}

        {/* Previous Games List */}
        <div className="bg-zinc-950 border border-zinc-850 p-4 rounded-xl space-y-2.5">
          <h5 className="text-[9px] font-bold text-slate-400 uppercase tracking-wider border-b border-zinc-850 pb-1.5 flex items-center gap-1.5 font-sans">
            <History className="w-3 h-3 text-violet-400" />
            Recent Battles
          </h5>
          {loadingMatches ? (
            <p className="text-[10px] text-slate-500 italic text-center py-2 font-sans">Loading match logs...</p>
          ) : recentMatches.length === 0 ? (
            <p className="text-[10px] text-slate-500 italic text-center py-2 font-sans">No completed matches yet.</p>
          ) : (
            <div className="divide-y divide-zinc-900 space-y-2">
              {recentMatches.map((m) => {
                const oppUid = m.players.find((p: string) => p !== profile.uid);
                const opponent = (user && oppUid === user.uid) 
                  ? { displayName: 'You', photoURL: user.photoURL || '' } 
                  : (opponentProfiles[oppUid] || { displayName: 'Challenger', photoURL: '' });

                const isDraw = m.status === 'draw' || !m.winnerUid;
                const won = m.winnerUid === profile.uid;

                return (
                  <div key={m.id} className="flex items-center justify-between pt-2 first:pt-0">
                    <div className="flex items-center space-x-2 text-left">
                      {opponent.photoURL ? (
                        <img src={opponent.photoURL} alt={opponent.displayName} className="w-6 h-6 rounded-full object-cover border border-zinc-850" />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-500 text-[10px]">
                          <User className="w-3 h-3" />
                        </div>
                      )}
                      <div>
                        <span className="text-[10px] font-semibold text-white block font-sans">
                          vs {opponent.displayName}
                        </span>
                        <span className="text-[8px] text-slate-500 font-mono">
                          {new Date(m.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      {isDraw ? (
                        <span className="text-[8px] bg-zinc-850 text-zinc-400 font-bold px-1.5 py-0.5 rounded uppercase font-sans">Draw</span>
                      ) : won ? (
                        <span className="text-[8px] bg-emerald-950/40 text-emerald-400 font-bold px-1.5 py-0.5 rounded border border-emerald-500/10 uppercase font-sans">Win</span>
                      ) : (
                        <span className="text-[8px] bg-red-950/40 text-red-400 font-bold px-1.5 py-0.5 rounded border border-red-500/10 uppercase font-sans">Loss</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
