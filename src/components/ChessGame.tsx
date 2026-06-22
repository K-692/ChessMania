import React, { useEffect, useState, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useAuth } from '../auth/AuthContext';
import type { Match, UserProfile, MatchStatus } from '../types';
import { makeMove, submitGameAction, settleMatchPayoutAndElo, calculateElo } from '../game/gameService';
import { doc, getDoc } from 'firebase/firestore';
import { ref, onValue, set, update, push, remove, onDisconnect } from 'firebase/database';
import { db, rtdb } from '../firebase';
import { Clock, ShieldAlert, Award, ArrowLeft, Settings, X, Send, Check, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCoins } from '../utils/format';
import { playMoveSound, playCaptureSound, playCheckSound, playWinSound, playLoseSound, getSoundSettings, updateSoundSettings, playNotifySound, playIllegalMoveSound } from '../utils/sound';
import { ProfilePopup } from './ProfilePopup';
import { NetworkSignal } from './NetworkSignal';
import { parseTimeControl } from '../matchmaking/matchmakingService';

interface ChessGameProps {
  matchId: string;
  onExit: () => void;
}

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

const BOARD_THEMES = [
  '8_BIT', 'BASES', 'BLUE', 'BROWN', 'BUBBLEGUM', 'BURLED_WOOD', 'DARK_WOOD', 'DASH', 'GLASS', 'GRAFFITI', 'GREEN', 'ICY_SEA', 'LIGHT', 'LOLZ', 'MARBLE', 'METAL', 'NEON', 'NEWSPAPER', 'ORANGE', 'OVERLAY', 'PARCHMENT', 'PURPLE', 'RED', 'SAND', 'SKY', 'STONE', 'TAN', 'TOURNAMENT', 'TRANSLUCENT', 'WALNUT'
];

const PIECE_THEMES = [
  '8_BIT', 'ALPHA', 'BASES', 'BLINDFOLD', 'BOOK', 'BUBBLEGUM', 'CASES', 'CLASSIC', 'CLUB', 'CONDAL', 'DASH', 'GAME_ROOM', 'GLASS', 'GOTHIC', 'GRAFFITI', 'ICY_SEA', 'LIGHT', 'LOLZ', 'MARBLE', 'MAYA', 'METAL', 'MODERN', 'NATURE', 'NEO', 'NEO_WOOD', 'NEON', 'NEWSPAPER', 'OCEAN', 'SKY', 'SPACE', 'TIGERS', 'TOURNAMENT', 'VINTAGE', 'WOOD'
];

