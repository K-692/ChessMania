import React, { useEffect, useState, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useAuth } from '../auth/AuthContext';
import type { Match, UserProfile, MatchStatus } from '../types';
import { makeMove, submitGameAction, settleMatchPayoutAndElo } from '../game/gameService';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Clock, ShieldAlert, Award, ArrowLeft } from 'lucide-react';
import { formatCoins } from '../utils/format';
import { playMoveSound, playCaptureSound, playCheckSound, playWinSound, playLoseSound } from '../utils/sound';
import { getBestAchievement } from '../utils/achievements';

interface ChessGameProps {
  matchId: string;
  onExit: () => void;
}

export const ChessGame: React.FC<ChessGameProps> = ({ matchId, onExit }) => {
  const { user } = useAuth();
  const [match, setMatch] = useState<Match | null>(null);
  const [whiteProfile, setWhiteProfile] = useState<UserProfile | null>(null);
  const [blackProfile, setBlackProfile] = useState<UserProfile | null>(null);
  const [localFen, setLocalFen] = useState<string>('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

  // Ref to hold a local Chess instance for validation
  const chessRef = useRef<Chess>(new Chess());

  // Ref to hold current match state for snapshot closure access
  const matchStateRef = useRef<Match | null>(null);
  useEffect(() => {
    matchStateRef.current = match;
  }, [match]);

  // Clocks states (rendered with millisecond tickers)
  const [whiteClock, setWhiteClock] = useState<number>(0);
  const [blackClock, setBlackClock] = useState<number>(0);

  const isWhite = user?.uid === match?.whiteUid;
  const isBlack = user?.uid === match?.blackUid;
  const isMyTurn = match ? (match.turn === 'w' && isWhite) || (match.turn === 'b' && isBlack) : false;

  // 1. Fetch match and players profiles
  useEffect(() => {
    const matchRef = doc(db, 'matches', matchId);

    const unsubscribe = onSnapshot(matchRef, async (docSnap) => {
      if (!docSnap.exists()) return;
      const matchData = docSnap.data() as Match;

      const prevMatch = matchStateRef.current;

      // Realtime sound triggers on moves and captures
      if (prevMatch) {
        const oldMovesCount = prevMatch.moves?.length || 0;
        const newMovesCount = matchData.moves?.length || 0;

        if (newMovesCount > oldMovesCount) {
          const tempChess = new Chess();
          for (let i = 0; i < newMovesCount - 1; i++) {
            try {
              tempChess.move(prevMatch.moves[i] || matchData.moves[i]);
            } catch (e) {}
          }
          const lastMoveStr = matchData.moves[newMovesCount - 1];
          try {
            const moveInfo = tempChess.move(lastMoveStr);
            if (tempChess.inCheck()) {
              playCheckSound();
            } else if (moveInfo && moveInfo.captured) {
              playCaptureSound();
            } else {
              playMoveSound();
            }
          } catch (e) {
            playMoveSound();
          }
        }

        // Sound triggers on game over status transition
        const oldStatus = prevMatch.status;
        const newStatus = matchData.status;
        if (oldStatus === 'active' && newStatus !== 'active') {
          if (matchData.winnerUid === user?.uid) {
            playWinSound();
          } else if (matchData.winnerUid) {
            playLoseSound();
          } else {
            playMoveSound(); // Draw fallback
          }
        }
      }

      setMatch(matchData);
      setLocalFen(matchData.boardFEN);

      // Re-synchronize local chess engine
      try {
        chessRef.current.load(matchData.boardFEN);
      } catch (e) {
        console.warn('FEN sync mismatch:', e);
      }

      // Fetch profiles if they are not loaded yet
      if (!whiteProfile || !blackProfile) {
        const whiteSnap = await getDoc(doc(db, 'users', matchData.whiteUid));
        const blackSnap = await getDoc(doc(db, 'users', matchData.blackUid));
        
        if (whiteSnap.exists()) setWhiteProfile(whiteSnap.data() as UserProfile);
        if (blackSnap.exists()) setBlackProfile(blackSnap.data() as UserProfile);
      }

      // If the match ended (status !== 'active') and is not yet settled, run settlement
      if (matchData.status !== 'active' && !(matchData as any).settled) {
        // Winner (or white if draw) initiates settlement first, other falls back
        const shouldSettle = matchData.winnerUid 
          ? user?.uid === matchData.winnerUid 
          : user?.uid === matchData.whiteUid;

        if (shouldSettle) {
          settleMatchPayoutAndElo(matchId).catch(err => console.error('Settlement transaction failed:', err));
        } else {
          // Backup settlement call in case the first client disconnected
          setTimeout(() => {
            settleMatchPayoutAndElo(matchId).catch(err => console.error('Backup settlement transaction failed:', err));
          }, 1500);
        }
      }
    });

    return () => unsubscribe();
  }, [matchId, whiteProfile, blackProfile, user]);

  // 2. Realtime clock countdowns
  useEffect(() => {
    if (!match || match.status !== 'active') return;

    // Initialize display values
    setWhiteClock(match.clocks[match.whiteUid]);
    setBlackClock(match.clocks[match.blackUid]);

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - match.lastMoveAt;

      if (match.turn === 'w') {
        const whiteRem = Math.max(0, match.clocks[match.whiteUid] - elapsed);
        setWhiteClock(whiteRem);
        
        // Handle timeout triggers
        if (whiteRem <= 0 && user?.uid === match.blackUid) {
          // If white timed out and I am black, I submit victory
          submitGameAction(matchId, match.blackUid, 'resign').catch(console.warn);
        }
      } else {
        const blackRem = Math.max(0, match.clocks[match.blackUid] - elapsed);
        setBlackClock(blackRem);

        // Handle timeout triggers
        if (blackRem <= 0 && user?.uid === match.whiteUid) {
          // If black timed out and I am white, I submit victory
          submitGameAction(matchId, match.whiteUid, 'resign').catch(console.warn);
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [match, user, matchId]);

  if (!match) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400">Loading game room...</p>
      </div>
    );
  }

  // 3. Handle Piece Drops on chessboard
  const onPieceDrop = (sourceSquare: string, targetSquare: string | null): boolean => {
    if (!targetSquare) return false;
    if (!isMyTurn || match.status !== 'active') return false;

    // Validate move locally
    try {
      const move = chessRef.current.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q', // auto-promote to queen for simplicity
      });

      if (move) {
        // Play local FEN immediately to make UX snappy
        const nextFen = chessRef.current.fen();
        setLocalFen(nextFen);

        // Update Firestore authoritatively
        makeMove(matchId, user!.uid, nextFen, move.san).catch((err) => {
          console.error('Failed to submit move:', err);
          // Rollback FEN if update failed
          setLocalFen(match.boardFEN);
          chessRef.current.load(match.boardFEN);
        });

        // Determine if this move triggers an end condition locally
        if (chessRef.current.isGameOver()) {
          let status: MatchStatus = 'active';
          let winnerUid: string | null = null;

          if (chessRef.current.isCheckmate()) {
            status = 'checkmate';
            winnerUid = user!.uid;
          } else if (chessRef.current.isDraw()) {
            status = 'draw';
          } else if (chessRef.current.isStalemate()) {
            status = 'stalemate';
          }

          if (status !== 'active') {
            // Push match end state
            const now = Date.now();
            const elapsed = now - match.lastMoveAt;
            const updatedClocks = {
              ...match.clocks,
              [user!.uid]: Math.max(0, match.clocks[user!.uid] - elapsed),
            };

            // We update the match document directly with the ending state
            doc(db, 'matches', matchId);
            // Settle will pick this up
            // Wait, let's write updates through Firestore
            import('firebase/firestore').then(({ updateDoc }) => {
              updateDoc(doc(db, 'matches', matchId), {
                boardFEN: nextFen,
                clocks: updatedClocks,
                status,
                winnerUid,
                finishedAt: now,
              });
            });
          }
        }

        return true;
      }
    } catch (e) {
      // Illegal move
      return false;
    }

    return false;
  };

  const handleResign = async () => {
    if (window.confirm('Are you sure you want to resign?')) {
      try {
        await submitGameAction(matchId, user!.uid, 'resign');
      } catch (err) {
        console.error('Resignation failed:', err);
      }
    }
  };

  const handleDrawAction = async () => {
    const currentOffers = match.drawOffers || [];
    const opponentUid = isWhite ? match.blackUid : match.whiteUid;

    if (currentOffers.includes(opponentUid)) {
      // Accept draw
      try {
        await submitGameAction(matchId, user!.uid, 'accept-draw');
      } catch (err) {
        console.error('Failed to accept draw:', err);
      }
    } else {
      // Offer draw
      try {
        await submitGameAction(matchId, user!.uid, 'offer-draw');
        alert('Draw offer sent to opponent');
      } catch (err) {
        console.error('Failed to offer draw:', err);
      }
    }
  };

  const formatClock = (ms: number) => {
    const totalSecs = Math.ceil(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const myClock = isWhite ? whiteClock : blackClock;
  const oppClock = isWhite ? blackClock : whiteClock;

  const myProfile = isWhite ? whiteProfile : blackProfile;
  const oppProfile = isWhite ? blackProfile : whiteProfile;

  const hasOpponentDrawOffer = match.drawOffers?.includes(isWhite ? match.blackUid : match.whiteUid);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      {/* Header and Match Prize details */}
      <div className="flex items-center justify-between glass px-6 py-4 rounded-xl border border-white/5 bg-slate-950/40">
        <button
          onClick={onExit}
          className="flex items-center space-x-2 text-slate-400 hover:text-white transition-colors text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Exit Game</span>
        </button>

        <div className="text-center">
          <p className="text-xs text-slate-500 uppercase tracking-widest">Total Prize Pool</p>
          <p className="text-xl font-bold text-amber-400 flex items-center justify-center space-x-2 mt-0.5">
            <img src="https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg" alt="Pawn" className="w-5 h-5 filter invert drop-shadow-[0_0_2px_rgba(245,158,11,0.5)] brightness-125" />
            <span>
              {formatCoins(
                match.mode === 'all_in' && match.allInStakes
                  ? Object.values(match.allInStakes).reduce((sum, val) => sum + val, 0)
                  : match.stake * 2
              )}
            </span>
          </p>
        </div>

        <div className="text-right text-xs text-slate-500 capitalize">
          Mode: <span className="font-semibold text-slate-300">{match.mode}</span>
        </div>
      </div>

      {/* Main Game Screen */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Chessboard */}
        <div className="lg:col-span-7 flex flex-col space-y-4">
          
          {/* Opponent Profile and Clock */}
          <div className="flex items-center justify-between glass px-4 py-3 rounded-lg border border-white/5">
            <div className="flex items-center space-x-3">
              <img
                src={oppProfile?.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop'}
                alt={oppProfile?.displayName || 'Opponent'}
                className="w-10 h-10 rounded-full object-cover ring-2 ring-slate-800"
              />
              <div>
                <p className="text-sm font-semibold text-slate-300 flex items-center gap-1.5 flex-wrap">
                  <span>{oppProfile?.displayName || 'Opponent'} {isWhite ? '(Black)' : '(White)'}</span>
                  {oppProfile && oppProfile.rating >= 2500 && (
                    <span className="font-serif font-extrabold tracking-wider bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-500 bg-clip-text text-transparent drop-shadow-[0_0_8px_rgba(251,191,36,0.8)] border border-amber-400/60 bg-amber-950/40 px-1.5 py-0.2 rounded text-[8px] uppercase select-none font-bold" title="Grandmaster (Rating 2500+)">
                      GM
                    </span>
                  )}
                  {(() => {
                    const bestAch = getBestAchievement(oppProfile?.gameplayCounts);
                    if (bestAch) {
                      return (
                        <span className={`px-1.5 py-0.2 rounded text-[8px] font-bold border ${bestAch.color.split(' ')[0]} ${bestAch.color.split(' ')[1]} ${bestAch.color.split(' ')[2]}`} title={bestAch.name}>
                          {bestAch.badge}
                        </span>
                      );
                    }
                    return null;
                  })()}
                </p>
                <p className="text-[10px] text-slate-500 flex items-center space-x-1">
                  <Award className="w-3 h-3 text-violet-500" />
                  <span>Elo {oppProfile?.rating || '---'}</span>
                </p>
              </div>
            </div>

            {/* Opponent Clock */}
            <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border font-mono text-lg font-semibold ${
              !isMyTurn && match.status === 'active'
                ? 'bg-violet-950/20 border-violet-500/30 text-violet-300'
                : 'bg-slate-900/60 border-white/5 text-slate-400'
            }`}>
              <Clock className="w-4 h-4" />
              <span>{formatClock(oppClock)}</span>
            </div>
          </div>

          {/* Chessboard container */}
          <div className="chessboard-container aspect-square bg-[#1a1c23]">
            <Chessboard
              options={{
                position: localFen,
                onPieceDrop: ({ sourceSquare, targetSquare }) => onPieceDrop(sourceSquare, targetSquare),
                boardOrientation: isWhite ? 'white' : 'black',
                allowDragging: match.status === 'active' && isMyTurn,
                darkSquareStyle: { backgroundColor: '#779556' },
                lightSquareStyle: { backgroundColor: '#ebecd0' }
              }}
            />
          </div>

          {/* Player Profile and Clock */}
          <div className="flex items-center justify-between glass px-4 py-3 rounded-lg border border-white/5">
            <div className="flex items-center space-x-3">
              <img
                src={myProfile?.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop'}
                alt={myProfile?.displayName || 'Player'}
                className="w-10 h-10 rounded-full object-cover ring-2 ring-slate-800"
              />
              <div>
                <p className="text-sm font-semibold text-slate-300 flex items-center gap-1.5 flex-wrap">
                  <span>{myProfile?.displayName || 'You'} {isWhite ? '(White)' : '(Black)'}</span>
                  {myProfile && myProfile.rating >= 2500 && (
                    <span className="font-serif font-extrabold tracking-wider bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-500 bg-clip-text text-transparent drop-shadow-[0_0_8px_rgba(251,191,36,0.8)] border border-amber-400/60 bg-amber-950/40 px-1.5 py-0.2 rounded text-[8px] uppercase select-none font-bold" title="Grandmaster (Rating 2500+)">
                      GM
                    </span>
                  )}
                  {(() => {
                    const bestAch = getBestAchievement(myProfile?.gameplayCounts);
                    if (bestAch) {
                      return (
                        <span className={`px-1.5 py-0.2 rounded text-[8px] font-bold border ${bestAch.color.split(' ')[0]} ${bestAch.color.split(' ')[1]} ${bestAch.color.split(' ')[2]}`} title={bestAch.name}>
                          {bestAch.badge}
                        </span>
                      );
                    }
                    return null;
                  })()}
                </p>
                <p className="text-[10px] text-slate-500 flex items-center space-x-1">
                  <Award className="w-3 h-3 text-violet-500" />
                  <span>Elo {myProfile?.rating || '---'}</span>
                </p>
              </div>
            </div>

            {/* Player Clock */}
            <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border font-mono text-lg font-semibold ${
              isMyTurn && match.status === 'active'
                ? 'bg-violet-950/20 border-violet-500/30 text-violet-300'
                : 'bg-slate-900/60 border-white/5 text-slate-400'
            }`}>
              <Clock className="w-4 h-4" />
              <span>{formatClock(myClock)}</span>
            </div>
          </div>

        </div>

        {/* Right: Actions, Move List */}
        <div className="lg:col-span-5 flex flex-col space-y-6">
          {/* Action Panel */}
          {match.status === 'active' ? (
            <div className="glass p-6 rounded-xl border border-white/5 space-y-4">
              <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Game Actions</h4>
              
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={handleDrawAction}
                  className={`flex flex-col items-center justify-center p-3.5 rounded-xl border transition-all ${
                    hasOpponentDrawOffer
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300 font-bold'
                      : 'border-white/5 bg-slate-950/40 hover:bg-slate-900/40 text-slate-400 hover:text-white'
                  } text-xs font-semibold cursor-pointer`}
                >
                  <span>{hasOpponentDrawOffer ? 'Accept Draw Offer' : 'Offer Draw'}</span>
                </button>

                <button
                  onClick={handleResign}
                  className="flex flex-col items-center justify-center p-3.5 rounded-xl border border-white/5 bg-slate-950/40 hover:bg-red-500/10 text-slate-400 hover:text-red-400 text-xs font-semibold transition-all cursor-pointer"
                >
                  <span>Resign Game</span>
                </button>
              </div>

              {hasOpponentDrawOffer && (
                <div className="flex items-center space-x-2 text-emerald-400 text-xs bg-emerald-950/20 border border-emerald-900/30 p-3 rounded-lg">
                  <ShieldAlert className="w-4 h-4 flex-shrink-0 animate-bounce" />
                  <span>Opponent offered a draw. Accept draw to settle or make a move to decline.</span>
                </div>
              )}
            </div>
          ) : (
            /* Game Over screen overlay in side panel */
            <div className="glass p-8 rounded-xl border border-white/5 text-center space-y-6 bg-slate-950/20 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-violet-500/5 to-transparent pointer-events-none" />
              
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-widest">Match Result</p>
                <h3 className="text-2xl font-bold tracking-wide mt-1 capitalize text-slate-200">
                  {match.status === 'draw' || match.status === 'stalemate'
                    ? 'Game Drawn'
                    : match.winnerUid === user?.uid
                    ? '🏆 Payout Victory!'
                    : 'Defeat'}
                </h3>
                <p className="text-xs text-slate-400 mt-2 font-light">
                  {match.status === 'checkmate' && 'By Checkmate'}
                  {match.status === 'resigned' && 'By Resignation'}
                  {match.status === 'timeout' && 'By Timeout'}
                  {match.status === 'stalemate' && 'By Stalemate'}
                  {match.status === 'draw' && 'By Mutual Agreement'}
                </p>
              </div>

              {/* Coins Change Showcase */}
              <div className="flex justify-center">
                <div className="bg-slate-900/80 border border-white/5 px-6 py-3.5 rounded-xl flex items-center space-x-3.5">
                  <img src="https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg" alt="Pawn" className="w-8 h-8 filter invert drop-shadow-[0_0_4px_rgba(245,158,11,0.5)] brightness-125" />
                  <div className="text-left">
                    <p className="text-[10px] text-slate-500">Wallet Impact</p>
                    <p className={`text-base font-bold ${
                      match.winnerUid === user?.uid 
                        ? 'text-emerald-400' 
                        : match.winnerUid 
                        ? 'text-red-400' 
                        : 'text-amber-400'
                    }`}>
                      {(() => {
                        const isWinner = match.winnerUid === user?.uid;
                        const isLoser = match.winnerUid && match.winnerUid !== user?.uid;
                        
                        if (match.mode === 'all_in' && match.allInStakes && user) {
                          const oppUid = match.players.find(p => p !== user.uid) || '';
                          const myStakeVal = match.allInStakes[user.uid] || 0;
                          const oppStakeVal = match.allInStakes[oppUid] || 0;
                          
                          if (isWinner) return `+${formatCoins(oppStakeVal)}`;
                          if (isLoser) return `-${formatCoins(myStakeVal)}`;
                          return '0 (Stake Refunded)';
                        }
                        
                        if (isWinner) return `+${formatCoins(match.stake)}`;
                        if (isLoser) return `-${formatCoins(match.stake)}`;
                        return '0 (Stake Refunded)';
                      })()}
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={onExit}
                className="w-full bg-violet-600 hover:bg-violet-500 text-white font-medium py-3 rounded-xl shadow-lg shadow-violet-600/20 hover:shadow-violet-600/30 transition-all border border-violet-500/20 cursor-pointer"
              >
                Back to Dashboard
              </button>
            </div>
          )}

          {/* Moves List Log */}
          <div className="glass p-6 rounded-xl border border-white/5 flex-grow flex flex-col min-h-[280px]">
            <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-4">Moves Log</h4>
            <div className="overflow-y-auto max-h-[220px] flex-grow pr-2 text-left space-y-1 font-mono text-sm">
              {match.moves.length === 0 ? (
                <p className="text-slate-600 text-xs italic">No moves played yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                  {match.moves.reduce((acc: React.ReactNode[], move, idx) => {
                    if (idx % 2 === 0) {
                      const moveNumber = Math.floor(idx / 2) + 1;
                      acc.push(
                        <div key={idx} className="flex justify-between border-b border-white/5 py-1">
                          <span className="text-slate-500 w-8">{moveNumber}.</span>
                          <span className="text-slate-300 font-medium text-right flex-grow">{move}</span>
                        </div>
                      );
                    } else {
                      acc.push(
                        <div key={idx} className="flex justify-end border-b border-white/5 py-1">
                          <span className="text-slate-400 font-medium">{move}</span>
                        </div>
                      );
                    }
                    return acc;
                  }, [])}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
