import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { db, rtdb } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref as rRef, onValue as rOnValue, set as rSet } from 'firebase/database';
import { Swords, Home, AlertCircle } from 'lucide-react';
import type { Match, UserProfile } from '../types';

interface RollmateGameProps {
  matchId: string;
  onExit: () => void;
}

export const RollmateGame: React.FC<RollmateGameProps> = ({ matchId, onExit }) => {
  const { user } = useAuth();
  const [matchData, setMatchData] = useState<Match | null>(null);
  const [whiteProfile, setWhiteProfile] = useState<UserProfile | null>(null);
  const [blackProfile, setBlackProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [resultMessage, setResultMessage] = useState('');

  // 1. Listen to Realtime Database for match state
  useEffect(() => {
    const matchRef = rRef(rtdb, `matches/${matchId}`);
    const unsubscribe = rOnValue(matchRef, async (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val() as Match;
        setMatchData(data);
        
        // Fetch profiles of both players from Firestore
        if (data.whiteUid && data.blackUid) {
          try {
            const wDoc = await getDoc(doc(db, 'users', data.whiteUid));
            const bDoc = await getDoc(doc(db, 'users', data.blackUid));
            if (wDoc.exists()) setWhiteProfile(wDoc.data() as UserProfile);
            if (bDoc.exists()) setBlackProfile(bDoc.data() as UserProfile);
          } catch (err) {
            console.error("Failed to fetch player profiles for game:", err);
          }
        }
      }
    });

    return () => unsubscribe();
  }, [matchId]);

  // 2. Loading state timer (3 seconds)
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0e0f12] text-[#f1f5f9] p-6">
        <div className="flex flex-col items-center space-y-6 max-w-sm text-center">
          <div className="relative flex items-center justify-center">
            <div className="w-16 h-16 border-4 border-violet-500 border-t-transparent rounded-full animate-spin absolute" />
            <Swords className="w-8 h-8 text-violet-400 animate-pulse" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold uppercase tracking-wider text-white">Loading Arena</h3>
            <p className="text-xs text-slate-500 font-mono">Rollmate matchmaking pairing active...</p>
            <p className="text-sm text-slate-400 font-medium animate-pulse mt-2">
              Preparing battlefield with {whiteProfile?.displayName || 'White'} & {blackProfile?.displayName || 'Black'}
            </p>
          </div>
        </div>
      </div>
    );
  }



  const handleSimulateOutcome = async (outcome: 'win-white' | 'win-black' | 'draw') => {
    if (!matchData || !whiteProfile || !blackProfile || !user) return;
    setSimulating(true);
    setResultMessage('Writing match result...');

    try {
      const now = Date.now();

      let winnerUid: string | null = null;
      let matchStatus: 'completed' | 'terminated' = 'completed';

      if (outcome === 'win-white') {
        winnerUid = matchData.whiteUid;
      } else if (outcome === 'win-black') {
        winnerUid = matchData.blackUid;
      }

      // 1. Save finalized match document to Firestore matches
      const matchDocRef = doc(db, 'matches', matchId);
      await setDoc(matchDocRef, {
        id: matchId,
        players: matchData.players,
        whiteUid: matchData.whiteUid,
        blackUid: matchData.blackUid,
        mode: 'Rollmate',
        status: matchStatus,
        winnerUid: winnerUid,
        createdAt: matchData.createdAt || now,
        finishedAt: now
      });

      // 2. Update White player stats in Firestore
      const whiteDocRef = doc(db, 'users', matchData.whiteUid);
      const newWhiteGames = (whiteProfile.totalGamesPlayed || 0) + 1;
      const newWhiteWins = (whiteProfile.wins || 0) + (outcome === 'win-white' ? 1 : 0);
      const newWhiteLosses = (whiteProfile.losses || 0) + (outcome === 'win-black' ? 1 : 0);
      const newWhiteDraws = (whiteProfile.draws || 0) + (outcome === 'draw' ? 1 : 0);
      const newWhiteWinRate = newWhiteGames > 0 ? Math.round((newWhiteWins / newWhiteGames) * 100) : 0;

      await setDoc(whiteDocRef, {
        wins: newWhiteWins,
        losses: newWhiteLosses,
        draws: newWhiteDraws,
        totalGamesPlayed: newWhiteGames,
        winRateRatio: newWhiteWinRate,
        updatedAt: now
      }, { merge: true });

      // 3. Update Black player stats in Firestore
      const blackDocRef = doc(db, 'users', matchData.blackUid);
      const newBlackGames = (blackProfile.totalGamesPlayed || 0) + 1;
      const newBlackWins = (blackProfile.wins || 0) + (outcome === 'win-black' ? 1 : 0);
      const newBlackLosses = (blackProfile.losses || 0) + (outcome === 'win-white' ? 1 : 0);
      const newBlackDraws = (blackProfile.draws || 0) + (outcome === 'draw' ? 1 : 0);
      const newBlackWinRate = newBlackGames > 0 ? Math.round((newBlackWins / newBlackGames) * 100) : 0;

      await setDoc(blackDocRef, {
        wins: newBlackWins,
        losses: newBlackLosses,
        draws: newBlackDraws,
        totalGamesPlayed: newBlackGames,
        winRateRatio: newBlackWinRate,
        updatedAt: now
      }, { merge: true });

      // 4. Update RTDB Match to completed
      const rtdbMatchRef = rRef(rtdb, `matches/${matchId}`);
      await rSet(rtdbMatchRef, {
        id: matchId,
        players: matchData.players,
        whiteUid: matchData.whiteUid,
        blackUid: matchData.blackUid,
        status: 'completed',
        winnerUid: winnerUid,
        finishedAt: now
      });

      // 5. Update challenges status in RTDB
      if (matchData.challengeId) {
        await rSet(rRef(rtdb, `challenges/${matchData.challengeId}/status`), 'completed');
        await rSet(rRef(rtdb, `user_challenges/${matchData.whiteUid}/${matchData.challengeId}/status`), 'completed');
        await rSet(rRef(rtdb, `user_challenges/${matchData.blackUid}/${matchData.challengeId}/status`), 'completed');
      }

      setResultMessage('Outcome simulated and saved!');
    } catch (err: any) {
      console.error("Simulation failed:", err);
      setResultMessage(`Error: ${err.message}`);
    } finally {
      setSimulating(false);
    }
  };

  const isMatchEnded = matchData?.status === 'completed' || matchData?.status === 'terminated';

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black text-[#f1f5f9] p-6 text-center select-none">
      <div className="max-w-md w-full space-y-12">
        
        {/* Game Title */}
        <div className="space-y-4">
          <div className="inline-flex items-center space-x-2 bg-violet-600/10 border border-violet-500/25 px-4 py-2 rounded-xl text-xs font-bold text-violet-400 uppercase tracking-widest">
            <Swords className="w-4 h-4 animate-spin-slow" />
            <span>Rollmate Mode</span>
          </div>
          <h2 className="text-4xl font-extrabold text-white tracking-wide">
            Rollmate game will come soon.
          </h2>
          <p className="text-xs text-slate-500 font-mono tracking-wider">
            Pairing ID: {matchId}
          </p>
        </div>

        {/* Players Card */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-semibold">White Player</span>
            <span className="text-sm font-bold text-white block">{whiteProfile?.displayName || 'Loading...'}</span>
          </div>
          <div className="space-y-1 border-l border-zinc-800/80">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-semibold">Black Player</span>
            <span className="text-sm font-bold text-white block">{blackProfile?.displayName || 'Loading...'}</span>
          </div>
        </div>

        {/* Status / Outcome results */}
        {resultMessage && (
          <div className="bg-violet-950/20 border border-violet-500/25 rounded-xl p-3.5 flex items-center justify-center gap-2 text-xs text-violet-300">
            <AlertCircle className="w-4 h-4 text-violet-400 shrink-0" />
            <span className="font-medium font-sans">{resultMessage}</span>
          </div>
        )}

        {/* Action Controls */}
        <div className="space-y-4 pt-4">
          {!isMatchEnded ? (
            <div className="space-y-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold border-b border-zinc-800 pb-2">
                Developer Simulation Controls
              </p>
              <div className="grid grid-cols-3 gap-2.5">
                <button
                  onClick={() => handleSimulateOutcome('win-white')}
                  disabled={simulating}
                  className="bg-white hover:bg-slate-100 text-black text-xs font-bold py-3 rounded-xl shadow-lg transition-all cursor-pointer disabled:opacity-50"
                >
                  White Wins
                </button>
                <button
                  onClick={() => handleSimulateOutcome('draw')}
                  disabled={simulating}
                  className="bg-zinc-800 hover:bg-zinc-700 text-slate-200 text-xs font-bold py-3 rounded-xl border border-zinc-700 transition-all cursor-pointer disabled:opacity-50"
                >
                  Draw Match
                </button>
                <button
                  onClick={() => handleSimulateOutcome('win-black')}
                  disabled={simulating}
                  className="bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-slate-200 text-xs font-bold py-3 rounded-xl transition-all cursor-pointer disabled:opacity-50"
                >
                  Black Wins
                </button>
              </div>
              <button
                onClick={async () => {
                  try {
                    await rSet(rRef(rtdb, `matches/${matchId}/status`), 'terminated');
                    if (matchData?.challengeId) {
                      await rSet(rRef(rtdb, `challenges/${matchData.challengeId}/status`), 'completed');
                    }
                    onExit();
                  } catch (e) {}
                }}
                disabled={simulating}
                className="w-full text-slate-500 hover:text-slate-300 text-xs font-semibold py-2.5 transition-colors cursor-pointer"
              >
                Abrupt Exit (No Result)
              </button>
            </div>
          ) : (
            <button
              onClick={onExit}
              className="w-full flex items-center justify-center space-x-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white py-3.5 rounded-xl font-semibold transition-all border border-violet-500/25 cursor-pointer shadow-lg shadow-violet-600/10"
            >
              <Home className="w-4.5 h-4.5" />
              <span>Return to Dashboard</span>
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