export const ChessGame: React.FC<ChessGameProps> = ({ matchId, onExit }) => {
  const { user, profile, updateCachedProfile, addCachedTransaction, addCachedEloHistory, addCachedFriendUpdate, addCachedMatch, writeBackToFirestore } = useAuth();
  const [match, setMatch] = useState<Match | null>(null);
  const isSpectator = match ? !match.players.includes(user?.uid || '') : false;
  const [isOpponentDisconnected, setIsOpponentDisconnected] = useState(false);
  const lastHeartbeatChangeTimeRef = useRef<number>(Date.now());
  const lastOppHeartbeatRef = useRef<number>(0);
  const [whiteProfile, setWhiteProfile] = useState<UserProfile | null>(null);
  const [blackProfile, setBlackProfile] = useState<UserProfile | null>(null);
  const [localFen, setLocalFen] = useState<string>('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  
  // Selected square for click-to-move and legal move dots
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  
  // Settings and Profile dialog visibility states
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<UserProfile | null>(null);
  const [hasClosedResultPopup, setHasClosedResultPopup] = useState(true);
  const wasActiveLoadedRef = useRef(false);
  
  // Sound settings state
  const [settings, setSettings] = useState(getSoundSettings());

  const syncSettings = (updatedLocal: Partial<typeof settings>, updatedProfile: Record<string, any>) => {
    updateSoundSettings(updatedLocal);
    setSettings(prev => ({ ...prev, ...updatedLocal }));
    if (profile) {
      updateCachedProfile({
        settings: {
          ...profile.settings,
          ...updatedProfile
        }
      });
    }
  };

  // Pre-move and illegal move visual states
  const [preMoves, setPreMoves] = useState<{ from: string; to: string; promotion?: string }[]>(() => {
    try {
      const saved = sessionStorage.getItem(`checkmate_premoves_${matchId}`);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [illegalMoveSquares, setIllegalMoveSquares] = useState<{ from: string; to: string } | null>(null);
  const [historyIndex, setHistoryIndex] = useState<number>(-2);
  
  const preMovesRef = useRef(preMoves);
  useEffect(() => {
    preMovesRef.current = preMoves;
    try {
      sessionStorage.setItem(`checkmate_premoves_${matchId}`, JSON.stringify(preMoves));
    } catch (e) {}
  }, [preMoves, matchId]);

  useEffect(() => {
    if (match && match.status !== 'active') {
      setPreMoves([]);
      try {
        sessionStorage.removeItem(`checkmate_premoves_${matchId}`);
      } catch (e) {}
    }
  }, [match?.status, matchId]);

  const handleRemovePremove = (indexToRemove: number) => {
    const nextPreMoves = preMoves.filter((_, idx) => idx !== indexToRemove);
    setPreMoves(nextPreMoves);
    if (match) {
      const opt = getOptimisticState(match.boardFEN, nextPreMoves);
      setLocalFen(opt.fen);
      chessRef.current.load(opt.fen);
    }
  };

  const handleClearPremoves = () => {
    setPreMoves([]);
    if (match) {
      setLocalFen(match.boardFEN);
      chessRef.current.load(match.boardFEN);
    }
  };

  const getOptimisticState = (baseFen: string, queue: typeof preMoves) => {
    const tempChess = new Chess(baseFen);
    for (const pm of queue) {
      try {
        const piece = tempChess.get(pm.from as any);
        if (piece && piece.color !== tempChess.turn()) {
          const tokens = tempChess.fen().split(' ');
          tokens[1] = piece.color;
          tempChess.load(tokens.join(' '));
        }
        tempChess.move({
          from: pm.from,
          to: pm.to,
          promotion: pm.promotion || 'q'
        });
      } catch (e) {
        break;
      }
    }
    return {
      fen: tempChess.fen(),
      chess: tempChess
    };
  };

  const getFenForHistoryIndex = (index: number) => {
    if (!match) return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const tempChess = new Chess();
    for (let i = 0; i <= index; i++) {
      try {
        tempChess.move(match.moves[i]);
      } catch (err) {
        console.warn('Replaying history failed at index', i, match.moves[i], err);
        break;
      }
    }
    return tempChess.fen();
  };

  // Game live messaging states
  const [activeRightTab, setActiveRightTab] = useState<'moves' | 'chat'>('moves');
  const [gameMessages, setGameMessages] = useState<{ id: string; senderUid: string; text: string; createdAt: number }[]>([]);
  const [gameMsgInput, setGameMsgInput] = useState('');
  const [unreadGameMsgs, setUnreadGameMsgs] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Countdown for reconnection / starting wait limit
  const [reconnectCountdown, setReconnectCountdown] = useState<number>(60);

  // Ref to hold a local Chess instance for validation
  const chessRef = useRef<Chess>(new Chess());

  // Ref to hold current match state for snapshot closure access
  const matchStateRef = useRef<Match | null>(null);
  useEffect(() => {
    matchStateRef.current = match;
  }, [match]);

  // Stable refs for clock baseline — avoids re-creating the interval on every snapshot
  const clockBaselineRef = useRef<{ lastMoveAt: number; white: number; black: number } | null>(null);

  // Clocks states (rendered with millisecond tickers)
  const [whiteClock, setWhiteClock] = useState<number>(0);
  const [blackClock, setBlackClock] = useState<number>(0);

  const isWhite = user?.uid === match?.whiteUid;
  const isBlack = user?.uid === match?.blackUid;
  const isMyTurn = match ? (match.turn === 'w' && isWhite) || (match.turn === 'b' && isBlack) : false;

  // Real-time synchronization of local settings hook
  useEffect(() => {
    const interval = setInterval(() => {
      setSettings(getSoundSettings());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Update client presence and heartbeat to RTDB (only if playing, not spectating).
  // Uses .info/connected to re-register onDisconnect on every reconnect event,
  // preventing the one-shot onDisconnect from leaving the player stuck as absent.
  useEffect(() => {
    if (!user || !match) return;
    const isSpectator = !match.players.includes(user.uid);
    if (isSpectator) return;

    const presenceRef = ref(rtdb, `matches/${matchId}/presence/${user.uid}`);
    const heartbeatRef = ref(rtdb, `matches/${matchId}/heartbeats/${user.uid}`);
    const connectedRef = ref(rtdb, '.info/connected');

    // Listen for connection state changes and re-register onDisconnect each time
    const unsubConnected = onValue(connectedRef, async (snapshot) => {
      if (snapshot.val() === false) {
        // Disconnected — server-side onDisconnect will handle cleanup
        return;
      }

      // Connected or reconnected: re-register onDisconnect and set presence
      try {
        await onDisconnect(presenceRef).set(false);
        await set(presenceRef, true);
        await set(heartbeatRef, Date.now());
      } catch (err) {
        console.warn("RTDB game presence setup on (re)connect failed:", err);
      }
    });

    // 3-second heartbeat loops for opponent disconnect detection
    const heartbeatInterval = setInterval(() => {
      set(heartbeatRef, Date.now()).catch(console.warn);
    }, 3000);

    return () => {
      unsubConnected();
      clearInterval(heartbeatInterval);
      set(presenceRef, false).catch(console.warn);
    };
  }, [matchId, user, match?.players]);

  // 1. Fetch players profiles separately when match is loaded
  useEffect(() => {
    if (!match) return;
    const fetchProfiles = async () => {
      try {
        if (!whiteProfile) {
          if (match.whiteUid.startsWith('bot_')) {
            const elo = parseInt(match.whiteUid.split('_')[1]) || 800;
            setWhiteProfile({
              uid: match.whiteUid,
              displayName: `Chess Bot (${elo})`,
              photoURL: '/game_modes/practice.png',
              rating: elo,
              currentEloRating: elo,
              bankBalance: 0,
              currentBalance: 0,
              createdAt: Date.now(),
              lastLoginAt: Date.now(),
              zeroBalanceAt: null
            });
          } else {
            const snap = await getDoc(doc(db, 'users', match.whiteUid));
            if (snap.exists()) setWhiteProfile({ uid: snap.id, ...snap.data() } as UserProfile);
          }
        }
        if (!blackProfile) {
          if (match.blackUid.startsWith('bot_')) {
            const elo = parseInt(match.blackUid.split('_')[1]) || 800;
            setBlackProfile({
              uid: match.blackUid,
              displayName: `Chess Bot (${elo})`,
              photoURL: '/game_modes/practice.png',
              rating: elo,
              currentEloRating: elo,
              bankBalance: 0,
              currentBalance: 0,
              createdAt: Date.now(),
              lastLoginAt: Date.now(),
              zeroBalanceAt: null
            });
          } else {
            const snap = await getDoc(doc(db, 'users', match.blackUid));
            if (snap.exists()) setBlackProfile({ uid: snap.id, ...snap.data() } as UserProfile);
          }
        }
      } catch (err) {
        console.warn("Failed to load player profiles:", err);
      }
    };
    fetchProfiles();
  }, [match?.whiteUid, match?.blackUid, whiteProfile, blackProfile]);

  // 2. Fetch match updates in real-time in RTDB
  useEffect(() => {
    const matchRef = ref(rtdb, `matches/${matchId}`);

    const unsubscribe = onValue(matchRef, async (snapshot) => {
      if (!snapshot.exists()) return;
      const matchData = snapshot.val() as Match;

      // Track active transition to show result popup only when transitioning from active in-session
      if (matchData.status === 'active') {
        wasActiveLoadedRef.current = true;
      } else {
        if (wasActiveLoadedRef.current) {
          setHasClosedResultPopup(false);
          wasActiveLoadedRef.current = false;
        }
      }

      const prevMatch = matchStateRef.current;

      // Realtime sound triggers on moves and captures
      if (prevMatch) {
        const oldMovesCount = prevMatch.moves?.length || 0;
        const newMovesCount = matchData.moves?.length || 0;

        if (newMovesCount > oldMovesCount) {
          const isMyLastMove = (isWhite && newMovesCount % 2 === 1) || (isBlack && newMovesCount % 2 === 0);
          if (!isMyLastMove) {
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
          deleteGameMessages(matchId);
        }
      }

      setMatch(matchData);

      // Only sync FEN from DB when a new move arrives or it is the opponent's turn.
      // This prevents the optimistic local FEN from being overwritten by a stale
      // DB snapshot while our write is still in-flight (piece rollback bug).
      const isSpectatorLocal = !matchData.players.includes(user?.uid || '');
      if (isSpectatorLocal) {
        setLocalFen(matchData.boardFEN);
        try {
          chessRef.current.load(matchData.boardFEN);
        } catch (e) {
          console.warn('Spectator FEN sync mismatch:', e);
        }
      } else {
        const prevMovesCount = matchStateRef.current?.moves?.length ?? 0;
        const newMovesCount = matchData.moves?.length ?? 0;
        const isPractice = matchData.mode === 'practice';
        const isOpponentTurn = !isPractice && (matchData.turn === 'w'
          ? user?.uid !== matchData.whiteUid
          : user?.uid !== matchData.blackUid);
        if (newMovesCount > prevMovesCount || isOpponentTurn || matchData.status !== 'active') {
          if (preMovesRef.current.length > 0) {
            const opt = getOptimisticState(matchData.boardFEN, preMovesRef.current);
            setLocalFen(opt.fen);
            chessRef.current.load(opt.fen);
          } else {
            setLocalFen(matchData.boardFEN);
            try {
              chessRef.current.load(matchData.boardFEN);
            } catch (e) {
              console.warn('FEN sync mismatch:', e);
            }
          }
        }
      }

      // Sync player disconnection states & initialization timers using heartbeats
      const isUserPlayer = user && matchData.players.includes(user.uid);
      if (isUserPlayer && matchData.status === 'active' && matchData.mode !== 'practice') {
        const myUid = user.uid;
        const oppUid = myUid === matchData.whiteUid ? matchData.blackUid : matchData.whiteUid;

        const oppLastActive = matchData.heartbeats?.[oppUid] || 0;
        
        // Track heartbeat changes relative to last seen snapshot value to avoid clock skew loops
        if (oppLastActive !== lastOppHeartbeatRef.current) {
          lastOppHeartbeatRef.current = oppLastActive;
          lastHeartbeatChangeTimeRef.current = Date.now();
        }

        const elapsedSinceLastChange = Date.now() - lastHeartbeatChangeTimeRef.current;
        const isOpponentStale = oppLastActive === 0 || (elapsedSinceLastChange > 15000);

        if (!isOpponentStale) {
          if (matchData.disconnectedUid) {
            update(ref(rtdb, `matches/${matchId}`), {
              disconnectedUid: null,
              disconnectedAt: null,
              lastMoveAt: Date.now() // Offset clocks on reconnection
            }).catch(console.warn);
          }
          // Reset lastMoveAt when both join for the first time
          if ((matchData.moves || []).length === 0 && Math.abs(matchData.lastMoveAt - matchData.createdAt) < 5000) {
            update(ref(rtdb, `matches/${matchId}`), {
              lastMoveAt: Date.now()
            }).catch(console.warn);
          }
        } else {
          // Opponent detected as stale
          if (!matchData.disconnectedUid) {
            update(ref(rtdb, `matches/${matchId}`), {
              disconnectedUid: oppUid,
              disconnectedAt: Date.now()
            }).catch(console.warn);
          }
        }
      }

      // If the match ended (status !== 'active') and is not yet settled, run settlement
      if (matchData.status !== 'active' && !(matchData as any).settled) {
        const shouldSettle = matchData.winnerUid 
          ? user?.uid === matchData.winnerUid 
          : user?.uid === matchData.whiteUid;

        const runSettlement = () => {
          if (!user || !profile) return;
          settleMatchPayoutAndElo(matchId, user.uid, profile, addCachedFriendUpdate)
            .then(async (res) => {
              if (res) {
                if (res.profileUpdates) {
                  updateCachedProfile(res.profileUpdates);
                }
                if (res.transactionRecord) {
                  addCachedTransaction(res.transactionRecord);
                }
                if (res.eloHistoryRecord) {
                  addCachedEloHistory(res.eloHistoryRecord);
                }
                if (res.matchRecord) {
                  addCachedMatch(res.matchRecord);
                }
                
                // Push all match updates to Firestore as a single batch
                await writeBackToFirestore(user.uid);
              }
            })
            .catch((err) => console.error('Match settlement failed:', err));
        };

        if (shouldSettle) {
          runSettlement();
        } else {
          setTimeout(runSettlement, 1500);
        }
      }
    });

    return () => unsubscribe();
  }, [matchId, whiteProfile, blackProfile, user]);

  // Hook to monitor connection stability of the opponent with custom ticker (skew-safe)
  useEffect(() => {
    if (!match || match.status !== 'active' || isSpectator || match.mode === 'practice') {
      setIsOpponentDisconnected(false);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastHeartbeatChangeTimeRef.current;
      const isWhite = user?.uid === match.whiteUid;
      const oppUid = isWhite ? match.blackUid : match.whiteUid;
      const oppLastActive = match.heartbeats?.[oppUid] || 0;

      if (oppLastActive === 0 || elapsed > 15000) {
        setIsOpponentDisconnected(true);
      } else {
        setIsOpponentDisconnected(false);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [match?.id, match?.status, match?.heartbeats, isSpectator, user?.uid, match?.whiteUid, match?.blackUid, match?.mode]);

  // Synchronize historyIndex to latest move whenever new moves are played
  const prevMovesLengthRef = useRef(0);
  useEffect(() => {
    if (!match) return;
    const currentLen = match.moves.length;
    const prevLen = prevMovesLengthRef.current;
    prevMovesLengthRef.current = currentLen;

    if (historyIndex === prevLen - 1 || historyIndex === -2 || historyIndex >= currentLen) {
      setHistoryIndex(currentLen - 1);
    }
  }, [match?.moves?.length, historyIndex]);

  // Hook to execute queued pre-moves when it becomes our turn
  useEffect(() => {
    if (!match || match.status !== 'active') return;

    const currentPreMoves = preMovesRef.current;
    if (isMyTurn && currentPreMoves.length > 0) {
      const nextMove = currentPreMoves[0];
      setIllegalMoveSquares(null);

      const officialChess = new Chess(match.boardFEN);
      let moveRes = null;
      try {
        moveRes = officialChess.move({
          from: nextMove.from,
          to: nextMove.to,
          promotion: nextMove.promotion || 'q'
        });
      } catch (err) {}

      if (moveRes) {
        const nextFen = officialChess.fen();
        
        if (officialChess.inCheck()) {
          playCheckSound();
        } else if (moveRes.captured) {
          playCaptureSound();
        } else {
          playMoveSound();
        }

        const remaining = currentPreMoves.slice(1);
        setPreMoves(remaining);

        const opt = getOptimisticState(nextFen, remaining);
        setLocalFen(opt.fen);
        chessRef.current.load(opt.fen);

        makeMove(matchId, user!.uid, nextFen, moveRes.san).catch((err) => {
          console.error('Failed to submit pre-move:', err);
          setPreMoves([]);
          setLocalFen(match.boardFEN);
          chessRef.current.load(match.boardFEN);
        });

        if (officialChess.isGameOver()) {
          let status: MatchStatus = 'active';
          let winnerUid: string | null = null;

          if (officialChess.isCheckmate()) {
            status = 'checkmate';
            winnerUid = user!.uid;
          } else if (officialChess.isDraw()) {
            status = 'draw';
          } else if (officialChess.isStalemate()) {
            status = 'stalemate';
          }

          if (status !== 'active') {
            const now = Date.now();
            const elapsed = now - match.lastMoveAt;
            const updatedClocks = {
              ...match.clocks,
              [user!.uid]: Math.max(0, match.clocks[user!.uid] - elapsed),
            };

            update(ref(rtdb, `matches/${matchId}`), {
              boardFEN: nextFen,
              clocks: updatedClocks,
              status,
              winnerUid,
              finishedAt: now,
            });
          }
        }
      } else {
        playIllegalMoveSound();
        setIllegalMoveSquares({ from: nextMove.from, to: nextMove.to });
        setPreMoves([]);
        setLocalFen(match.boardFEN);
        chessRef.current.load(match.boardFEN);

        setTimeout(() => {
          setIllegalMoveSquares(null);
        }, 1550);
      }
    }
  }, [isMyTurn, match?.boardFEN]);

  // 2. Realtime clock countdowns
  // Sync baseline ref ONLY when lastMoveAt changes (i.e., real move or reconnect reset)
  // This prevents heartbeat snapshots from blinking the clock back to the stored time.
  useEffect(() => {
    if (!match || match.status !== 'active') return;
    const prevBaseline = clockBaselineRef.current;
    if (!prevBaseline || prevBaseline.lastMoveAt !== match.lastMoveAt) {
      clockBaselineRef.current = {
        lastMoveAt: match.lastMoveAt,
        white: match.clocks[match.whiteUid],
        black: match.clocks[match.blackUid],
      };
      setWhiteClock(match.clocks[match.whiteUid]);
      setBlackClock(match.clocks[match.blackUid]);
    }
  }, [match?.lastMoveAt, match?.clocks, match?.whiteUid, match?.blackUid, match?.status]);

  // Ticker — runs independently; reads from stable refs so it never needs to restart on snapshots
  useEffect(() => {
    if (!match || match.status !== 'active' || match.mode === 'practice') return;

    const interval = setInterval(() => {
      const baseline = clockBaselineRef.current;
      if (!baseline) return;
      if (matchStateRef.current?.disconnectedUid) return;

      const now = Date.now();
      const elapsed = now - baseline.lastMoveAt;
      const currentMatch = matchStateRef.current;
      if (!currentMatch) return;

      if (currentMatch.turn === 'w') {
        const whiteRem = Math.max(0, baseline.white - elapsed);
        setWhiteClock(whiteRem);
        if (whiteRem <= 0 && user?.uid === currentMatch.blackUid) {
          submitGameAction(matchId, currentMatch.blackUid, 'resign').catch(console.warn);
        }
      } else {
        const blackRem = Math.max(0, baseline.black - elapsed);
        setBlackClock(blackRem);
        if (blackRem <= 0 && user?.uid === currentMatch.whiteUid) {
          submitGameAction(matchId, currentMatch.whiteUid, 'resign').catch(console.warn);
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [match?.status, matchId, user]);

  // 3. Handle disconnection timeouts (1 minute limit)
  useEffect(() => {
    if (!match || match.status !== 'active' || match.mode === 'practice') return;

    const interval = setInterval(() => {
      const now = Date.now();
      const oppUid = user?.uid === match.whiteUid ? match.blackUid : match.whiteUid;
      const oppLastActive = match.heartbeats?.[oppUid] || 0;
      const isOpponentStale = oppLastActive === 0 || (now - oppLastActive > 10000);

      let time = 60;
      if (match.disconnectedAt) {
        time = Math.max(0, Math.ceil((60000 - (now - match.disconnectedAt)) / 1000));
      } else if (isOpponentStale && match.moves.length === 0) {
        time = Math.max(0, Math.ceil((60000 - (now - match.createdAt)) / 1000));
      }
      setReconnectCountdown(time);

      // Execute timeout victory if 1 minute limit exceeded
      if (isOpponentStale && (match.moves || []).length === 0) {
        const elapsed = now - match.createdAt;
        if (elapsed > 60000) {
          if (user?.uid) {
            update(ref(rtdb, `matches/${matchId}`), {
              status: 'timeout',
              winnerUid: user.uid,
              finishedAt: now,
            }).catch(console.warn);
          }
        }
      }

      if (match.disconnectedUid && match.disconnectedAt) {
        const elapsed = now - match.disconnectedAt;
        if (elapsed > 60000) {
          const winnerUid = match.disconnectedUid === match.whiteUid ? match.blackUid : match.whiteUid;
          if (user?.uid === winnerUid) {
            update(ref(rtdb, `matches/${matchId}`), {
              status: 'timeout',
              winnerUid: winnerUid,
              finishedAt: now,
            }).catch(console.warn);
          }
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [match, user, matchId]);

  // Subscribe to game messages in RTDB
  useEffect(() => {
    let isInitial = true;
    const chatRef = ref(rtdb, `chats/${matchId}`);
    const unsubscribe = onValue(chatRef, (snapshot) => {
      const msgs: any[] = [];
      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          msgs.push({ id: child.key, ...child.val() });
        });
      }
      setGameMessages(msgs);

      if (!isInitial) {
        if (msgs.length > 0) {
          const lastMsg = msgs[msgs.length - 1];
          if (lastMsg.senderUid !== user?.uid) {
            playNotifySound();
            if (activeRightTab !== 'chat') {
              setUnreadGameMsgs((prev) => prev + 1);
            }
          }
        }
      }
      isInitial = false;
    });

    return () => unsubscribe();
  }, [matchId, activeRightTab, user?.uid]);

  // Scroll to bottom when chat becomes active or messages arrive
  useEffect(() => {
    if (activeRightTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setUnreadGameMsgs(0);
    }
  }, [gameMessages, activeRightTab]);

  const deleteGameMessages = async (id: string) => {
    try {
      // Remove match and chat from RTDB
      await remove(ref(rtdb, `chats/${id}`));
      await remove(ref(rtdb, `matches/${id}`));
    } catch (err) {
      console.warn("Failed to delete RTDB game nodes:", err);
    }
  };

  const handleExit = async () => {
    if (match) {
      if (match.status === 'active' && !isSpectator) {
        try {
          await update(ref(rtdb, `matches/${matchId}`), {
            status: 'terminated',
            finishedAt: Date.now()
          });
        } catch (err) {
          console.warn("Failed to terminate match on exit:", err);
        }
      }
      if (match.status !== 'active') {
        await deleteGameMessages(matchId);
      }
    }
    onExit();
  };


  const executeMove = (from: string, to: string, promotion?: string): boolean => {
    if (!match) return false;
    try {
      const move = chessRef.current.move({
        from,
        to,
        promotion,
      });

      if (move) {
        setSelectedSquare(null);
        const nextFen = chessRef.current.fen();
        setLocalFen(nextFen);

        // Optimistic sound play
        if (chessRef.current.inCheck()) {
          playCheckSound();
        } else if (move.captured) {
          playCaptureSound();
        } else {
          playMoveSound();
        }

        makeMove(matchId, user!.uid, nextFen, move.san).catch((err) => {
          console.error('Failed to submit move:', err);
          setLocalFen(match.boardFEN);
          chessRef.current.load(match.boardFEN);
        });

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
            const now = Date.now();
            const elapsed = now - match.lastMoveAt;
            const updatedClocks = {
              ...match.clocks,
              [user!.uid]: Math.max(0, match.clocks[user!.uid] - elapsed),
            };

            update(ref(rtdb, `matches/${matchId}`), {
              boardFEN: nextFen,
              clocks: updatedClocks,
              status,
              winnerUid,
              finishedAt: now,
            });
          }
        }

        return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  };

  // 4. Handle Piece Drops on chessboard
  const onPieceDrop = (sourceSquare: string, targetSquare: string): boolean => {
    if (!match || match.status !== 'active') return false;

    if (isMyTurn) {
      // Check if it is a promotion
      const tempChess = new Chess(chessRef.current.fen());
      const moves = tempChess.moves({ verbose: true });
      const isLegalPromo = moves.some(
        m => m.from === sourceSquare && m.to === targetSquare && m.promotion
      );

      if (isLegalPromo) {
        setPendingPromotion({ from: sourceSquare, to: targetSquare });
        return false; // Snap back, promotion modal choice will execute
      }

      return executeMove(sourceSquare, targetSquare);
    } else if (settings.preMoveEnabled) {
      if (preMoves.length >= 3) {
        playIllegalMoveSound();
        setPreMoves([]);
        setLocalFen(match.boardFEN);
        chessRef.current.load(match.boardFEN);
        return false;
      }
      
      const myColor = isWhite ? 'w' : 'b';
      const opt = getOptimisticState(match.boardFEN, preMoves);
      const tempChess = new Chess(opt.fen);
      
      // Get the piece at the source square
      const piece = tempChess.get(sourceSquare as any);
      if (!piece || piece.color !== myColor) {
        playIllegalMoveSound();
        setPreMoves([]);
        setLocalFen(match.boardFEN);
        chessRef.current.load(match.boardFEN);
        return false; // Can only premove our own pieces
      }

      // Temporarily toggle turn to myColor in tempChess if it is not myColor
      if (tempChess.turn() !== myColor) {
        const tokens = tempChess.fen().split(' ');
        tokens[1] = myColor;
        tempChess.load(tokens.join(' '));
      }

      const moves = tempChess.moves({ verbose: true });
      const isLegalPromo = moves.some(
        m => m.from === sourceSquare && m.to === targetSquare && m.promotion
      );

      if (isLegalPromo) {
        setPendingPromotion({ from: sourceSquare, to: targetSquare });
        return false;
      }

      let moveRes = null;
      try {
        moveRes = tempChess.move({ from: sourceSquare, to: targetSquare });
      } catch (e) {}

      if (moveRes) {
        const nextPreMoves = [...preMoves, { from: sourceSquare, to: targetSquare }];
        setPreMoves(nextPreMoves);
        const newOpt = getOptimisticState(match.boardFEN, nextPreMoves);
        setLocalFen(newOpt.fen);
        chessRef.current.load(newOpt.fen);
        playMoveSound();
        return true;
      } else {
        playIllegalMoveSound();
        setPreMoves([]);
        setLocalFen(match.boardFEN);
        chessRef.current.load(match.boardFEN);
        setIllegalMoveSquares({ from: sourceSquare, to: targetSquare });
        setTimeout(() => setIllegalMoveSquares(null), 1500);
        return false;
      }
    }

    return false;
  };

  // Click square logic for legal moves highlight and click-to-move
  const onSquareClick = (square: string) => {
    if (!match || match.status !== 'active') return;

    if (isMyTurn) {
      const piece = chessRef.current.get(square as any);
      const myColor = isWhite ? 'w' : 'b';

      if (selectedSquare) {
        if (selectedSquare === square) {
          setSelectedSquare(null);
          return;
        }

        const moves = chessRef.current.moves({
          square: selectedSquare as any,
          verbose: true
        });
        const legalMove = moves.find((m: any) => m.to === square);

        if (legalMove) {
          if (legalMove.promotion) {
            setPendingPromotion({ from: selectedSquare, to: square });
            setSelectedSquare(null);
            return;
          }
          const success = onPieceDrop(selectedSquare, square);
          if (success) {
            setSelectedSquare(null);
            return;
          }
        }

        // If clicked on another own piece, select that instead
        if (piece && piece.color === myColor) {
          setSelectedSquare(square);
        } else {
          setSelectedSquare(null);
        }
      } else {
        if (piece && piece.color === myColor) {
          setSelectedSquare(square);
        }
      }
    } else if (settings.preMoveEnabled) {
      const myColor = isWhite ? 'w' : 'b';
      const opt = getOptimisticState(match.boardFEN, preMoves);
      const tempChess = opt.chess;
      
      // Temporarily toggle turn to myColor in tempChess if it is not myColor
      if (tempChess.turn() !== myColor) {
        const tokens = tempChess.fen().split(' ');
        tokens[1] = myColor;
        tempChess.load(tokens.join(' '));
      }

      const piece = tempChess.get(square as any);

      if (preMoves.length >= 3 && selectedSquare) {
        // If clicking a target square to make a 4th premove
        const moves = tempChess.moves({
          square: selectedSquare as any,
          verbose: true
        });
        const legalMove = moves.find((m: any) => m.to === square);
        if (legalMove) {
          playIllegalMoveSound();
          setPreMoves([]);
          setLocalFen(match.boardFEN);
          chessRef.current.load(match.boardFEN);
          setSelectedSquare(null);
          return;
        }
      }

      if (selectedSquare) {
        if (selectedSquare === square) {
          setSelectedSquare(null);
          return;
        }

        const moves = tempChess.moves({
          square: selectedSquare as any,
          verbose: true
        });
        const legalMove = moves.find((m: any) => m.to === square);

        if (legalMove) {
          if (legalMove.promotion) {
            setPendingPromotion({ from: selectedSquare, to: square });
            setSelectedSquare(null);
            return;
          }
          const success = onPieceDrop(selectedSquare, square);
          if (success) {
            setSelectedSquare(null);
            return;
          }
        }

        // If clicked on another own piece, select that instead
        if (piece && piece.color === myColor) {
          setSelectedSquare(square);
        } else {
          playIllegalMoveSound();
          setPreMoves([]);
          setLocalFen(match.boardFEN);
          chessRef.current.load(match.boardFEN);
          setSelectedSquare(null);
        }
      } else {
        if (piece && piece.color === myColor) {
          setSelectedSquare(square);
        }
      }
    }
  };

  const handlePromote = (pieceType: 'q' | 'n' | 'r' | 'b') => {
    if (!pendingPromotion || !match) return;
    const { from, to } = pendingPromotion;
    setPendingPromotion(null);
    
    if (isMyTurn) {
      executeMove(from, to, pieceType);
    } else {
      if (preMoves.length >= 3) {
        playIllegalMoveSound();
        setPreMoves([]);
        setLocalFen(match.boardFEN);
        chessRef.current.load(match.boardFEN);
        return;
      }
      const myColor = isWhite ? 'w' : 'b';
      const opt = getOptimisticState(match.boardFEN, preMoves);
      const tempChess = new Chess(opt.fen);

      // Temporarily toggle turn to myColor in tempChess if it is not myColor
      if (tempChess.turn() !== myColor) {
        const tokens = tempChess.fen().split(' ');
        tokens[1] = myColor;
        tempChess.load(tokens.join(' '));
      }

      let moveRes = null;
      try {
        moveRes = tempChess.move({ from, to, promotion: pieceType });
      } catch (e) {}

      if (moveRes) {
        const nextPreMoves = [...preMoves, { from, to, promotion: pieceType }];
        setPreMoves(nextPreMoves);
        const newOpt = getOptimisticState(match.boardFEN, nextPreMoves);
        setLocalFen(newOpt.fen);
        chessRef.current.load(newOpt.fen);
        playMoveSound();
      } else {
        playIllegalMoveSound();
        setPreMoves([]);
        setLocalFen(match.boardFEN);
        chessRef.current.load(match.boardFEN);
        setIllegalMoveSquares({ from, to });
        setTimeout(() => setIllegalMoveSquares(null), 1500);
      }
    }
  };

  const handleResign = async () => {
    if (!match || !user) return;
    if (window.confirm('Are you sure you want to resign?')) {
      try {
        await submitGameAction(matchId, user.uid, 'resign');
      } catch (err) {
        console.error('Resignation failed:', err);
      }
    }
  };

  const handleDrawAction = async () => {
    if (!match || !user) return;
    const currentOffers = match.drawOffers || [];
    const opponentUid = isWhite ? match.blackUid : match.whiteUid;

    if (currentOffers.includes(opponentUid)) {
      try {
        await submitGameAction(matchId, user.uid, 'accept-draw');
      } catch (err) {
        console.error('Failed to accept draw:', err);
      }
    } else {
      try {
        await submitGameAction(matchId, user.uid, 'offer-draw');
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

  const getPreviousMoveSquares = (): { from: string; to: string } | null => {
    if (!match || !match.moves || match.moves.length === 0) return null;
    const tempChess = new Chess();
    let lastMove: any = null;
    for (const m of match.moves) {
      try {
        lastMove = tempChess.move(m);
      } catch (e) {}
    }
    if (lastMove) {
      return { from: lastMove.from, to: lastMove.to };
    }
    return null;
  };

  const getCapturedPieces = () => {
    const starting: Record<string, number> = {
      p: 8, r: 2, n: 2, b: 2, q: 1,
      P: 8, R: 2, N: 2, B: 2, Q: 1
    };
    const current: Record<string, number> = {
      p: 0, r: 0, n: 0, b: 0, q: 0,
      P: 0, R: 0, N: 0, B: 0, Q: 0
    };

    const board = chessRef.current.board();
    for (const row of board) {
      for (const sq of row) {
        if (sq) {
          const key = sq.color === 'w' ? sq.type.toUpperCase() : sq.type.toLowerCase();
          current[key] = (current[key] || 0) + 1;
        }
      }
    }

    // White pieces captured by black (lowercase = black piece types)
    const capturedByBlack: string[] = [];
    // Black pieces captured by white (uppercase = white piece types)
    const capturedByWhite: string[] = [];

    // capturedByBlack = white pieces no longer on board (sorted by value desc)
    ['Q', 'R', 'B', 'N', 'P'].forEach(t => {
      const diff = starting[t] - (current[t] || 0);
      for (let i = 0; i < diff; i++) capturedByBlack.push(t);
    });

    // capturedByWhite = black pieces no longer on board
    ['q', 'r', 'b', 'n', 'p'].forEach(t => {
      const diff = starting[t] - (current[t] || 0);
      for (let i = 0; i < diff; i++) capturedByWhite.push(t);
    });

    // Calculate material advantage
    const whiteMaterial = capturedByWhite.reduce((s, p) => s + (PIECE_VALUES[p] ?? 0), 0);
    const blackMaterial = capturedByBlack.reduce((s, p) => s + (PIECE_VALUES[p.toLowerCase()] ?? 0), 0);
    const advantage = whiteMaterial - blackMaterial; // positive = white is up

    return { capturedByBlack, capturedByWhite, advantage };
  };

  // Fetch click-to-profile data
  const handleAvatarClick = async (profileUid: string) => {
    if (!profileUid) return;
    const uSnap = await getDoc(doc(db, 'users', profileUid));
    if (uSnap.exists()) {
      const data = { uid: uSnap.id, ...uSnap.data() } as UserProfile;
      setSelectedProfile(data);
    }
  };

  // ── Null Guard for match and profiles ──
  if (!match || !whiteProfile || !blackProfile) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0b0c10]/95 backdrop-blur-md text-white p-4 space-y-8">
        <div className="relative flex justify-center items-center">
          {/* Floating neon background glow */}
          <div className="absolute inset-0 bg-violet-600/15 rounded-full blur-3xl w-48 h-48 mx-auto" />
          
          <div className="relative p-6 bg-slate-900/60 rounded-full border border-white/10 shadow-2xl">
            <Loader2 className="w-16 h-16 text-violet-500 animate-spin relative" />
          </div>
        </div>
        
        <div className="text-center space-y-3 max-w-sm">
          <h3 className="text-2xl font-black tracking-wider bg-gradient-to-r from-violet-400 via-violet-500 to-indigo-400 bg-clip-text text-transparent uppercase">
            Entering Arena
          </h3>
          <p className="text-sm text-slate-400 font-medium font-mono leading-relaxed">
            Synchronizing match data and player profiles...
          </p>
          <div className="flex justify-center items-center gap-1.5 pt-2">
            <span className="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    );
  }

  // Determine displayed clocks based on review historyIndex vs latest move
  const isReviewingHistory = match && (historyIndex !== match.moves.length - 1);

  const displayedWhiteClock = (() => {
    if (!match) return 0;
    if (match.status === 'active' && !isReviewingHistory) {
      return whiteClock;
    }
    // Reviewing or finished game at specific index
    if (historyIndex === -1) {
      // Return initial time
      const initialTime = match.timeControl ? parseTimeControl(match.timeControl).initialTime : (match.clocks[match.whiteUid] || 600000);
      return initialTime;
    }
    if (match.moveDetails && match.moveDetails[historyIndex]) {
      return match.moveDetails[historyIndex].clocks[match.whiteUid];
    }
    return match.clocks[match.whiteUid];
  })();

  const displayedBlackClock = (() => {
    if (!match) return 0;
    if (match.status === 'active' && !isReviewingHistory) {
      return blackClock;
    }
    if (historyIndex === -1) {
      const initialTime = match.timeControl ? parseTimeControl(match.timeControl).initialTime : (match.clocks[match.blackUid] || 600000);
      return initialTime;
    }
    if (match.moveDetails && match.moveDetails[historyIndex]) {
      return match.moveDetails[historyIndex].clocks[match.blackUid];
    }
    return match.clocks[match.blackUid];
  })();

  const myClock = isSpectator ? displayedWhiteClock : (isWhite ? displayedWhiteClock : displayedBlackClock);
  const oppClock = isSpectator ? displayedBlackClock : (isWhite ? displayedBlackClock : displayedWhiteClock);

  const myProfile = isSpectator ? whiteProfile : (isWhite ? whiteProfile : blackProfile);
  const oppProfile = isSpectator ? blackProfile : (isWhite ? blackProfile : whiteProfile);

  const hasOpponentDrawOffer = match.drawOffers?.includes(isWhite ? match.blackUid : match.whiteUid);



  // Custom square highlights styling
  const customSquareStyles: Record<string, React.CSSProperties> = {};

  // Highlight previous move
  const lastMoveSquares = getPreviousMoveSquares();
  if (lastMoveSquares) {
    customSquareStyles[lastMoveSquares.from] = {
      backgroundColor: 'rgba(139, 92, 246, 0.25)', // soft violet overlay
    };
    customSquareStyles[lastMoveSquares.to] = {
      backgroundColor: 'rgba(139, 92, 246, 0.45)', // stronger violet overlay
    };
  }

  // Highlight selected square
  if (selectedSquare) {
    customSquareStyles[selectedSquare] = {
      backgroundColor: 'rgba(251, 191, 36, 0.35)', // soft amber overlay
    };
  }

  // Highlight legal moves with radial dots if enabled in settings
  if (selectedSquare && settings.showLegalMoves) {
    const moves = chessRef.current.moves({
      square: selectedSquare as any,
      verbose: true
    });
    moves.forEach((move: any) => {
      const isCapture = move.captured !== undefined;
      customSquareStyles[move.to] = {
        background: isCapture
          ? 'radial-gradient(circle, rgba(0, 0, 0, 0.4) 30%, transparent 35%)' // black dot for capture
          : 'radial-gradient(circle, rgba(0, 0, 0, 0.4) 20%, transparent 25%)', // black dot for empty square
        cursor: 'pointer',
      };
    });
  }

  // Highlight queued pre-moves
  preMoves.forEach((pm) => {
    customSquareStyles[pm.from] = {
      backgroundColor: 'rgba(244, 63, 94, 0.25)', // soft rose/coral
    };
    customSquareStyles[pm.to] = {
      backgroundColor: 'rgba(244, 63, 94, 0.45)', // stronger rose/coral
    };
  });

  // Highlight illegal move squares if set
  if (illegalMoveSquares) {
    customSquareStyles[illegalMoveSquares.from] = {
      backgroundColor: 'rgba(239, 68, 68, 0.4)',
      boxShadow: 'inset 0 0 0 3px #ef4444',
    };
    customSquareStyles[illegalMoveSquares.to] = {
      backgroundColor: 'rgba(239, 68, 68, 0.6)',
      boxShadow: 'inset 0 0 0 3px #ef4444',
    };
  }

  const captured = getCapturedPieces();
  // myCaptured = pieces I captured from opponent
  const myCaptured = isWhite ? captured.capturedByWhite : captured.capturedByBlack;
  // oppCaptured = pieces opponent captured from me
  const oppCaptured = isWhite ? captured.capturedByBlack : captured.capturedByWhite;
  // Material advantage from my perspective: positive means I'm up
  const myMaterialAdv = isWhite ? captured.advantage : -captured.advantage;

  const boardStyle: React.CSSProperties = {
    backgroundImage: `url('/boards/${settings.boardTheme}.png')`,
    backgroundSize: 'cover',
  };

  const pieceTheme = settings.pieceTheme || 'classic';
  const customPieces: Record<string, (props?: any) => React.JSX.Element> = {};
  const pieceKeys = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK'];
  pieceKeys.forEach((key) => {
    const file = key[0] + key[1].toLowerCase();
    customPieces[key] = (props) => {
      const isPieceSelected = selectedSquare && selectedSquare.toLowerCase() === props?.square?.toLowerCase();
      const defaultOpacity = isPieceSelected ? 0.5 : 1;
      return (
        <img
          src={`/pieces/${pieceTheme}/${file}.png`}
          alt={key}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            pointerEvents: 'none',
            opacity: props?.style?.opacity ?? defaultOpacity,
            ...props?.style,
            ...props?.svgStyle
          }}
        />
      );
    };
  });

  const getPieceImage = (p: string) => {
    const isWhitePiece = p === p.toUpperCase();
    const file = isWhitePiece ? 'w' + p.toLowerCase() : 'b' + p;
    return `/pieces/${settings.pieceTheme || 'classic'}/${file}.png`;
  };

  return (
    <div className="w-full h-auto lg:h-[calc(100vh-64px)] xl:h-[calc(100vh-80px)] flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden bg-transparent">
      {/* Left Column: Chessboard (fits top-to-bottom of the left half) */}
      <div className="w-full lg:w-auto lg:h-full flex flex-col items-center justify-center bg-slate-900/10 p-3 shrink-0">
        <div className="chessboard-container aspect-square w-full h-auto lg:h-[calc(100vh-120px)] lg:max-h-[calc(100vh-120px)] lg:w-[calc(100vh-120px)] xl:h-[calc(100vh-140px)] xl:max-h-[calc(100vh-140px)] xl:w-[calc(100vh-140px)] bg-[#1a1c23] shadow-2xl overflow-hidden border border-white/10 flex items-center justify-center animate-fade-in">
          <Chessboard
            options={{
              position: (match && historyIndex === match.moves.length - 1) ? localFen : getFenForHistoryIndex(historyIndex),
              onPieceDrop: ({ sourceSquare, targetSquare }) => {
                if (targetSquare) {
                  return onPieceDrop(sourceSquare, targetSquare);
                }
                return false;
              },
              boardOrientation: (isWhite || isSpectator) ? 'white' : 'black',
              allowDragging: !isSpectator && match.status === 'active' && historyIndex === match.moves.length - 1 && (isMyTurn || settings.preMoveEnabled),
              animationDurationInMs: 100,
              darkSquareStyle: { backgroundColor: 'transparent' },
              lightSquareStyle: { backgroundColor: 'transparent' },
              boardStyle,
              pieces: customPieces,
              squareStyles: customSquareStyles,
              onSquareClick: ({ square }) => onSquareClick(square),
              onSquareRightClick: () => {
                if (preMoves.length > 0) {
                  setPreMoves([]);
                  setLocalFen(match.boardFEN);
                  chessRef.current.load(match.boardFEN);
                }
              }
            }}
          />
        </div>

        {/* Queued Premoves Bar */}
        {preMoves.length > 0 && (
          <div className="flex items-center space-x-2 mt-2 px-3 py-1.5 bg-slate-950/60 border border-white/10 rounded-lg text-xs w-full max-w-[calc(100vh-120px)] xl:max-w-[calc(100vh-140px)] shrink-0 shadow-lg">
            <span className="text-rose-400 font-bold uppercase tracking-wider text-[10px] shrink-0">
              Queued Premoves:
            </span>
            <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none flex-grow">
              {preMoves.map((pm, idx) => (
                <span
                  key={idx}
                  className="flex items-center space-x-1 bg-rose-500/10 border border-rose-500/30 text-rose-300 px-2 py-0.5 rounded text-[11px] font-mono shrink-0 select-none"
                >
                  <span>{idx + 1}. {pm.from}→{pm.to}{pm.promotion ? `=${pm.promotion.toUpperCase()}` : ''}</span>
                  <button
                    onClick={() => handleRemovePremove(idx)}
                    className="hover:text-red-400 text-rose-400 cursor-pointer text-[10px] font-extrabold ml-1 w-3 h-3 flex items-center justify-center rounded-full hover:bg-rose-500/20"
                    title="Remove this premove"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <button
              onClick={() => handleClearPremoves()}
              className="ml-auto text-slate-500 hover:text-rose-400 text-[10px] uppercase font-bold cursor-pointer transition-colors shrink-0"
              title="Clear all queued premoves (Right-click board also works)"
            >
              Clear All
            </button>
          </div>
        )}
      </div>

      {/* Right Column: Actions, Players, Clocks, Info, Moves */}
      <div className="flex-grow flex flex-col p-4 lg:p-5 bg-slate-950/20 border-t lg:border-t-0 lg:border-l border-white/5 lg:h-full lg:overflow-hidden space-y-2.5">
          {/* Header Action Menu & Game Info */}
          <div className="flex items-center justify-between border-b border-white/5 pb-2.5 shrink-0">
            <button
              onClick={handleExit}
              className="flex items-center space-x-2 text-slate-400 hover:text-white transition-colors text-xs font-semibold cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Exit Match</span>
            </button>

            {/* Mode & Prize capsule */}
            <div className="flex items-center space-x-1.5 px-3 py-1 bg-slate-900/60 border border-white/5 rounded-full text-[11px] font-medium text-slate-300">
              <span className="capitalize">{match.mode.replace('_', ' ')}</span>
              {match.mode !== 'practice' && (
                <>
                  <span className="text-slate-600">•</span>
                  <div className="flex items-center space-x-1 text-amber-400 font-bold">
                    <img src="/coin_pack/100 coins.png" alt="Coin" className="w-3.5 h-3.5 object-contain" />
                    <span>
                      {formatCoins(
                        match.mode === 'all_in' && match.allInStakes
                          ? Object.values(match.allInStakes).reduce((sum, val) => sum + val, 0)
                          : match.stake * 2
                      )}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <NetworkSignal />
              <button
                onClick={() => setShowSettingsModal(true)}
                className="flex items-center space-x-1 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-slate-300 hover:text-white transition-all border border-white/5 text-xs font-semibold cursor-pointer"
              >
                <Settings className="w-4 h-4" />
                <span>Settings</span>
              </button>
            </div>
          </div>

          {/* Opponent Profile and Clock */}
          <div className="flex items-center justify-between glass px-3 py-2 rounded-lg border border-white/5 bg-slate-900/10 shrink-0">
            <div className="flex items-center space-x-3 text-left">
              <div 
                className="relative cursor-pointer hover:opacity-85 transition-all"
                onClick={() => handleAvatarClick(oppProfile?.uid || '')}
                title="View Profile Stats"
              >
                <img
                  src={oppProfile?.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop'}
                  alt={oppProfile?.displayName || 'Opponent'}
                  className="w-8 h-8 rounded-full object-cover ring-2 ring-slate-800"
                />
                <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border border-[#121318] ${
                  (isOpponentDisconnected && match.mode !== 'practice') ? 'bg-red-500' : 'bg-emerald-500'
                }`} />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 flex-wrap">
                  <span>{isSpectator ? (blackProfile?.displayName || 'Black') : (oppProfile?.displayName || 'Opponent')} {isSpectator ? '(Black)' : (isWhite ? '(Black)' : '(White)')}</span>
                </p>
                <div className="flex items-center space-x-1.5 mt-0.5">
                  <span className="text-[10px] text-slate-500 flex items-center space-x-0.5 animate-fade-in">
                    <Award className="w-2.5 h-2.5 text-violet-500" />
                    <span>Elo {oppProfile?.currentEloRating !== undefined ? oppProfile.currentEloRating : (oppProfile?.rating || '---')}</span>
                  </span>
                  
                  {/* Captured pieces by opponent (= my pieces they took) */}
                  <div className="flex items-center gap-0.5 bg-slate-950/40 px-1.5 py-0.5 rounded border border-white/5 min-h-[18px] flex-wrap">
                    {oppCaptured.length === 0 ? (
                      <span className="text-[8px] text-slate-600">No captures</span>
                    ) : (
                      oppCaptured.map((p, i) => (
                        <img key={i} src={getPieceImage(p)} alt={p} className="w-3.5 h-3.5 object-contain" />
                      ))
                    )}
                    {/* Show opponent's material advantage if they are up */}
                    {myMaterialAdv < 0 && (
                      <span className="text-[8px] font-bold text-red-400 ml-0.5">+{Math.abs(myMaterialAdv)}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Opponent Clock */}
            <div className={`flex items-center space-x-2 px-2.5 py-1 rounded-lg border font-mono text-sm font-semibold ${
              !isMyTurn && match.status === 'active' && !(isOpponentDisconnected && match.mode !== 'practice')
                ? 'bg-violet-950/20 border-violet-500/30 text-violet-300'
                : 'bg-slate-900/60 border-white/5 text-slate-400'
            }`}>
              <Clock className="w-3.5 h-3.5" />
              <span>{match.mode === 'practice' ? '∞' : formatClock(oppClock)}</span>
            </div>
          </div>

          {/* Disconnection Warning Message */}
          {match.status === 'active' && match.mode !== 'practice' && !isSpectator && isOpponentDisconnected && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-2.5 rounded-lg flex items-center justify-between text-amber-300 animate-pulse text-xs text-left shrink-0">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                <span>Reconnecting your opponent...</span>
              </div>
              <span className="font-mono bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-500/20">
                {reconnectCountdown}s
              </span>
            </div>
          )}

          {/* Middle Section: Tab Switcher & Content Panel (Flex container that expands to fill remaining space) */}
          <div className="flex-grow flex-1 min-h-0 flex flex-col overflow-hidden bg-slate-900/10 border border-white/5 rounded-xl">
            {/* Tabs for Moves and Chat */}
            {match.mode !== 'practice' && (
              <div className="flex border-b border-white/5 shrink-0 bg-slate-950/20">
                <button
                  onClick={() => setActiveRightTab('moves')}
                  className={`flex-grow py-2 text-center text-xs font-bold transition-all border-b-2 cursor-pointer ${
                    activeRightTab === 'moves'
                      ? 'border-violet-500 text-white'
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Moves Log
                </button>
                <button
                  onClick={() => setActiveRightTab('chat')}
                  className={`flex-grow py-2 text-center text-xs font-bold transition-all border-b-2 cursor-pointer relative ${
                    activeRightTab === 'chat'
                      ? 'border-violet-500 text-white'
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <span>Live Chat</span>
                  {unreadGameMsgs > 0 && (
                    <span className="absolute top-1 right-4 w-2 h-2 bg-red-500 rounded-full" />
                  )}
                </button>
              </div>
            )}

            {/* Content Container (scrolls only inside the lists) */}
            <div className="flex-grow flex flex-col min-h-0 overflow-hidden relative">
              {(match.mode === 'practice' ? 'moves' : activeRightTab) === 'moves' ? (
                /* Moves List Log */
                <div className="p-3 flex-grow flex flex-col min-h-0 overflow-hidden animate-fade-in">
                  <div className="overflow-y-auto pr-2 text-left space-y-1 font-mono text-[10px] flex-grow scrollbar-thin">
                    {match.moves.length === 0 ? (
                      <p className="text-slate-600 text-xs italic">No moves played yet.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                        {match.moves.reduce((acc: React.ReactNode[], move, idx) => {
                          if (idx % 2 === 0) {
                            const moveNumber = Math.floor(idx / 2) + 1;
                            acc.push(
                              <div key={idx} className="flex justify-between border-b border-white/5 py-0.5 animate-fade-in">
                                <span className="text-slate-500 w-5">{moveNumber}.</span>
                                <span className="text-slate-300 font-medium text-right flex-grow">{move}</span>
                              </div>
                            );
                          } else {
                            acc.push(
                              <div key={idx} className="flex justify-end border-b border-white/5 py-0.5 animate-fade-in">
                                <span className="text-slate-400 font-medium">{move}</span>
                              </div>
                            );
                          }
                          return acc;
                        }, [])}
                      </div>
                    )}
                  </div>
                  {/* History Navigation Controls */}
                  <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-white/5 shrink-0 select-none">
                    <button
                      onClick={() => {
                        if (historyIndex > -1) {
                          setHistoryIndex(prev => prev - 1);
                        }
                      }}
                      disabled={!match || historyIndex <= -1}
                      className="flex-grow flex items-center justify-center space-x-1.5 px-3 py-2 bg-slate-900/60 hover:bg-slate-800 border border-white/5 hover:border-white/10 rounded-xl text-xs font-semibold text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:text-white transition-all cursor-pointer"
                      title="Previous Move"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back</span>
                    </button>
                    
                    {match && historyIndex !== match.moves.length - 1 && (
                      <button
                        onClick={() => {
                          setHistoryIndex(match.moves.length - 1);
                        }}
                        className="px-3 py-2 bg-violet-600/20 hover:bg-violet-600/35 border border-violet-500/25 rounded-xl text-[10px] font-bold text-violet-300 uppercase tracking-wider transition-all cursor-pointer"
                        title="Jump to Live Move"
                      >
                        Live
                      </button>
                    )}

                    <button
                      onClick={() => {
                        if (match && historyIndex < match.moves.length - 1) {
                          setHistoryIndex(prev => prev + 1);
                        }
                      }}
                      disabled={!match || historyIndex >= match.moves.length - 1}
                      className="flex-grow flex items-center justify-center space-x-1.5 px-3 py-2 bg-slate-900/60 hover:bg-slate-800 border border-white/5 hover:border-white/10 rounded-xl text-xs font-semibold text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:text-white transition-all cursor-pointer"
                      title="Next Move"
                    >
                      <span>Next</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                /* Live Chat Panel */
                <div className="p-3 flex-grow flex flex-col min-h-0 overflow-hidden justify-between animate-fade-in">
                  <div className="overflow-y-auto pr-2 text-left space-y-2 flex-grow scrollbar-thin text-xs">
                    {gameMessages.length === 0 ? (
                      <p className="text-slate-600 text-xs italic">No messages yet. Send a friendly greeting!</p>
                    ) : (
                      gameMessages.map((msg) => {
                        const isMe = msg.senderUid === user?.uid;
                        const senderName = isMe ? 'You' : (oppProfile?.displayName || 'Opponent');
                        return (
                          <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} animate-fade-in`}>
                            <span className="text-[9px] text-slate-500">{senderName}</span>
                            <div className={`mt-0.5 px-2.5 py-1.5 rounded-lg max-w-[85%] break-words ${
                              isMe ? 'bg-violet-600 text-white rounded-tr-none' : 'bg-slate-900 text-slate-200 rounded-tl-none border border-white/5'
                            }`}>
                              {msg.text}
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  
                  {!isSpectator && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!gameMsgInput.trim() || !user) return;
                        const text = gameMsgInput.trim();
                        setGameMsgInput('');
                        try {
                          const msgRef = push(ref(rtdb, `chats/${matchId}`));
                          await set(msgRef, {
                            senderUid: user.uid,
                            text,
                            createdAt: Date.now()
                          });
                        } catch (err) {
                          console.warn("Failed to send game message:", err);
                        }
                      }}
                      className="flex items-center gap-2 mt-2 pt-2 border-t border-white/5 shrink-0"
                    >
                      <input
                        type="text"
                        placeholder="Send a message..."
                        value={gameMsgInput}
                        onChange={(e) => setGameMsgInput(e.target.value)}
                        className="flex-grow bg-slate-950/60 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500"
                      />
                      <button
                        type="submit"
                        className="bg-violet-600 hover:bg-violet-500 text-white p-1.5 rounded-lg transition-all cursor-pointer flex items-center justify-center"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Action Panel (Offer Draw / Resign) */}
          {match.status === 'active' && !isSpectator && (
            <div className="bg-slate-900/10 p-2.5 rounded-xl border border-white/5 space-y-2 shrink-0">
              <div className="grid grid-cols-2 gap-2">
                {match.mode !== 'practice' && (
                  <button
                    onClick={handleDrawAction}
                    className={`flex flex-col items-center justify-center py-2 px-3 rounded-lg border transition-all ${
                      hasOpponentDrawOffer
                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300 font-bold'
                        : 'border-white/5 bg-slate-950/40 hover:bg-slate-900/40 text-slate-400 hover:text-white'
                    } text-xs font-semibold cursor-pointer`}
                  >
                    <span>{hasOpponentDrawOffer ? 'Accept Draw' : 'Offer Draw'}</span>
                  </button>
                )}

                <button
                  onClick={handleResign}
                  className={`flex flex-col items-center justify-center py-2 px-3 rounded-lg border border-white/5 bg-slate-950/40 hover:bg-red-500/10 text-slate-400 hover:text-red-400 text-xs font-semibold transition-all cursor-pointer ${
                    match.mode === 'practice' ? 'col-span-2' : ''
                  }`}
                >
                  <span>Resign Game</span>
                </button>
              </div>

              {hasOpponentDrawOffer && (
                <div className="flex items-center space-x-2 text-emerald-400 text-[10px] bg-emerald-950/20 border border-emerald-900/30 p-2 rounded-lg text-left">
                  <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0 animate-bounce" />
                  <span>Opponent offered a draw. Accept draw or make a move to decline.</span>
                </div>
              )}
            </div>
          )}

          {/* Player Profile and Clock */}
          <div className="flex items-center justify-between glass px-3 py-2 rounded-lg border border-white/5 bg-slate-900/10 shrink-0">
            <div className="flex items-center space-x-3 text-left">
              <div 
                className="relative cursor-pointer hover:opacity-85 transition-all"
                onClick={() => handleAvatarClick(user?.uid || '')}
                title="View Profile Stats"
              >
                <img
                  src={myProfile?.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop'}
                  alt={myProfile?.displayName || 'Player'}
                  className="w-8 h-8 rounded-full object-cover ring-2 ring-slate-800"
                />
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border border-[#121318] bg-emerald-500" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 flex-wrap">
                  <span>{isSpectator ? (whiteProfile?.displayName || 'White') : (myProfile?.displayName || 'You')} {isSpectator ? '(White)' : (isWhite ? '(White)' : '(Black)')}</span>
                </p>
                <div className="flex items-center space-x-1.5 mt-0.5">
                  <span className="text-[10px] text-slate-500 flex items-center space-x-0.5 animate-fade-in">
                    <Award className="w-2.5 h-2.5 text-violet-500" />
                    <span>Elo {myProfile?.currentEloRating !== undefined ? myProfile.currentEloRating : (myProfile?.rating || '---')}</span>
                  </span>
                  
                  {/* Captured pieces by me (= opponent pieces I took) */}
                  <div className="flex items-center gap-0.5 bg-slate-950/40 px-1.5 py-0.5 rounded border border-white/5 min-h-[18px] flex-wrap">
                    {myCaptured.length === 0 ? (
                      <span className="text-[8px] text-slate-600">No captures</span>
                    ) : (
                      myCaptured.map((p, i) => (
                        <img key={i} src={getPieceImage(p)} alt={p} className="w-3.5 h-3.5 object-contain" />
                      ))
                    )}
                    {/* Show my material advantage if I'm up */}
                    {myMaterialAdv > 0 && (
                      <span className="text-[8px] font-bold text-emerald-400 ml-0.5">+{myMaterialAdv}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Player Clock */}
            <div className={`flex items-center space-x-2 px-2.5 py-1 rounded-lg border font-mono text-sm font-semibold ${
              isMyTurn && match.status === 'active' && !(isOpponentDisconnected && match.mode !== 'practice')
                ? 'bg-violet-950/20 border-violet-500/30 text-violet-300'
                : 'bg-slate-900/60 border-white/5 text-slate-400'
            }`}>
              <Clock className="w-3.5 h-3.5" />
              <span>{match.mode === 'practice' ? '∞' : formatClock(myClock)}</span>
            </div>
          </div>
        </div>

      {/* ── Pawn Promotion Choice Modal ── */}
      {pendingPromotion && (
        <div 
          className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in"
          style={{ zIndex: 10001 }}
        >
          <div className="glass p-6 rounded-2xl border border-white/10 max-w-sm w-full text-center space-y-5 shadow-2xl animate-scale-up text-left">
            <div>
              <h3 className="text-sm font-bold text-slate-200">Pawn Promotion Choice</h3>
              <p className="text-xs text-slate-400 mt-1">Choose the piece to replace your promoted pawn:</p>
            </div>
            
            <div className="grid grid-cols-4 gap-3">
              {[
                { id: 'q', name: 'Queen', key: 'q' },
                { id: 'n', name: 'Knight', key: 'n' },
                { id: 'r', name: 'Rook', key: 'r' },
                { id: 'b', name: 'Bishop', key: 'b' }
              ].map((p) => {
                const color = chessRef.current.turn();
                const pieceTheme = settings.pieceTheme || 'classic';
                const imgSrc = `/pieces/${pieceTheme}/${color}${p.key}.png`;
                return (
                  <button
                    key={p.id}
                    onClick={() => handlePromote(p.id as any)}
                    className="flex flex-col items-center justify-center p-3 bg-slate-900/60 hover:bg-violet-600/30 border border-white/5 hover:border-violet-500 rounded-xl transition-all cursor-pointer group"
                  >
                    <img 
                      src={imgSrc} 
                      alt={p.name} 
                      className="w-12 h-12 object-contain group-hover:scale-110 transition-transform"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `/pieces/classic/${color}${p.key}.png`;
                      }}
                    />
                    <span className="text-[10px] font-semibold text-slate-400 group-hover:text-white mt-1">{p.name}</span>
                  </button>
                );
              })}
            </div>
            
            <button
              onClick={() => setPendingPromotion(null)}
              className="w-full bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white py-2.5 rounded-xl text-xs font-semibold transition-all border border-white/5 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Settings Modal Popup ── */}
      {showSettingsModal && (
        <div 
          onClick={() => setShowSettingsModal(false)}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" 
          style={{ zIndex: 10000 }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="glass-card w-full max-w-lg rounded-2xl border border-white/10 flex flex-col shadow-2xl p-6 text-left space-y-4 max-h-[calc(100vh-80px)] overflow-y-auto animate-fade-in"
          >
            <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                <img src={`/pieces/${settings.pieceTheme || 'classic'}/wn.png`} alt="Knight" className="w-4.5 h-4.5 object-contain" />
                <span>Game Settings</span>
              </h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Music volume */}
              <div className="bg-slate-900/60 p-3 rounded-xl border border-white/5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">Theme Music Volume</span>
                  <span className="text-[10px] font-mono text-slate-400">{Math.round(settings.musicVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={settings.musicVolume}
                  onChange={(e) => {
                    const musicVolume = parseFloat(e.target.value);
                    const nextMuted = musicVolume === 0 ? true : settings.muted;
                    syncSettings(
                      { musicVolume, muted: nextMuted },
                      { musicVolume, musicEnabled: !nextMuted }
                    );
                  }}
                  className="w-full accent-violet-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              {/* SFX, Legal Moves and Pre-moves row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Theme Music Toggle */}
                <div className="flex items-center justify-between bg-slate-900/60 p-3 rounded-xl border border-white/5">
                  <span className="text-xs font-semibold text-slate-200">Theme Music (On/Off)</span>
                  <input
                    type="checkbox"
                    checked={!settings.muted}
                    onChange={() => {
                      const nextMuted = !settings.muted;
                      syncSettings(
                        { muted: nextMuted },
                        { musicEnabled: !nextMuted }
                      );
                    }}
                    className="w-4 h-4 accent-violet-600 rounded border-white/5 bg-slate-900 cursor-pointer"
                  />
                </div>

                {/* SFX checkbox */}
                <div className="flex items-center justify-between bg-slate-900/60 p-3 rounded-xl border border-white/5">
                  <span className="text-xs font-semibold text-slate-200">Enable Sound Effects</span>
                  <input
                    type="checkbox"
                    checked={settings.effectsEnabled}
                    onChange={() => {
                      const nextEffects = !settings.effectsEnabled;
                      syncSettings(
                        { effectsEnabled: nextEffects },
                        { soundEffectsEnabled: nextEffects }
                      );
                    }}
                    className="w-4 h-4 accent-violet-600 rounded border-white/5 bg-slate-900 cursor-pointer"
                  />
                </div>

                {/* Legal moves checkbox */}
                <div className="flex items-center justify-between bg-slate-900/60 p-3 rounded-xl border border-white/5">
                  <span className="text-xs font-semibold text-slate-200">Show Legal Moves Hint</span>
                  <input
                    type="checkbox"
                    checked={!!settings.showLegalMoves}
                    onChange={() => {
                      const nextShow = !settings.showLegalMoves;
                      syncSettings(
                        { showLegalMoves: nextShow },
                        { legalMoveHintsEnabled: nextShow }
                      );
                    }}
                    className="w-4 h-4 accent-violet-600 rounded border-white/5 bg-slate-900 cursor-pointer"
                  />
                </div>

                {/* Pre-move checkbox */}
                <div className="flex items-center justify-between bg-slate-900/60 p-3 rounded-xl border border-white/5">
                  <span className="text-xs font-semibold text-slate-200">Enable Pre-moves (Max 3)</span>
                  <input
                    type="checkbox"
                    checked={!!(settings as any).preMoveEnabled}
                    onChange={() => {
                      const nextPre = !(settings as any).preMoveEnabled;
                      syncSettings(
                        { preMoveEnabled: nextPre },
                        { preMovesEnabled: nextPre }
                      );
                    }}
                    className="w-4 h-4 accent-violet-600 rounded border-white/5 bg-slate-900 cursor-pointer"
                  />
                </div>
              </div>

              {/* Board Theme selector */}
              <div className="bg-slate-900/60 p-3.5 rounded-xl border border-white/5 space-y-2.5">
                <span className="text-xs font-semibold text-slate-200 block">Board Theme</span>
                <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto pr-2 scrollbar-thin">
                  {BOARD_THEMES.map((theme) => {
                    const key = theme.toLowerCase();
                    const isActive = settings.boardTheme === key;
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          syncSettings(
                            { boardTheme: key },
                            { boardTheme: key }
                          );
                        }}
                        className={`flex items-center justify-between p-2 rounded-lg border transition-all cursor-pointer text-left relative overflow-hidden ${
                          isActive
                            ? 'border-violet-500 bg-violet-500/10 text-white font-bold ring-2 ring-violet-500/40'
                            : 'border-white/5 bg-slate-950/40 hover:bg-slate-900/40 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <div 
                            className="w-8 h-8 rounded border border-white/10 shrink-0 select-none shadow-sm bg-cover bg-center"
                            style={{ backgroundImage: `url('/boards/${key}.png')` }}
                          />
                          <span className="text-xs font-semibold text-slate-200 uppercase">
                            {theme.replace(/_/g, ' ').toUpperCase()}
                          </span>
                        </div>
                        {isActive && <Check className="w-4 h-4 text-violet-400 shrink-0 mr-1" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Chess Piece Style selector */}
              <div className="bg-slate-900/60 p-3.5 rounded-xl border border-white/5 space-y-2.5">
                <span className="text-xs font-semibold text-slate-200 block">Chess Piece Style</span>
                <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto pr-2 scrollbar-thin">
                  {PIECE_THEMES.map((theme) => {
                    const key = theme.toLowerCase();
                    const isActive = (settings.pieceTheme || 'classic') === key;
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          syncSettings(
                            { pieceTheme: key },
                            { pieceStyle: key }
                          );
                        }}
                        className={`flex items-center justify-between p-2 rounded-lg border transition-all cursor-pointer text-left relative overflow-hidden ${
                          isActive
                            ? 'border-violet-500 bg-violet-500/10 text-white font-bold ring-2 ring-violet-500/40'
                            : 'border-white/5 bg-slate-950/40 hover:bg-slate-900/40 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded bg-slate-950/40 border border-white/5 flex items-center justify-center p-1">
                            <img 
                              src={`/pieces/${key}/wn.png`} 
                              alt="White Knight" 
                              className="w-full h-full object-contain filter drop-shadow-[0px_2px_4px_rgba(0,0,0,0.5)]" 
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = '/pieces/classic/wn.png';
                              }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-slate-200 uppercase">
                            {theme.replace(/_/g, ' ').toUpperCase()}
                          </span>
                        </div>
                        {isActive && <Check className="w-4 h-4 text-violet-400 shrink-0 mr-1" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* OK Button */}
            <div className="pt-2 border-t border-white/5">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="w-full bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold py-2.5 rounded-xl transition-all cursor-pointer text-center"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Game Over Result Modal Popup ── */}
      {match.status !== 'active' && !hasClosedResultPopup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 style-fade-in" style={{ zIndex: 9999 }}>
          <div className="glass max-w-md w-full rounded-2xl border border-white/10 p-6 shadow-2xl relative space-y-5 text-center">
            {/* Cross Button to close the popup only */}
            <button
              onClick={() => setHasClosedResultPopup(true)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Content of the Popup */}
            {(() => {
              const isWinner = !isSpectator && match.winnerUid === user?.uid;
              const isDraw = match.status === 'draw' || match.status === 'stalemate';
              const isLoser = !isSpectator && !isDraw && !isWinner;

              let resultEmoji = isDraw ? '🤝' : isWinner ? '🏆' : '💀';
              let resultTitle = isDraw ? 'Game Drawn' : isWinner ? 'Victory!' : 'Defeat';
              let titleColor = isDraw ? 'text-amber-300' : isWinner ? 'text-emerald-300' : 'text-red-400';

              if (isSpectator) {
                if (isDraw) {
                  resultEmoji = '🤝';
                  resultTitle = 'Game Drawn';
                  titleColor = 'text-amber-300';
                } else {
                  const winnerName = match.winnerUid === match.whiteUid 
                    ? (whiteProfile?.displayName || 'White') 
                    : (blackProfile?.displayName || 'Black');
                  resultEmoji = '🏆';
                  resultTitle = `${winnerName} Won!`;
                  titleColor = 'text-emerald-300';
                }
              }

              const walletImpact = (() => {
                if (isSpectator) {
                  return { label: 'Spectator Mode', color: 'text-slate-400', net: 0 };
                }
                if (match.mode === 'practice') {
                  return { label: '±0 (Practice Match)', color: 'text-slate-400', net: 0 };
                }
                if (match.stake === 0) {
                  return { label: '±0 (Friendly Match)', color: 'text-slate-400', net: 0 };
                }
                if (match.mode === 'all_in' && match.allInStakes && user) {
                  const oppUid = match.players.find(p => p !== user.uid) || '';
                  const myStakeVal = match.allInStakes[user.uid] || 0;
                  const oppStakeVal = match.allInStakes[oppUid] || 0;
                  if (isWinner) return { label: `+${formatCoins(oppStakeVal)}`, color: 'text-emerald-400', net: oppStakeVal };
                  if (isLoser) return { label: `-${formatCoins(myStakeVal)}`, color: 'text-red-400', net: -myStakeVal };
                  return { label: '±0 Refunded', color: 'text-amber-400', net: 0 };
                }
                if (isWinner) return { label: `+${formatCoins(match.stake)}`, color: 'text-emerald-400', net: match.stake };
                if (isLoser) return { label: `-${formatCoins(match.stake)}`, color: 'text-red-400', net: -match.stake };
                return { label: '±0 Refunded', color: 'text-amber-400', net: 0 };
              })();

              const statusLabel = {
                checkmate: 'by Checkmate',
                resigned: 'by Resignation',
                timeout: 'by Timeout',
                stalemate: 'by Stalemate',
                draw: 'by Mutual Agreement',
                terminated: 'by Auto-Termination',
              }[match.status] || '';

              // Calculate Elo changes
              const myProfile = isWhite ? whiteProfile : blackProfile;
              const oppProfile = isWhite ? blackProfile : whiteProfile;
              const myBalance = myProfile ? (myProfile.currentBalance !== undefined ? myProfile.currentBalance : myProfile.bankBalance) : 0;
              let eloDelta = 0;
              const myRating = myProfile ? (myProfile.currentEloRating !== undefined ? myProfile.currentEloRating : myProfile.rating) : 0;
              let newElo = myRating;

              if (myProfile && oppProfile && match.mode !== 'practice' && match.stake > 0) {
                const oppRating = oppProfile.currentEloRating !== undefined ? oppProfile.currentEloRating : oppProfile.rating;
                const myScore = isDraw ? 0.5 : isWinner ? 1 : 0;
                const eloResult = calculateElo(myRating, oppRating, myScore);
                if (myScore === 0) {
                  const finalDelta = eloResult.delta > 0 ? -eloResult.delta : eloResult.delta;
                  eloDelta = finalDelta;
                } else {
                  eloDelta = eloResult.delta;
                }
                newElo = Math.max(0, myRating + eloDelta);
              }

              const finalCoinBalance = (() => {
                if (match.mode === 'practice') return myBalance;
                if (isDraw) return myBalance + match.stake;
                if (isWinner) {
                  if (match.mode === 'all_in' && match.allInStakes && user) {
                    const oppUid = match.players.find(p => p !== user.uid) || '';
                    const oppStakeVal = match.allInStakes[oppUid] || 0;
                    const myStakeVal = match.allInStakes[user.uid] || 0;
                    return myBalance + myStakeVal + oppStakeVal;
                  }
                  return myBalance + match.stake * 2;
                }
                return myBalance;
              })();

              return (
                <div className="space-y-4 text-center">
                  <div className="text-5xl mb-2">{resultEmoji}</div>
                  <h3 className={`text-2xl font-black tracking-tight ${titleColor}`}>{resultTitle}</h3>
                  <p className="text-xs text-slate-500 uppercase tracking-widest font-medium">{statusLabel}</p>

                  {!isSpectator && (
                    <>
                      <div className="border-t border-white/5 my-4" />

                      {/* Coin Impact */}
                      <div className="flex flex-col items-center gap-3">
                        <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border w-full max-w-[280px] justify-center ${
                          isWinner ? 'bg-emerald-950/20 border-emerald-500/20' : isDraw ? 'bg-amber-950/20 border-amber-500/20' : 'bg-red-950/20 border-red-500/20'
                        }`}>
                          <img
                            src="/coin_pack/100 coins.png"
                            alt="Coins"
                            className="w-6 h-6 object-contain"
                          />
                          <div className="text-left">
                            <p className="text-[9px] text-slate-500 uppercase tracking-widest">Net Coins</p>
                            <p className={`text-base font-black ${walletImpact.color}`}>{walletImpact.label}</p>
                          </div>
                        </div>

                        {/* Final Coin Balance */}
                        <div className="text-xs text-slate-400 font-medium">
                          Coin Balance: <span className="text-slate-200 font-bold">{formatCoins(finalCoinBalance)}</span>
                        </div>
                      </div>

                      <div className="border-t border-white/5 my-4" />

                      {/* Elo Rating Impact */}
                      <div className="flex flex-col items-center gap-2">
                        <div className="text-sm font-semibold text-slate-300">
                          Elo Rating
                        </div>
                        {match.mode === 'practice' || match.stake === 0 ? (
                          <div className="text-xs text-slate-500 italic">Unrated Match</div>
                        ) : (
                          <div className="space-y-1">
                            <div className={`text-lg font-bold ${eloDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {eloDelta >= 0 ? `+${eloDelta}` : eloDelta} Elo
                            </div>
                            <div className="text-xs text-slate-400">
                              New Rating: <span className="text-slate-200 font-bold">{newElo}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  <div className="pt-4 flex flex-col gap-2">
                    {/* Exit Match Button */}
                    <button
                      onClick={handleExit}
                      className="w-full bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold py-3 rounded-xl transition-all cursor-pointer shadow-lg shadow-violet-600/20"
                    >
                      Exit Match
                    </button>
                    {/* Close window only button */}
                    <button
                      onClick={() => setHasClosedResultPopup(true)}
                      className="w-full bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold py-2 rounded-xl transition-all cursor-pointer"
                    >
                      Review Board
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Profile Details Modal Popup ── */}
      {selectedProfile && (
        <ProfilePopup 
          profile={selectedProfile} 
          onClose={() => setSelectedProfile(null)} 
        />
      )}
    </div>
  );
};
