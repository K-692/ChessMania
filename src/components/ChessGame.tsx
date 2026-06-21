import React, { useEffect, useState, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useAuth } from '../auth/AuthContext';
import type { Match, UserProfile, MatchStatus } from '../types';
import { makeMove, submitGameAction, settleMatchPayoutAndElo, calculateElo } from '../game/gameService';
import { doc, onSnapshot, getDoc, updateDoc, collection, query, orderBy, addDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Clock, ShieldAlert, Award, ArrowLeft, Settings, X, Send, Check, Loader2 } from 'lucide-react';
import { formatCoins } from '../utils/format';
import { playMoveSound, playCaptureSound, playCheckSound, playWinSound, playLoseSound, getSoundSettings, updateSoundSettings, playNotifySound, playIllegalMoveSound } from '../utils/sound';
import { ProfilePopup } from './ProfilePopup';

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
  const { user, profile, updateCachedProfile, addCachedTransaction, addCachedEloHistory, addCachedFriendUpdate, addCachedMatch, writeBackToFirestore, gameConfig } = useAuth();
  const [match, setMatch] = useState<Match | null>(null);
  const [whiteProfile, setWhiteProfile] = useState<UserProfile | null>(null);
  const [blackProfile, setBlackProfile] = useState<UserProfile | null>(null);
  const [localFen, setLocalFen] = useState<string>('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  
  // Selected square for click-to-move and legal move dots
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  
  // Settings and Profile dialog visibility states
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<UserProfile | null>(null);
  const [hasClosedResultPopup, setHasClosedResultPopup] = useState(false);
  
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
  const [preMoves, setPreMoves] = useState<{ from: string; to: string; promotion?: string }[]>([]);
  const [illegalMoveSquares, setIllegalMoveSquares] = useState<{ from: string; to: string } | null>(null);
  
  const preMovesRef = useRef(preMoves);
  useEffect(() => {
    preMovesRef.current = preMoves;
  }, [preMoves]);

  const getOptimisticState = (baseFen: string, queue: typeof preMoves) => {
    const tempChess = new Chess(baseFen);
    for (const pm of queue) {
      try {
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

  // Update client presence and heartbeat to Firestore
  useEffect(() => {
    if (!user) return;
    const matchRef = doc(db, 'matches', matchId);

    // Initial presence
    updateDoc(matchRef, {
      [`presence.${user.uid}`]: true,
      [`heartbeats.${user.uid}`]: Date.now()
    }).catch(console.warn);

    // 3-second heartbeat loops
    const heartbeatInterval = setInterval(() => {
      updateDoc(matchRef, {
        [`heartbeats.${user.uid}`]: Date.now()
      }).catch(console.warn);
    }, 3000);

    return () => {
      clearInterval(heartbeatInterval);
      // Offline on cleanup
      updateDoc(matchRef, {
        [`presence.${user.uid}`]: false
      }).catch(console.warn);
    };
  }, [matchId, user]);

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

  // Bot movement logic for practice mode
  useEffect(() => {
    if (!match || match.status !== 'active') return;

    const botUid = match.turn === 'w' ? match.whiteUid : match.blackUid;
    const isBotTurn = botUid.startsWith('bot_');

    if (!isBotTurn) return;

    // Guard against race conditions: only play bot move when local FEN matches the synchronized Firestore FEN
    if (localFen !== match.boardFEN) return;

    const timer = setTimeout(async () => {
      try {
        const elo = parseInt(botUid.split('_')[1]) || 800;
        const botColor = match.turn;
        
        const { getBotMove } = await import('../utils/chessBot');
        const move = await getBotMove(localFen, elo, botColor, match.moves);
        
        if (move) {
          const tempChess = new Chess(localFen);
          const moveRes = tempChess.move({
            from: move.from,
            to: move.to,
            promotion: move.promotion || 'q'
          });
          
          if (moveRes) {
            const nextFen = tempChess.fen();
            setLocalFen(nextFen);
            
            await makeMove(matchId, botUid, nextFen, moveRes.san);
            
            if (tempChess.isGameOver()) {
              let status: MatchStatus = 'active';
              let winnerUid: string | null = null;

              if (tempChess.isCheckmate()) {
                status = 'checkmate';
                winnerUid = match.turn === 'w' ? match.whiteUid : match.blackUid;
              } else if (tempChess.isDraw()) {
                status = 'draw';
              } else if (tempChess.isStalemate()) {
                status = 'stalemate';
              }

              if (status !== 'active') {
                const now = Date.now();
                const elapsed = now - match.lastMoveAt;
                const updatedClocks = {
                  ...match.clocks,
                  [botUid]: Math.max(0, match.clocks[botUid] - elapsed),
                };

                await updateDoc(doc(db, 'matches', matchId), {
                  boardFEN: nextFen,
                  clocks: updatedClocks,
                  status,
                  winnerUid,
                  finishedAt: now,
                });
              }
            }
          }
        }
      } catch (err) {
        console.error("Error making bot move:", err);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [match?.turn, match?.status, matchId, localFen]);

  // 2. Fetch match updates in real-time
  useEffect(() => {
    const matchRef = doc(db, 'matches', matchId);

    const unsubscribe = onSnapshot(matchRef, async (docSnap) => {
      if (!docSnap.exists()) return;
      const matchData = docSnap.data() as Match;

      // Close active practice matches older than configured hours
      const expiryHours = gameConfig?.practiceExpiryHours ?? 24;
      if (matchData.mode === 'practice' && matchData.status === 'active' && (Date.now() - matchData.createdAt > expiryHours * 60 * 60 * 1000)) {
        updateDoc(matchRef, {
          status: 'terminated',
          finishedAt: Date.now()
        }).catch(console.warn);
        return;
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

      // Profiles are fetched in a separate effect

      // Sync player disconnection states & initialization timers using heartbeats
      if (matchData.status === 'active' && matchData.mode !== 'practice') {
        const myUid = user?.uid;
        const oppUid = myUid === matchData.whiteUid ? matchData.blackUid : matchData.whiteUid;

        const oppLastActive = matchData.heartbeats?.[oppUid] || 0;
        // Consider opponent offline if heartbeat is older than 10 seconds or not present
        const isOpponentStale = oppLastActive === 0 || (Date.now() - oppLastActive > 10000);

        if (!isOpponentStale) {
          if (matchData.disconnectedUid) {
            updateDoc(matchRef, {
              disconnectedUid: null,
              disconnectedAt: null,
              lastMoveAt: Date.now() // Offset clocks on reconnection
            }).catch(console.warn);
          }
          // Reset lastMoveAt when both join for the first time
          if (matchData.moves.length === 0 && Math.abs(matchData.lastMoveAt - matchData.createdAt) < 5000) {
            updateDoc(matchRef, {
              lastMoveAt: Date.now()
            }).catch(console.warn);
          }
        } else {
          // Opponent detected as stale
          if (!matchData.disconnectedUid) {
            updateDoc(matchRef, {
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

            updateDoc(doc(db, 'matches', matchId), {
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
      if (isOpponentStale && match.moves.length === 0) {
        const elapsed = now - match.createdAt;
        if (elapsed > 60000) {
          if (user?.uid) {
            updateDoc(doc(db, 'matches', matchId), {
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
            updateDoc(doc(db, 'matches', matchId), {
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

  // Subscribe to game messages
  useEffect(() => {
    let isInitial = true;
    const q = query(
      collection(db, 'matches', matchId, 'messages'),
      orderBy('createdAt', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      const msgs: any[] = [];
      snap.forEach((docSnap) => {
        msgs.push({ id: docSnap.id, ...docSnap.data() });
      });
      setGameMessages(msgs);

      if (!isInitial) {
        let hasNewFromOther = false;
        snap.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const data = change.doc.data();
            if (data.senderUid !== user?.uid) {
              hasNewFromOther = true;
            }
          }
        });
        if (hasNewFromOther) {
          playNotifySound();
          if (activeRightTab !== 'chat') {
            setUnreadGameMsgs((prev) => prev + 1);
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
      const q = collection(db, 'matches', id, 'messages');
      const snap = await getDocs(q);
      const deletePromises = snap.docs.map((docSnap) =>
        deleteDoc(doc(db, 'matches', id, 'messages', docSnap.id))
      );
      await Promise.all(deletePromises);
    } catch (err) {
      console.warn("Failed to delete game messages:", err);
    }
  };

  const handleExit = async () => {
    if (match && match.status !== 'active') {
      await deleteGameMessages(matchId);
    }
    onExit();
  };

  useEffect(() => {
    return () => {
      if (matchStateRef.current && matchStateRef.current.status !== 'active') {
        deleteGameMessages(matchId);
      }
    };
  }, [matchId]);

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

            updateDoc(doc(db, 'matches', matchId), {
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
    } else if (settings.preMoveEnabled && preMoves.length < 3) {
      // Pre-move drop handling
      const opt = getOptimisticState(match.boardFEN, preMoves);
      const tempChess = new Chess(opt.fen);
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
    } else if (settings.preMoveEnabled && preMoves.length < 3) {
      const opt = getOptimisticState(match.boardFEN, preMoves);
      const piece = opt.chess.get(square as any);
      const myColor = isWhite ? 'w' : 'b';

      if (selectedSquare) {
        if (selectedSquare === square) {
          setSelectedSquare(null);
          return;
        }

        const moves = opt.chess.moves({
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
    }
  };

  const handlePromote = (pieceType: 'q' | 'n' | 'r' | 'b') => {
    if (!pendingPromotion || !match) return;
    const { from, to } = pendingPromotion;
    setPendingPromotion(null);
    
    if (isMyTurn) {
      executeMove(from, to, pieceType);
    } else {
      const opt = getOptimisticState(match.boardFEN, preMoves);
      const tempChess = new Chess(opt.fen);
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

  const myClock = isWhite ? whiteClock : blackClock;
  const oppClock = isWhite ? blackClock : whiteClock;

  const myProfile = isWhite ? whiteProfile : blackProfile;
  const oppProfile = isWhite ? blackProfile : whiteProfile;

  const hasOpponentDrawOffer = match.drawOffers?.includes(isWhite ? match.blackUid : match.whiteUid);

  // Connection states
  const oppUidForPresence = isWhite ? match.blackUid : match.whiteUid;
  const oppLastActiveTime = match.heartbeats?.[oppUidForPresence] || 0;
  const isOpponentDisconnected = oppLastActiveTime === 0 || (Date.now() - oppLastActiveTime > 10000);

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
      <div className="w-full lg:w-auto lg:h-full flex items-center justify-start bg-slate-900/10 p-0 shrink-0">
        <div className="chessboard-container aspect-square w-full h-auto lg:h-[calc(100vh-64px)] lg:max-h-[calc(100vh-64px)] lg:w-[calc(100vh-64px)] xl:h-[calc(100vh-80px)] xl:max-h-[calc(100vh-80px)] xl:w-[calc(100vh-80px)] bg-[#1a1c23] shadow-2xl overflow-hidden border border-white/10 lg:border-y-0 lg:border-l-0 flex items-center justify-center">
          <Chessboard
            options={{
              position: localFen,
              onPieceDrop: ({ sourceSquare, targetSquare }) => {
                if (targetSquare) {
                  return onPieceDrop(sourceSquare, targetSquare);
                }
                return false;
              },
              boardOrientation: isWhite ? 'white' : 'black',
              allowDragging: match.status === 'active' && (isMyTurn || (settings.preMoveEnabled && preMoves.length < 3)),
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

            <button
              onClick={() => setShowSettingsModal(true)}
              className="flex items-center space-x-1 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-slate-300 hover:text-white transition-all border border-white/5 text-xs font-semibold cursor-pointer"
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
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
                  <span>{oppProfile?.displayName || 'Opponent'} {isWhite ? '(Black)' : '(White)'}</span>
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
          {match.status === 'active' && match.mode !== 'practice' && isOpponentDisconnected && (
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
                  
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!gameMsgInput.trim() || !user) return;
                      const text = gameMsgInput.trim();
                      setGameMsgInput('');
                      try {
                        await addDoc(collection(db, 'matches', matchId, 'messages'), {
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
                </div>
              )}
            </div>
          </div>

          {/* Action Panel (Offer Draw / Resign) */}
          {match.status === 'active' && (
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
                  <span>{myProfile?.displayName || 'You'} {isWhite ? '(White)' : '(Black)'}</span>
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
              const isWinner = match.winnerUid === user?.uid;
              const isDraw = match.status === 'draw' || match.status === 'stalemate';
              const isLoser = !isDraw && !isWinner;

              const resultEmoji = isDraw ? '🤝' : isWinner ? '🏆' : '💀';
              const resultTitle = isDraw ? 'Game Drawn' : isWinner ? 'Victory!' : 'Defeat';
              const titleColor = isDraw ? 'text-amber-300' : isWinner ? 'text-emerald-300' : 'text-red-400';

              const walletImpact = (() => {
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
              let eloDelta = 0;
              const myRating = myProfile ? (myProfile.currentEloRating !== undefined ? myProfile.currentEloRating : myProfile.rating) : 0;
              let newElo = myRating;

              if (myProfile && oppProfile && match.mode !== 'practice' && match.stake > 0) {
                const oppRating = oppProfile.currentEloRating !== undefined ? oppProfile.currentEloRating : oppProfile.rating;
                const myScore = isDraw ? 0.5 : isWinner ? 1 : 0;
                const eloResult = calculateElo(myRating, oppRating, myScore);
                eloDelta = eloResult.delta;
                newElo = Math.max(100, myRating + eloDelta);
              }

              return (
                <div className="space-y-4 text-center">
                  <div className="text-5xl mb-2">{resultEmoji}</div>
                  <h3 className={`text-2xl font-black tracking-tight ${titleColor}`}>{resultTitle}</h3>
                  <p className="text-xs text-slate-500 uppercase tracking-widest font-medium">{statusLabel}</p>

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
                      Coin Balance: <span className="text-slate-200 font-bold">{formatCoins((profile?.currentBalance !== undefined ? profile.currentBalance : profile?.bankBalance) || 0)}</span>
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
