import React, { useEffect, useState, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useAuth } from '../auth/AuthContext';
import type { Match, UserProfile, MatchStatus } from '../types';
import { makeMove, submitGameAction, settleMatchPayoutAndElo } from '../game/gameService';
import { doc, onSnapshot, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Clock, ShieldAlert, Award, ArrowLeft, Settings, X } from 'lucide-react';
import { formatCoins } from '../utils/format';
import { playMoveSound, playCaptureSound, playCheckSound, playWinSound, playLoseSound, getSoundSettings, updateSoundSettings } from '../utils/sound';
import { getBestAchievement } from '../utils/achievements';

interface ChessGameProps {
  matchId: string;
  onExit: () => void;
}

const PIECE_IMAGES: Record<string, string> = {
  P: 'https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg',
  R: 'https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg',
  N: 'https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg',
  B: 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg',
  Q: 'https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg',
  p: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg',
  r: 'https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg',
  n: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg',
  b: 'https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg',
  q: 'https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg',
};

// Piece point values for material advantage calculation
const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

// Board colour themes
const BOARD_THEMES: Record<string, { dark: string; light: string; label: string }> = {
  green:  { dark: '#779556', light: '#ebecd0', label: 'Green' },
  wood:   { dark: '#b58863', light: '#f0d9b5', label: 'Wood' },
  blue:   { dark: '#4b7db8', light: '#dee3e6', label: 'Blue' },
  walnut: { dark: '#7a4a2e', light: '#d8b98a', label: 'Walnut' },
  ice:    { dark: '#6f8fa9', light: '#dce9f0', label: 'Ice' },
};

