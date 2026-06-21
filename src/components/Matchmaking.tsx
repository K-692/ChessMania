import React, { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Loader2, Coins, UserMinus, ShieldAlert } from 'lucide-react';
import type { GameMode } from '../types';
import { formatCoins } from '../utils/format';
import { playMatchFoundSound } from '../utils/sound';
import { joinQueue, leaveQueue, findMatch } from '../matchmaking/matchmakingService';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { NetworkSignal } from './NetworkSignal';

interface MatchmakingProps {
  mode: GameMode;
  stake: number;
  onMatchFound: (matchId: string) => void;
  onCancel: () => void;
}

export const Matchmaking: React.FC<MatchmakingProps> = ({ mode, stake, onMatchFound, onCancel }) => {
  const { user, profile } = useAuth();
  const [queueId, setQueueId] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [statusText, setStatusText] = useState<string>('Entering queue...');
  const [error, setError] = useState<string | null>(null);

  // 1. Join queue on mount, leave queue on unmount
  useEffect(() => {
    if (!user || !profile) return;

    let activeQueueId: string | null = null;

    const setupQueue = async () => {
      try {
        const ratingVal = profile.currentEloRating !== undefined ? profile.currentEloRating : profile.rating;
        const id = await joinQueue(user.uid, ratingVal, stake, mode);
        activeQueueId = id;
        setQueueId(id);
        setStatusText('Searching for opponent...');

        // Listen for changes to our own queue entry in real-time
        const queueRef = doc(db, 'matchQueues', id);
        const unsubscribe = onSnapshot(queueRef, (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.status === 'matched' && data.matchId) {
              unsubscribe();
              playMatchFoundSound();
              onMatchFound(data.matchId);
            }
          }
        });

        return unsubscribe;
      } catch (err: any) {
        console.error('Error joining matchmaking queue:', err);
        setError(err.message || 'Failed to enter queue');
      }
    };

    const unsubscribePromise = setupQueue();

    return () => {
      if (activeQueueId) {
        leaveQueue(activeQueueId).catch((err) =>
          console.warn('Failed to clean up queue document:', err)
        );
      }
      unsubscribePromise.then((unsub) => unsub && unsub());
    };
  }, [user, profile, mode, stake]);

  // 2. Incremental clock & rating band expansion timer
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Auto-exit after 1 minute (60 seconds)
  useEffect(() => {
    if (elapsedTime >= 60) {
      onCancel();
    }
  }, [elapsedTime, onCancel]);

  // 3. Search triggers every 2 seconds, expanding rating band by 5 every 10 seconds
  useEffect(() => {
    if (!queueId || !user || !profile) return;

    const performSearch = async () => {
      const currentBand = Math.floor(elapsedTime / 10) * 5;

      setStatusText('Searching for opponent...');

      const ratingVal = profile.currentEloRating !== undefined ? profile.currentEloRating : profile.rating;
      const matchId = await findMatch(
        queueId,
        user.uid,
        ratingVal,
        stake,
        mode,
        currentBand
      );

      if (matchId) {
        playMatchFoundSound();
        onMatchFound(matchId);
      }
    };

    // Run search immediately at 0s, and then on even seconds
    if (elapsedTime === 0 || elapsedTime % 2 === 0) {
      performSearch();
    }
  }, [elapsedTime, queueId, user, profile, mode, stake]);

  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
      <div className="glass-card w-full max-w-md rounded-2xl p-8 border border-white/10 text-center space-y-6">
        {/* Loading Spinner */}
        <div className="relative flex justify-center">
          <div className="absolute inset-0 bg-violet-500/10 rounded-full blur-xl w-20 h-20 mx-auto" />
          <Loader2 className="w-16 h-16 text-violet-500 animate-spin relative" />
        </div>

        {/* Info */}
        <div className="space-y-2 flex flex-col items-center">
          <div className="mb-2">
            <NetworkSignal />
          </div>
          <h3 className="text-xl font-bold tracking-wide text-slate-100">
            {statusText}
          </h3>
          <p className="text-2xl font-mono text-slate-300 font-semibold">
            {formatTime(elapsedTime)}
          </p>
        </div>

        {/* Queue Config Panel */}
        <div className="bg-slate-950/50 border border-white/5 p-4 rounded-xl flex items-center justify-between text-left">
          <div>
            <p className="text-xs text-slate-500">Selected Game Mode</p>
            <p className="text-sm font-semibold text-slate-300 capitalize">
              {mode} Chess
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Staked Pool</p>
            <p className="text-sm font-semibold text-amber-400 flex items-center justify-end space-x-1">
              <Coins className="w-3.5 h-3.5 text-amber-500" />
              <span>{formatCoins(stake)}</span>
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-start space-x-2 text-red-400 text-xs bg-red-950/20 border border-red-900/30 p-3 rounded-lg text-left">
            <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Actions */}
        <button
          onClick={onCancel}
          className="w-full flex items-center justify-center space-x-2 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white py-3 rounded-xl font-medium border border-white/5 hover:border-white/10 transition-all cursor-pointer"
        >
          <UserMinus className="w-4 h-4" />
          <span>Leave Queue</span>
        </button>
      </div>
    </div>
  );
};