export const ChessGame: React.FC<ChessGameProps> = ({ matchId, onExit }) => {
  const { user } = useAuth();
  const [match, setMatch] = useState<Match | null>(null);
  const [whiteProfile, setWhiteProfile] = useState<UserProfile | null>(null);
  const [blackProfile, setBlackProfile] = useState<UserProfile | null>(null);
  const [localFen, setLocalFen] = useState<string>('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  
  // Selected square for click-to-move and legal move dots
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  
  // Settings and Profile dialog visibility states
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<UserProfile | null>(null);
  const [selectedProfileGameplay, setSelectedProfileGameplay] = useState<Record<string, number>>({});
  
  // Sound settings state
  const [settings, setSettings] = useState(getSoundSettings());

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

      // Only sync FEN from DB when a new move arrives or it is the opponent's turn.
      // This prevents the optimistic local FEN from being overwritten by a stale
      // DB snapshot while our write is still in-flight (piece rollback bug).
      const prevMovesCount = matchStateRef.current?.moves?.length ?? 0;
      const newMovesCount = matchData.moves?.length ?? 0;
      const isOpponentTurn = matchData.turn === 'w'
        ? user?.uid !== matchData.whiteUid
        : user?.uid !== matchData.blackUid;
      if (newMovesCount > prevMovesCount || isOpponentTurn || matchData.status !== 'active') {
        setLocalFen(matchData.boardFEN);
        try {
          chessRef.current.load(matchData.boardFEN);
        } catch (e) {
          console.warn('FEN sync mismatch:', e);
        }
      }

      // Fetch profiles if they are not loaded yet
      if (!whiteProfile || !blackProfile) {
        const whiteSnap = await getDoc(doc(db, 'users', matchData.whiteUid));
        const blackSnap = await getDoc(doc(db, 'users', matchData.blackUid));
        
        if (whiteSnap.exists()) setWhiteProfile(whiteSnap.data() as UserProfile);
        if (blackSnap.exists()) setBlackProfile(blackSnap.data() as UserProfile);
      }

      // Sync player disconnection states & initialization timers using heartbeats
      if (matchData.status === 'active') {
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

        if (shouldSettle) {
          settleMatchPayoutAndElo(matchId).catch(err => console.error('Settlement transaction failed:', err));
        } else {
          setTimeout(() => {
            settleMatchPayoutAndElo(matchId).catch(err => console.error('Backup settlement transaction failed:', err));
          }, 1500);
        }
      }
    });

    return () => unsubscribe();
  }, [matchId, whiteProfile, blackProfile, user]);

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
    if (!match || match.status !== 'active') return;

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
    if (!match || match.status !== 'active') return;

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

  // 4. Handle Piece Drops on chessboard
  const onPieceDrop = (sourceSquare: string, targetSquare: string): boolean => {
    if (!match || !isMyTurn || match.status !== 'active') return false;

    try {
      const move = chessRef.current.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q',
      });

      if (move) {
        setSelectedSquare(null);
        const nextFen = chessRef.current.fen();
        setLocalFen(nextFen);

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

  // Click square logic for legal moves and click-to-move
  const onSquareClick = (square: string) => {
    if (!match || !isMyTurn || match.status !== 'active') return;

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
        const success = onPieceDrop(selectedSquare, square);
        if (success) {
          setSelectedSquare(null);
          return;
        }
      }

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
      const data = uSnap.data() as UserProfile;
      setSelectedProfile(data);
      setSelectedProfileGameplay(data.gameplayCounts || {});
    }
  };

  // ── Null Guard for match ──
  if (!match) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400">Loading game room...</p>
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
          ? 'radial-gradient(circle, rgba(239, 68, 68, 0.4) 30%, transparent 35%)' // red dot for capture
          : 'radial-gradient(circle, rgba(139, 92, 246, 0.5) 20%, transparent 25%)', // violet dot for empty square
        cursor: 'pointer',
      };
    });
  }

  const captured = getCapturedPieces();
  // myCaptured = pieces I captured from opponent
  const myCaptured = isWhite ? captured.capturedByWhite : captured.capturedByBlack;
  // oppCaptured = pieces opponent captured from me
  const oppCaptured = isWhite ? captured.capturedByBlack : captured.capturedByWhite;
  // Material advantage from my perspective: positive means I'm up
  const myMaterialAdv = isWhite ? captured.advantage : -captured.advantage;

  const boardTheme = BOARD_THEMES[settings.boardTheme] ?? BOARD_THEMES['green'];

  return (
    <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
      {/* Main Game Screen (Left side Chessboard, Right side player info & logs) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch lg:h-[calc(100vh-120px)]">
        {/* Left half: Chessboard (fits top-to-bottom of the left half) */}
        <div className="lg:col-span-7 flex flex-col justify-center items-center p-4 bg-slate-900/10 rounded-2xl border border-white/5 h-full min-h-[360px]">
          <div className="chessboard-container aspect-square w-full max-w-[min(100%,560px,78vh)] bg-[#1a1c23] shadow-2xl rounded-2xl overflow-hidden border border-white/10">
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
                allowDragging: match.status === 'active' && isMyTurn,
                darkSquareStyle: { backgroundColor: boardTheme.dark },
                lightSquareStyle: { backgroundColor: boardTheme.light },
                squareStyles: customSquareStyles,
                onSquareClick: ({ square }) => onSquareClick(square),
              }}
            />
          </div>
        </div>

        {/* Right half: Actions, Players, Clocks, Info, Moves */}
        <div className="lg:col-span-5 flex flex-col justify-between p-5 bg-slate-950/20 rounded-2xl border border-white/5 space-y-4 max-h-[calc(100vh-120px)] overflow-y-auto">
          {/* Header Action Menu */}
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <button
              onClick={onExit}
              className="flex items-center space-x-2 text-slate-400 hover:text-white transition-colors text-xs font-semibold cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Exit Match</span>
            </button>

            <button
              onClick={() => setShowSettingsModal(true)}
              className="flex items-center space-x-1 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-slate-300 hover:text-white transition-all border border-white/5 text-xs font-semibold cursor-pointer"
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
          </div>

          {/* Prize and Mode Info */}
          <div className="grid grid-cols-2 gap-4 bg-slate-900/60 p-3 rounded-xl border border-white/5 text-left">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Total Prize Pool</p>
              <p className="text-base font-bold text-amber-400 flex items-center space-x-1.5 mt-0.5">
                <img src="https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg" alt="Pawn" className="w-4.5 h-4.5 filter invert drop-shadow-[0_0_2px_rgba(245,158,11,0.5)] brightness-125" />
                <span>
                  {formatCoins(
                    match.mode === 'all_in' && match.allInStakes
                      ? Object.values(match.allInStakes).reduce((sum, val) => sum + val, 0)
                      : match.stake * 2
                  )}
                </span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Game Mode</p>
              <p className="text-xs font-bold text-slate-300 capitalize mt-1.5">
                {match.mode.replace('_', ' ')}
              </p>
            </div>
          </div>

          {/* Opponent Profile and Clock */}
          <div className="flex items-center justify-between glass px-4 py-2.5 rounded-lg border border-white/5 bg-slate-900/10">
            <div className="flex items-center space-x-3 text-left">
              <div 
                className="relative cursor-pointer hover:opacity-85 transition-all"
                onClick={() => handleAvatarClick(oppProfile?.uid || '')}
                title="View Profile Stats"
              >
                <img
                  src={oppProfile?.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop'}
                  alt={oppProfile?.displayName || 'Opponent'}
                  className="w-9 h-9 rounded-full object-cover ring-2 ring-slate-800"
                />
                <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border border-[#121318] ${
                  isOpponentDisconnected ? 'bg-red-500' : 'bg-emerald-500'
                }`} />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 flex-wrap">
                  <span>{oppProfile?.displayName || 'Opponent'} {isWhite ? '(Black)' : '(White)'}</span>
                </p>
                <div className="flex items-center space-x-1.5 mt-0.5">
                  <span className="text-[10px] text-slate-500 flex items-center space-x-0.5">
                    <Award className="w-2.5 h-2.5 text-violet-500" />
                    <span>Elo {oppProfile?.rating || '---'}</span>
                  </span>
                  
                  {/* Captured pieces by opponent (= my pieces they took) */}
                  <div className="flex items-center gap-0.5 bg-slate-950/40 px-1.5 py-0.5 rounded border border-white/5 min-h-[18px] flex-wrap">
                    {oppCaptured.length === 0 ? (
                      <span className="text-[8px] text-slate-600">No captures</span>
                    ) : (
                      oppCaptured.map((p, i) => (
                        <img key={i} src={PIECE_IMAGES[p]} alt={p} className="w-3.5 h-3.5 object-contain" />
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
              !isMyTurn && match.status === 'active' && !isOpponentDisconnected
                ? 'bg-violet-950/20 border-violet-500/30 text-violet-300'
                : 'bg-slate-900/60 border-white/5 text-slate-400'
            }`}>
              <Clock className="w-3.5 h-3.5" />
              <span>{formatClock(oppClock)}</span>
            </div>
          </div>

          {/* Player Profile and Clock */}
          <div className="flex items-center justify-between glass px-4 py-2.5 rounded-lg border border-white/5 bg-slate-900/10">
            <div className="flex items-center space-x-3 text-left">
              <div 
                className="relative cursor-pointer hover:opacity-85 transition-all"
                onClick={() => handleAvatarClick(user?.uid || '')}
                title="View Profile Stats"
              >
                <img
                  src={myProfile?.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop'}
                  alt={myProfile?.displayName || 'Player'}
                  className="w-9 h-9 rounded-full object-cover ring-2 ring-slate-800"
                />
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border border-[#121318] bg-emerald-500" />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 flex-wrap">
                  <span>{myProfile?.displayName || 'You'} {isWhite ? '(White)' : '(Black)'}</span>
                </p>
                <div className="flex items-center space-x-1.5 mt-0.5">
                  <span className="text-[10px] text-slate-500 flex items-center space-x-0.5">
                    <Award className="w-2.5 h-2.5 text-violet-500" />
                    <span>Elo {myProfile?.rating || '---'}</span>
                  </span>
                  
                  {/* Captured pieces by me (= opponent pieces I took) */}
                  <div className="flex items-center gap-0.5 bg-slate-950/40 px-1.5 py-0.5 rounded border border-white/5 min-h-[18px] flex-wrap">
                    {myCaptured.length === 0 ? (
                      <span className="text-[8px] text-slate-600">No captures</span>
                    ) : (
                      myCaptured.map((p, i) => (
                        <img key={i} src={PIECE_IMAGES[p]} alt={p} className="w-3.5 h-3.5 object-contain" />
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
              isMyTurn && match.status === 'active' && !isOpponentDisconnected
                ? 'bg-violet-950/20 border-violet-500/30 text-violet-300'
                : 'bg-slate-900/60 border-white/5 text-slate-400'
            }`}>
              <Clock className="w-3.5 h-3.5" />
              <span>{formatClock(myClock)}</span>
            </div>
          </div>

          {/* Disconnection Warning Message */}
          {match.status === 'active' && isOpponentDisconnected && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl flex items-center justify-between text-amber-300 animate-pulse text-xs text-left">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                <span>Reconnecting your opponent...</span>
              </div>
              <span className="font-mono bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-500/20">
                {reconnectCountdown}s
              </span>
            </div>
          )}

          {/* Action Panel */}
          {match.status === 'active' ? (
            <div className="glass p-4 rounded-xl border border-white/5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleDrawAction}
                  className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all ${
                    hasOpponentDrawOffer
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300 font-bold'
                      : 'border-white/5 bg-slate-950/40 hover:bg-slate-900/40 text-slate-400 hover:text-white'
                  } text-xs font-semibold cursor-pointer`}
                >
                  <span>{hasOpponentDrawOffer ? 'Accept Draw' : 'Offer Draw'}</span>
                </button>

                <button
                  onClick={handleResign}
                  className="flex flex-col items-center justify-center p-2 rounded-xl border border-white/5 bg-slate-950/40 hover:bg-red-500/10 text-slate-400 hover:text-red-400 text-xs font-semibold transition-all cursor-pointer"
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
          ) : (
            /* ── Premium Game Over Result Panel ── */
            (() => {
              const isWinner = match.winnerUid === user?.uid;
              const isDraw = match.status === 'draw' || match.status === 'stalemate';
              const isLoser = !isDraw && !isWinner;

              const resultEmoji = isDraw ? '🤝' : isWinner ? '🏆' : '💀';
              const resultTitle = isDraw ? 'Game Drawn' : isWinner ? 'Victory!' : 'Defeat';
              const borderColor = isDraw ? 'border-amber-500/40' : isWinner ? 'border-emerald-500/40' : 'border-red-500/30';
              const glowBg = isDraw
                ? 'from-amber-500/10 via-transparent'
                : isWinner
                ? 'from-emerald-500/10 via-transparent'
                : 'from-red-500/8 via-transparent';
              const titleColor = isDraw ? 'text-amber-300' : isWinner ? 'text-emerald-300' : 'text-red-400';

              const walletImpact = (() => {
                if (match.mode === 'all_in' && match.allInStakes && user) {
                  const oppUid = match.players.find(p => p !== user.uid) || '';
                  const myStakeVal = match.allInStakes[user.uid] || 0;
                  const oppStakeVal = match.allInStakes[oppUid] || 0;
                  if (isWinner) return { label: `+${formatCoins(oppStakeVal)}`, color: 'text-emerald-400' };
                  if (isLoser) return { label: `-${formatCoins(myStakeVal)}`, color: 'text-red-400' };
                  return { label: '±0 Refunded', color: 'text-amber-400' };
                }
                if (isWinner) return { label: `+${formatCoins(match.stake)}`, color: 'text-emerald-400' };
                if (isLoser) return { label: `-${formatCoins(match.stake)}`, color: 'text-red-400' };
                return { label: '±0 Refunded', color: 'text-amber-400' };
              })();

              const statusLabel = {
                checkmate: 'by Checkmate',
                resigned: 'by Resignation',
                timeout: 'by Timeout',
                stalemate: 'by Stalemate',
                draw: 'by Mutual Agreement',
              }[match.status] || '';

              return (
                <div className={`glass p-5 rounded-2xl border ${borderColor} text-center relative overflow-hidden`}>
                  {/* Animated gradient background */}
                  <div className={`absolute inset-0 bg-gradient-to-b ${glowBg} to-transparent pointer-events-none`} />

                  {/* Result emoji + title */}
                  <div className="relative space-y-1">
                    <div className="text-4xl mb-1">{resultEmoji}</div>
                    <h3 className={`text-xl font-black tracking-tight ${titleColor}`}>{resultTitle}</h3>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-medium">{statusLabel}</p>
                  </div>

                  {/* Divider */}
                  <div className="relative my-3 border-t border-white/5" />

                  {/* Coin impact */}
                  <div className="relative flex justify-center">
                    <div className={`flex items-center gap-2.5 px-4 py-2 rounded-xl border ${
                      isWinner ? 'bg-emerald-950/30 border-emerald-500/20' : isDraw ? 'bg-amber-950/30 border-amber-500/20' : 'bg-red-950/20 border-red-500/20'
                    }`}>
                      <img
                        src="https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg"
                        alt="Coins"
                        className="w-5 h-5 filter invert brightness-125"
                      />
                      <div className="text-left">
                        <p className="text-[8px] text-slate-500 uppercase tracking-widest">Wallet Impact</p>
                        <p className={`text-base font-black ${walletImpact.color}`}>{walletImpact.label}</p>
                      </div>
                    </div>
                  </div>

                  {/* Back button */}
                  <button
                    onClick={onExit}
                    className={`relative mt-4 w-full text-white text-xs font-bold py-2.5 rounded-xl shadow-lg transition-all border cursor-pointer ${
                      isWinner
                        ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-500/30 shadow-emerald-600/20'
                        : isDraw
                        ? 'bg-amber-600 hover:bg-amber-500 border-amber-500/30 shadow-amber-600/20'
                        : 'bg-slate-700 hover:bg-slate-600 border-white/10'
                    }`}
                  >
                    Back to Dashboard
                  </button>
                </div>
              );
            })()
          )}

          {/* Moves List Log */}
          <div className="glass p-4 rounded-xl border border-white/5 flex-grow flex flex-col min-h-[140px] max-h-[180px]">
            <h4 className="text-[10px] font-semibold text-slate-300 uppercase tracking-wide mb-2 text-left">Moves Log</h4>
            <div className="overflow-y-auto pr-2 text-left space-y-1 font-mono text-[10px] flex-grow scrollbar-thin">
              {match.moves.length === 0 ? (
                <p className="text-slate-600 text-xs italic">No moves played yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {match.moves.reduce((acc: React.ReactNode[], move, idx) => {
                    if (idx % 2 === 0) {
                      const moveNumber = Math.floor(idx / 2) + 1;
                      acc.push(
                        <div key={idx} className="flex justify-between border-b border-white/5 py-0.5">
                          <span className="text-slate-500 w-5">{moveNumber}.</span>
                          <span className="text-slate-300 font-medium text-right flex-grow">{move}</span>
                        </div>
                      );
                    } else {
                      acc.push(
                        <div key={idx} className="flex justify-end border-b border-white/5 py-0.5">
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

      {/* ── Settings Modal Popup ── */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4" style={{ zIndex: 10000 }}>
          <div className="glass-card w-full max-w-sm rounded-2xl border border-white/10 flex flex-col shadow-2xl p-6 text-left space-y-5 max-h-[calc(100vh-120px)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-1.5">
                <Settings className="w-4 h-4 text-violet-400" />
                <span>Game Settings</span>
              </h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Music volume */}
              <div className="bg-slate-900/60 p-3.5 rounded-xl border border-white/5 space-y-2">
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
                    updateSoundSettings({ musicVolume, muted: nextMuted });
                  }}
                  className="w-full accent-violet-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              {/* SFX checkbox */}
              <div className="flex items-center justify-between bg-slate-900/60 p-3.5 rounded-xl border border-white/5">
                <span className="text-xs font-semibold text-slate-200">Enable Sound Effects</span>
                <input
                  type="checkbox"
                  checked={settings.effectsEnabled}
                  onChange={() => updateSoundSettings({ effectsEnabled: !settings.effectsEnabled })}
                  className="w-4 h-4 accent-violet-600 rounded border-white/5 bg-slate-900 cursor-pointer"
                />
              </div>

              {/* Legal moves checkbox */}
              <div className="flex items-center justify-between bg-slate-900/60 p-3.5 rounded-xl border border-white/5">
                <span className="text-xs font-semibold text-slate-200">Show Legal Moves Hint</span>
                <input
                  type="checkbox"
                  checked={!!settings.showLegalMoves}
                  onChange={() => updateSoundSettings({ showLegalMoves: !settings.showLegalMoves })}
                  className="w-4 h-4 accent-violet-600 rounded border-white/5 bg-slate-900 cursor-pointer"
                />
              </div>

              {/* Board Theme selector */}
              <div className="bg-slate-900/60 p-3.5 rounded-xl border border-white/5 space-y-2.5">
                <span className="text-xs font-semibold text-slate-200 block">Board Theme</span>
                <div className="grid grid-cols-1 gap-1.5">
                  {Object.entries(BOARD_THEMES).map(([key, theme]) => (
                    <button
                      key={key}
                      onClick={() => {
                        updateSoundSettings({ boardTheme: key });
                        setSettings(s => ({ ...s, boardTheme: key }));
                      }}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg border transition-all cursor-pointer ${
                        settings.boardTheme === key
                          ? 'border-violet-500/60 bg-violet-500/10 text-white'
                          : 'border-white/5 bg-slate-950/40 hover:bg-slate-900/40 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        {/* Mini board preview swatch */}
                        <div className="grid grid-cols-2 gap-[1px] w-5 h-5 rounded overflow-hidden shrink-0">
                          <div style={{ backgroundColor: theme.light }} className="w-2.5 h-2.5" />
                          <div style={{ backgroundColor: theme.dark }} className="w-2.5 h-2.5" />
                          <div style={{ backgroundColor: theme.dark }} className="w-2.5 h-2.5" />
                          <div style={{ backgroundColor: theme.light }} className="w-2.5 h-2.5" />
                        </div>
                        <span className="text-xs font-medium">{theme.label}</span>
                      </div>
                      {settings.boardTheme === key && (
                        <span className="text-violet-400 text-[10px] font-bold">✓ Active</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Profile Details Modal Popup ── */}
      {selectedProfile && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4" style={{ zIndex: 10000 }}>
          <div className="glass-card w-full max-w-sm rounded-2xl border border-white/10 flex flex-col shadow-2xl p-6 text-left space-y-4 max-h-[calc(100vh-120px)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
              <h3 className="text-sm font-bold text-slate-200">User Profile Details</h3>
              <button
                onClick={() => setSelectedProfile(null)}
                className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center space-x-3">
              <img
                src={selectedProfile.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop'}
                alt={selectedProfile.displayName}
                className="w-14 h-14 rounded-full object-cover ring-2 ring-violet-500/50"
              />
              <div className="space-y-0.5">
                <h4 className="text-base font-bold text-white flex items-center gap-1">
                  <span>{selectedProfile.displayName}</span>
                  {selectedProfile.rating >= 2500 && (
                    <span className="font-serif font-extrabold bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-500 bg-clip-text text-transparent border border-amber-400/60 bg-amber-950/40 px-1 rounded text-[7px] uppercase" title="Grandmaster">
                      GM
                    </span>
                  )}
                </h4>
                <p className="text-[10px] text-slate-400 font-mono">Member since: {new Date(selectedProfile.createdAt).toLocaleDateString()}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-900/60 border border-white/5 p-2 rounded-lg text-center">
                <p className="text-[8px] text-slate-500 uppercase tracking-wider">Elo Rating</p>
                <p className="text-base font-bold text-violet-300 mt-0.5">{selectedProfile.rating}</p>
              </div>
              <div className="bg-slate-900/60 border border-white/5 p-2 rounded-lg text-center">
                <p className="text-[8px] text-slate-500 uppercase tracking-wider">Coins Balance</p>
                <p className="text-base font-bold text-amber-400 mt-0.5">{formatCoins(selectedProfile.bankBalance)}</p>
              </div>
            </div>

            <div className="bg-slate-900/60 border border-white/5 p-3 rounded-xl space-y-2">
              <h5 className="text-[10px] font-semibold text-slate-300 uppercase tracking-wide border-b border-white/5 pb-1">Record</h5>
              <div className="grid grid-cols-3 gap-1 text-center text-xs">
                <div className="text-emerald-400 font-bold">
                  <p className="text-[8px] text-slate-500 uppercase">Wins</p>
                  <p className="text-xs mt-0.5">{selectedProfile.wins || 0}</p>
                </div>
                <div className="text-red-400 font-bold">
                  <p className="text-[8px] text-slate-500 uppercase">Losses</p>
                  <p className="text-xs mt-0.5">{selectedProfile.losses || 0}</p>
                </div>
                <div className="text-slate-400 font-bold">
                  <p className="text-[8px] text-slate-500 uppercase">Draws</p>
                  <p className="text-xs mt-0.5">{selectedProfile.draws || 0}</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/60 border border-white/5 p-3 rounded-xl space-y-2">
              <h5 className="text-[10px] font-semibold text-slate-300 uppercase tracking-wide border-b border-white/5 pb-1">Best Achievement</h5>
              {(() => {
                const bestAch = getBestAchievement(selectedProfileGameplay);
                if (bestAch) {
                  return (
                    <div className="flex items-center space-x-2.5 bg-violet-950/20 border border-violet-500/20 p-2 rounded-lg">
                      <span className="text-xl">{bestAch.badge.split(' ')[0]}</span>
                      <div className="text-left">
                        <p className="text-xs font-bold text-violet-300">{bestAch.name}</p>
                        <p className="text-[9px] text-slate-400 leading-tight">{bestAch.description}</p>
                      </div>
                    </div>
                  );
                }
                return <p className="text-[10px] text-slate-500 italic text-center">No achievements unlocked yet.</p>;
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
