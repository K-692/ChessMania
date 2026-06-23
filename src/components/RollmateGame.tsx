import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useAuth } from '../auth/AuthContext';
import { db, rtdb } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  ref as rRef,
  onValue as rOnValue,
  set as rSet,
  push as rPush,
  remove as rRemove,
  get as rGet,
} from 'firebase/database';
import {
  Home, Settings, SkipForward, ChevronLeft, ChevronRight,
  Flag, Handshake, MessageCircle, X, Send, AlertCircle,
  Trophy, RotateCcw, Crown
} from 'lucide-react';
import { NetworkSignal } from './NetworkSignal';
import { DiceComponent } from './DiceComponent';
import {
  rollDice,
  getPieceTypeForFace,
  getPieceTypeName,
  hasLegalMovesForRoll,
  getLegalMoveSquares,
  getCaptures,
  PIECE_SYMBOLS,
} from '../utils/chess';
import { getSoundSettings } from '../utils/sound';
import { playMoveSound, playCaptureSound, playCheckSound, playWinSound, playIllegalMoveSound } from '../utils/sound';
import type { Match, UserProfile, RollmateMoveRecord, GameChatMessage, RollmateRTDBState } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface RollmateGameProps {
  matchId: string;
  onExit: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Piece image mapping for react-chessboard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the pieces option for react-chessboard v5 using the selected piece theme.
 * Returns a PieceRenderObject where each key is a piece code (e.g. 'wP') and
 * each value is a render function matching react-chessboard's PieceRenderObject signature.
 */
function buildCustomPieces(pieceTheme: string): Record<string, (props?: { fill?: string; square?: string; svgStyle?: React.CSSProperties }) => React.JSX.Element> {
  const pieces = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK'];
  const fileMap: Record<string, string> = {
    wP: 'wp', wN: 'wn', wB: 'wb', wR: 'wr', wQ: 'wq', wK: 'wk',
    bP: 'bp', bN: 'bn', bB: 'bb', bR: 'br', bQ: 'bq', bK: 'bk',
  };
  const result: Record<string, (props?: { fill?: string; square?: string; svgStyle?: React.CSSProperties }) => React.JSX.Element> = {};
  pieces.forEach((p) => {
    const file = fileMap[p];
    result[p] = () => (
      <img
        src={`/pieces/${pieceTheme}/${file}.png`}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        alt={p}
        onError={(e) => { (e.target as HTMLImageElement).src = `/pieces/classic/${file}.png`; }}
      />
    );
  });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Promotion Picker Modal
// ─────────────────────────────────────────────────────────────────────────────

interface PromotionModalProps {
  color: 'w' | 'b';
  pieceTheme: string;
  onSelect: (piece: 'q' | 'r' | 'b' | 'n') => void;
}

const PromotionModal: React.FC<PromotionModalProps> = ({ color, pieceTheme, onSelect }) => {
  const pieces: Array<'q' | 'r' | 'b' | 'n'> = ['q', 'r', 'b', 'n'];
  const prefix = color === 'w' ? 'w' : 'b';
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-zinc-900 border border-violet-500/30 rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-4">
        <h3 className="text-sm font-bold text-white uppercase tracking-widest">
          <Crown className="inline w-4 h-4 mr-1.5 text-amber-400" />
          Promote Pawn
        </h3>
        <div className="flex gap-3">
          {pieces.map((p) => (
            <button
              key={p}
              onClick={() => onSelect(p)}
              className="w-16 h-16 bg-zinc-800 hover:bg-violet-600/30 border border-zinc-700 hover:border-violet-500 rounded-xl flex items-center justify-center transition-all cursor-pointer hover:scale-110"
              title={getPieceTypeName(p)}
            >
              <img
                src={`/pieces/${pieceTheme}/${prefix}${p}.png`}
                alt={p}
                className="w-10 h-10 object-contain"
                onError={(e) => { (e.target as HTMLImageElement).src = `/pieces/classic/${prefix}${p}.png`; }}
              />
            </button>
          ))}
        </div>
        <p className="text-[10px] text-slate-500">Choose a piece for your promoted pawn</p>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Player Profile Card (compact, clickable)
// ─────────────────────────────────────────────────────────────────────────────

interface PlayerCardProps {
  profile: UserProfile | null;
  isActive: boolean;
  color: 'w' | 'b';
  label: string;
}

const PlayerCard: React.FC<PlayerCardProps> = ({ profile, isActive, color, label }) => (
  <div className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition-all ${
    isActive
      ? 'bg-violet-600/10 border-violet-500/40 shadow-lg shadow-violet-500/10'
      : 'bg-zinc-900/60 border-zinc-800'
  }`}>
    <div className="relative shrink-0">
      <img
        src={profile?.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop'}
        alt={profile?.displayName || '?'}
        className="w-8 h-8 rounded-full object-cover border-2 border-zinc-700"
      />
      <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-zinc-900 ${
        color === 'w' ? 'bg-white' : 'bg-zinc-900 border-zinc-600'
      }`} />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-xs font-bold text-white truncate">{profile?.displayName || 'Player'}</p>
      <p className="text-[9px] text-slate-500 uppercase tracking-wider">{label}</p>
    </div>
    {isActive && (
      <div className="flex items-center gap-1 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
        <span className="text-[9px] text-violet-400 font-bold">TURN</span>
      </div>
    )}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Captured Pieces Display
// ─────────────────────────────────────────────────────────────────────────────

interface CapturedPiecesProps {
  label: string;
  pieces: string[];
  pieceTheme: string;
}

const CapturedPieces: React.FC<CapturedPiecesProps> = ({ label, pieces, pieceTheme }) => {
  if (pieces.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[9px] text-slate-600 uppercase tracking-wider font-semibold shrink-0">{label}:</span>
      {pieces.map((p, i) => (
        <img
          key={i}
          src={`/pieces/${pieceTheme}/${p}.png`}
          alt={p}
          className="w-4 h-4 object-contain opacity-80"
          onError={(e) => { (e.target as HTMLImageElement).src = `/pieces/classic/${p}.png`; }}
        />
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Game Chat
// ─────────────────────────────────────────────────────────────────────────────

interface GameChatProps {
  matchId: string;
  currentUser: { uid: string; displayName: string | null; photoURL: string | null };
  currentProfile: UserProfile | null;
  disabled: boolean;
}

const GameChat: React.FC<GameChatProps> = ({ matchId, currentUser, currentProfile, disabled }) => {
  const [messages, setMessages] = useState<GameChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Listen to RTDB chat node for this match session
  useEffect(() => {
    const chatRef = rRef(rtdb, `matches/${matchId}/chat`);
    const unsub = rOnValue(chatRef, (snap) => {
      if (!snap.exists()) { setMessages([]); return; }
      const val = snap.val();
      const msgs: GameChatMessage[] = Object.keys(val).map((k) => ({ id: k, ...val[k] }));
      msgs.sort((a, b) => a.timestamp - b.timestamp);
      setMessages(msgs);
    });
    return () => unsub();
  }, [matchId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || disabled) return;
    setSending(true);
    try {
      const chatRef = rRef(rtdb, `matches/${matchId}/chat`);
      await rPush(chatRef, {
        senderUid: currentUser.uid,
        displayName: currentProfile?.displayName || currentUser.displayName || 'Player',
        photoURL: currentProfile?.photoURL || currentUser.photoURL || '',
        text,
        timestamp: Date.now(),
      });
      setInput('');
    } catch (e) {
      console.warn('Failed to send chat message:', e);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin min-h-0">
        {messages.length === 0 ? (
          <p className="text-[10px] text-slate-600 italic text-center py-4">
            No messages yet. Say something!
          </p>
        ) : (
          messages.map((msg) => {
            const isMine = msg.senderUid === currentUser.uid;
            return (
              <div key={msg.id} className={`flex gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
                <img
                  src={msg.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=40&h=40&fit=crop'}
                  alt=""
                  className="w-5 h-5 rounded-full object-cover shrink-0 mt-0.5"
                />
                <div className={`max-w-[75%] rounded-xl px-2.5 py-1.5 text-[11px] break-words ${
                  isMine
                    ? 'bg-violet-600/20 border border-violet-500/20 text-violet-100'
                    : 'bg-zinc-800 border border-zinc-700 text-slate-200'
                }`}>
                  {!isMine && (
                    <p className="text-[9px] text-slate-500 font-semibold mb-0.5">{msg.displayName}</p>
                  )}
                  <p>{msg.text}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-1.5 mt-2 pt-2 border-t border-zinc-800">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
          placeholder={disabled ? 'Chat closed' : 'Type a message…'}
          disabled={disabled}
          maxLength={200}
          className="flex-1 bg-zinc-800/60 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-zinc-600 outline-none focus:border-violet-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending || disabled}
          className="w-7 h-7 flex items-center justify-center bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 disabled:opacity-50 rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed shrink-0"
        >
          <Send className="w-3 h-3 text-white" />
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Game Result Overlay
// ─────────────────────────────────────────────────────────────────────────────

interface GameResultOverlayProps {
  winnerUid: string | null;
  currentUid: string;
  whiteProfile: UserProfile | null;
  blackProfile: UserProfile | null;
  reason: string;
  onExit: () => void;
}

const GameResultOverlay: React.FC<GameResultOverlayProps> = ({
  winnerUid, currentUid, whiteProfile, blackProfile, reason, onExit
}) => {
  const isDraw = winnerUid === null;
  const isWinner = winnerUid === currentUid;
  const winnerProfile = winnerUid
    ? (whiteProfile?.uid === winnerUid ? whiteProfile : blackProfile)
    : null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 shadow-2xl max-w-sm w-full mx-4 text-center space-y-5">
        <div className="text-5xl">
          {isDraw ? '🤝' : isWinner ? '🏆' : '💀'}
        </div>
        <div className="space-y-1">
          <h2 className="text-2xl font-black text-white">
            {isDraw ? 'Draw!' : isWinner ? 'You Won!' : 'You Lost!'}
          </h2>
          {!isDraw && winnerProfile && (
            <p className="text-sm text-slate-400">
              {winnerProfile.displayName} wins
            </p>
          )}
          <p className="text-xs text-slate-500 capitalize">{reason}</p>
        </div>
        <button
          onClick={onExit}
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white py-3 rounded-xl font-bold text-sm transition-all border border-violet-500/25 cursor-pointer shadow-lg"
        >
          <Home className="w-4 h-4" />
          Return to Dashboard
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main RollmateGame Component
// ─────────────────────────────────────────────────────────────────────────────

export const RollmateGame: React.FC<RollmateGameProps> = ({ matchId, onExit }) => {
  const { user, profile } = useAuth();

  // ── Player data ────────────────────────────────────────────────────────────
  const [matchData, setMatchData] = useState<Match | null>(null);
  const [whiteProfile, setWhiteProfile] = useState<UserProfile | null>(null);
  const [blackProfile, setBlackProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Game state (from RTDB) ─────────────────────────────────────────────────
  const [gameState, setGameState] = useState<RollmateRTDBState | null>(null);
  const [chess] = useState(() => new Chess()); // Local chess engine instance

  // ── Dice state ─────────────────────────────────────────────────────────────
  const [rolling, setRolling] = useState(false);
  const [localDiceResult, setLocalDiceResult] = useState<number | null>(null);

  // ── Board interaction state ─────────────────────────────────────────────────
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [customSquareStyles, setCustomSquareStyles] = useState<Record<string, React.CSSProperties>>({});
  const [promotionPending, setPromotionPending] = useState<{ from: string; to: string } | null>(null);

  // ── Replay mode ─────────────────────────────────────────────────────────────
  const [replayIndex, setReplayIndex] = useState<number>(-1); // -1 = live
  const [replayFen, setReplayFen] = useState<string | null>(null);
  const isReplayMode = replayIndex >= 0;

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activePanel, setActivePanel] = useState<'game' | 'chat'>('game');
  const [showResignConfirm, setShowResignConfirm] = useState(false);
  const [showDrawOffer, setShowDrawOffer] = useState(false);
  const [gameResult, setGameResult] = useState<{
    winnerUid: string | null; reason: string;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Settings ──────────────────────────────────────────────────────────────
  const soundSettings = getSoundSettings();
  const boardTheme = soundSettings.boardTheme || 'green';
  const pieceTheme = soundSettings.pieceTheme || 'classic';
  const showLegalMoves = soundSettings.showLegalMoves !== false;

  // ── Derived values ─────────────────────────────────────────────────────────
  const myColor: 'w' | 'b' | null = matchData
    ? (matchData.whiteUid === user?.uid ? 'w' : matchData.blackUid === user?.uid ? 'b' : null)
    : null;
  const isMyTurn = gameState?.turn === myColor && gameState?.status === 'active';
  const opponentProfile = myColor === 'w' ? blackProfile : whiteProfile;
  const myProfile = myColor === 'w' ? whiteProfile : blackProfile;

  // The dice result to display (local during rolling phase, then from state)
  const displayDiceResult = gameState?.diceRolled ? gameState.diceRoll : localDiceResult;
  const diceRolledPieceType = displayDiceResult !== null ? getPieceTypeForFace(displayDiceResult) : null;

  // Move history for captures
  const moveHistory = gameState?.moveHistory ?? [];
  const { capturedByWhite, capturedByBlack } = getCaptures(moveHistory);

  // Captures as piece file paths (e.g. "bp" for black pawn)
  const capturedByWhiteFiles = capturedByWhite.map((p) => `b${p}`);
  const capturedByBlackFiles = capturedByBlack.map((p) => `w${p}`);

  // Build custom pieces for react-chessboard
  const customPieces = React.useMemo(() => buildCustomPieces(pieceTheme), [pieceTheme]);

  // Board style (theme)
  const boardStyle = React.useMemo(() => ({
    borderRadius: '8px',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
  }), []);

  // ── Load match data + profiles ─────────────────────────────────────────────
  useEffect(() => {
    const matchRef = rRef(rtdb, `matches/${matchId}`);
    const unsub = rOnValue(matchRef, async (snap) => {
      if (!snap.exists()) return;
      const data = snap.val() as Match;
      setMatchData(data);

      if (data.whiteUid && data.blackUid) {
        try {
          const [wDoc, bDoc] = await Promise.all([
            getDoc(doc(db, 'users', data.whiteUid)),
            getDoc(doc(db, 'users', data.blackUid)),
          ]);
          if (wDoc.exists()) setWhiteProfile({ uid: wDoc.id, ...wDoc.data() } as UserProfile);
          if (bDoc.exists()) setBlackProfile({ uid: bDoc.id, ...bDoc.data() } as UserProfile);
        } catch (err) {
          console.error('Failed to fetch profiles:', err);
        }
      }
      setLoading(false);
    });
    return () => unsub();
  }, [matchId]);

  // ── Subscribe to RTDB game state ──────────────────────────────────────────
  useEffect(() => {
    const stateRef = rRef(rtdb, `matches/${matchId}/gameState`);
    const unsub = rOnValue(stateRef, (snap) => {
      if (!snap.exists()) {
        // Initialize game state on first load if white player
        return;
      }
      const state = snap.val() as RollmateRTDBState;
      setGameState(state);

      // Sync local chess instance to current FEN
      try {
        chess.load(state.fen);
      } catch (e) {
        console.warn('Failed to load FEN:', e);
      }

      // Check if game just ended
      if (state.status === 'completed' || state.status === 'terminated') {
        if (!gameResult) {
          setGameResult({ winnerUid: state.winnerUid, reason: 'Game over' });
        }
      }

      // Check for incoming draw offer
      if (state.drawOffer && state.drawOffer.fromUid !== user?.uid) {
        setShowDrawOffer(true);
      }
    });
    return () => unsub();
  }, [matchId, chess, user?.uid]);

  // ── Initialize game state if needed ──────────────────────────────────────
  useEffect(() => {
    if (!matchData || !user) return;

    const initState = async () => {
      const stateRef = rRef(rtdb, `matches/${matchId}/gameState`);
      const snap = await rGet(stateRef);
      if (!snap.exists()) {
        // Only white player initializes the state to avoid race conditions
        if (matchData.whiteUid === user.uid) {
          const initialState: RollmateRTDBState = {
            fen: new Chess().fen(),
            turn: 'w',
            diceRoll: null,
            diceRolled: false,
            status: 'active',
            winnerUid: null,
            drawOffer: null,
            moveHistory: [],
            moveCount: 0,
          };
          await rSet(stateRef, initialState);
        }
      }
    };

    initState().catch(console.error);
  }, [matchData, matchId, user]);

  // ── Dice roll handler ─────────────────────────────────────────────────────
  const handleRollDice = useCallback(async () => {
    if (!isMyTurn || gameState?.diceRolled || rolling || !myColor) return;

    setRolling(true);
    setLocalDiceResult(null);

    // Animate for 700ms
    await new Promise((r) => setTimeout(r, 700));

    const faceIndex = rollDice();
    const pieceType = getPieceTypeForFace(faceIndex);
    setLocalDiceResult(faceIndex);
    setRolling(false);

    // Check if this roll has any legal moves
    const hasLegal = hasLegalMovesForRoll(chess, myColor, pieceType);

    // Write the dice roll to RTDB
    const stateRef = rRef(rtdb, `matches/${matchId}/gameState`);
    const currentState = gameState!;

    if (!hasLegal) {
      // Auto-skip: record a skip move, flip turn
      const skipRecord: RollmateMoveRecord = {
        moveNumber: (currentState.moveCount ?? 0) + 1,
        san: `(skip)`,
        from: '',
        to: '',
        fen: chess.fen(),
        diceRoll: faceIndex,
        pieceType,
        timestamp: Date.now(),
        skipped: true,
      };

      const newHistory = [...(currentState.moveHistory ?? []), skipRecord];
      setStatusMessage(`No ${getPieceTypeName(pieceType)} moves — turn skipped!`);
      setTimeout(() => setStatusMessage(''), 3000);

      await rSet(stateRef, {
        ...currentState,
        diceRoll: faceIndex,
        diceRolled: false,
        turn: currentState.turn === 'w' ? 'b' : 'w',
        moveHistory: newHistory,
        moveCount: (currentState.moveCount ?? 0) + 1,
      });
    } else {
      // Update state with dice roll and wait for player to move
      await rSet(stateRef, {
        ...currentState,
        diceRoll: faceIndex,
        diceRolled: true,
      });
      setStatusMessage(`Roll: ${getPieceTypeName(pieceType)} — choose your move!`);
    }
  }, [isMyTurn, gameState, rolling, myColor, chess, matchId]);

  // ── Manual skip handler ───────────────────────────────────────────────────
  const handleSkip = useCallback(async () => {
    if (!isMyTurn || !gameState?.diceRolled || !myColor) return;
    if (!diceRolledPieceType) return;

    // Verify there are actually no legal moves (skip must be valid)
    const hasLegal = hasLegalMovesForRoll(chess, myColor, diceRolledPieceType);
    if (hasLegal) {
      playIllegalMoveSound();
      setStatusMessage('You still have legal moves — you cannot skip!');
      setTimeout(() => setStatusMessage(''), 2500);
      return;
    }

    const currentState = gameState;
    const skipRecord: RollmateMoveRecord = {
      moveNumber: (currentState.moveCount ?? 0) + 1,
      san: '(skip)',
      from: '',
      to: '',
      fen: chess.fen(),
      diceRoll: currentState.diceRoll!,
      pieceType: diceRolledPieceType,
      timestamp: Date.now(),
      skipped: true,
    };

    const stateRef = rRef(rtdb, `matches/${matchId}/gameState`);
    await rSet(stateRef, {
      ...currentState,
      diceRoll: null,
      diceRolled: false,
      turn: currentState.turn === 'w' ? 'b' : 'w',
      moveHistory: [...(currentState.moveHistory ?? []), skipRecord],
      moveCount: (currentState.moveCount ?? 0) + 1,
    });
  }, [isMyTurn, gameState, myColor, chess, matchId, diceRolledPieceType]);

  // ── Board square click handler ────────────────────────────────────────────
  const handleSquareClick = useCallback((square: string) => {
    if (!isMyTurn || !gameState?.diceRolled || !myColor || isReplayMode) return;
    if (!diceRolledPieceType) return;

    const piece = chess.get(square as any);

    // Selecting a piece
    if (piece && piece.color === myColor && piece.type === diceRolledPieceType) {
      setSelectedSquare(square);
      if (showLegalMoves) {
        setCustomSquareStyles(getLegalMoveSquares(chess, square, diceRolledPieceType, myColor));
      }
      return;
    }

    // Attempting a move from selected square
    if (selectedSquare) {
      executeMoveIfLegal(selectedSquare, square);
    }
  }, [isMyTurn, gameState, myColor, chess, diceRolledPieceType, selectedSquare, isReplayMode, showLegalMoves]);


  // ── Execute a legal move ──────────────────────────────────────────────────
  const executeMoveIfLegal = useCallback((from: string, to: string, promotionPiece?: string): boolean => {
    if (!gameState || !myColor || !diceRolledPieceType) return false;

    // Check for pawn promotion
    const piece = chess.get(from as any);
    if (piece?.type === 'p') {
      const toRank = to[1];
      if ((myColor === 'w' && toRank === '8') || (myColor === 'b' && toRank === '1')) {
        if (!promotionPiece) {
          setPromotionPending({ from, to });
          return true; // Don't return false — we'll complete after user picks
        }
      }
    }

    try {
      const moveResult = chess.move({
        from: from as any,
        to: to as any,
        promotion: (promotionPiece as any) || undefined,
      });

      if (!moveResult) {
        playIllegalMoveSound();
        setSelectedSquare(null);
        setCustomSquareStyles({});
        return false;
      }

      // Move succeeded — play sounds
      if (moveResult.captured) {
        playCaptureSound();
      } else {
        playMoveSound();
      }

      if (chess.isCheck()) playCheckSound();

      setSelectedSquare(null);
      setCustomSquareStyles({});

      // Detect game end conditions
      const newFen = chess.fen();
      let newStatus: 'active' | 'completed' = 'active';
      let newWinnerUid: string | null = null;
      let endReason = '';

      if (chess.isCheckmate()) {
        newStatus = 'completed';
        newWinnerUid = user?.uid ?? null;
        endReason = 'checkmate';
        playWinSound();
      } else if (chess.isStalemate()) {
        newStatus = 'completed';
        newWinnerUid = null;
        endReason = 'stalemate';
      } else if (chess.isInsufficientMaterial()) {
        newStatus = 'completed';
        newWinnerUid = null;
        endReason = 'insufficient material';
      } else if (chess.isThreefoldRepetition()) {
        newStatus = 'completed';
        newWinnerUid = null;
        endReason = 'threefold repetition';
      } else if (chess.isDraw()) {
        newStatus = 'completed';
        newWinnerUid = null;
        endReason = 'draw (50-move rule)';
      }

      // Build move record for history
      const moveRecord: RollmateMoveRecord = {
        moveNumber: (gameState.moveCount ?? 0) + 1,
        san: moveResult.san,
        from,
        to,
        fen: newFen,
        diceRoll: gameState.diceRoll!,
        pieceType: moveResult.piece,
        timestamp: Date.now(),
        skipped: false,
        capturedPiece: moveResult.captured,
        promotion: promotionPiece,
      };

      const newHistory = [...(gameState.moveHistory ?? []), moveRecord];

      // Write new state to RTDB
      const stateRef = rRef(rtdb, `matches/${matchId}/gameState`);
      rSet(stateRef, {
        ...gameState,
        fen: newFen,
        turn: gameState.turn === 'w' ? 'b' : 'w',
        diceRoll: null,
        diceRolled: false,
        status: newStatus,
        winnerUid: newWinnerUid,
        moveHistory: newHistory,
        moveCount: (gameState.moveCount ?? 0) + 1,
      }).then(() => {
        if (newStatus === 'completed') {
          finalizeGame(newWinnerUid, newHistory, endReason);
        }
      });

      return true;
    } catch (e) {
      playIllegalMoveSound();
      setSelectedSquare(null);
      setCustomSquareStyles({});
      return false;
    }
  }, [gameState, myColor, chess, matchId, diceRolledPieceType, user?.uid]);

  // ── Handle promotion choice ───────────────────────────────────────────────
  const handlePromotionSelect = useCallback((piece: 'q' | 'r' | 'b' | 'n') => {
    if (!promotionPending) return;
    const { from, to } = promotionPending;
    setPromotionPending(null);
    executeMoveIfLegal(from, to, piece);
  }, [promotionPending, executeMoveIfLegal]);

  // ── Finalize game in Firestore ────────────────────────────────────────────
  const finalizeGame = useCallback(async (
    winnerUid: string | null,
    history: RollmateMoveRecord[],
    reason: string
  ) => {
    if (!matchData) return;
    const now = Date.now();

    try {
      // 1. Save full match + move history to Firestore
      await setDoc(doc(db, 'matches', matchId), {
        id: matchId,
        players: matchData.players,
        whiteUid: matchData.whiteUid,
        blackUid: matchData.blackUid,
        mode: 'Rollmate',
        status: 'completed',
        winnerUid,
        createdAt: matchData.createdAt || now,
        finishedAt: now,
        moveHistory: history,
        totalMoves: history.length,
        endReason: reason,
      });

      // 2. Update player stats
      const updateStats = async (uid: string, won: boolean, drew: boolean, p: UserProfile | null) => {
        if (!p) return;
        await setDoc(doc(db, 'users', uid), {
          wins: (p.wins || 0) + (won ? 1 : 0),
          losses: (p.losses || 0) + (!won && !drew ? 1 : 0),
          draws: (p.draws || 0) + (drew ? 1 : 0),
          totalGamesPlayed: (p.totalGamesPlayed || 0) + 1,
          updatedAt: now,
        }, { merge: true });
      };

      const isDraw = winnerUid === null;
      await Promise.all([
        updateStats(matchData.whiteUid, winnerUid === matchData.whiteUid, isDraw, whiteProfile),
        updateStats(matchData.blackUid, winnerUid === matchData.blackUid, isDraw, blackProfile),
      ]);

      // 3. Clean up challenge references
      if (matchData.challengeId) {
        await rSet(rRef(rtdb, `challenges/${matchData.challengeId}/status`), 'completed');
        await rSet(rRef(rtdb, `user_challenges/${matchData.whiteUid}/${matchData.challengeId}/status`), 'completed');
        await rSet(rRef(rtdb, `user_challenges/${matchData.blackUid}/${matchData.challengeId}/status`), 'completed');
      }

      // 4. Delete session chat from RTDB (session-only)
      await rRemove(rRef(rtdb, `matches/${matchId}/chat`));

      setGameResult({ winnerUid, reason });
    } catch (err) {
      console.error('Failed to finalize game:', err);
    }
  }, [matchData, matchId, whiteProfile, blackProfile]);

  // ── Resign handler ────────────────────────────────────────────────────────
  const handleResign = useCallback(async () => {
    if (!gameState || !user || !matchData) return;
    const opponentUid = myColor === 'w' ? matchData.blackUid : matchData.whiteUid;

    const stateRef = rRef(rtdb, `matches/${matchId}/gameState`);
    await rSet(stateRef, {
      ...gameState,
      status: 'completed',
      winnerUid: opponentUid,
    });

    await finalizeGame(opponentUid, gameState.moveHistory ?? [], 'resignation');
    setShowResignConfirm(false);
  }, [gameState, user, matchData, myColor, matchId, finalizeGame]);

  // ── Draw offer handler ────────────────────────────────────────────────────
  const handleOfferDraw = useCallback(async () => {
    if (!gameState || !user) return;
    const stateRef = rRef(rtdb, `matches/${matchId}/gameState`);
    await rSet(stateRef, {
      ...gameState,
      drawOffer: { fromUid: user.uid, timestamp: Date.now() },
    });
  }, [gameState, user, matchId]);

  const handleAcceptDraw = useCallback(async () => {
    if (!gameState) return;
    const stateRef = rRef(rtdb, `matches/${matchId}/gameState`);
    await rSet(stateRef, {
      ...gameState,
      status: 'completed',
      winnerUid: null,
      drawOffer: null,
    });
    await finalizeGame(null, gameState.moveHistory ?? [], 'draw by agreement');
    setShowDrawOffer(false);
  }, [gameState, matchId, finalizeGame]);

  const handleDeclineDraw = useCallback(async () => {
    if (!gameState) return;
    const stateRef = rRef(rtdb, `matches/${matchId}/gameState`);
    await rSet(stateRef, { ...gameState, drawOffer: null });
    setShowDrawOffer(false);
  }, [gameState, matchId]);

  // ── Replay navigation ─────────────────────────────────────────────────────
  const handleReplayBack = useCallback(() => {
    const history = gameState?.moveHistory ?? [];
    const maxIdx = history.length - 1;

    if (replayIndex === -1) {
      // Enter replay at last move
      setReplayIndex(maxIdx);
      const prevFen = maxIdx > 0 ? history[maxIdx - 1].fen : new Chess().fen();
      setReplayFen(maxIdx > 0 ? prevFen : new Chess().fen());
    } else if (replayIndex > 0) {
      const newIdx = replayIndex - 1;
      setReplayIndex(newIdx);
      setReplayFen(newIdx > 0 ? history[newIdx - 1].fen : new Chess().fen());
    }
  }, [replayIndex, gameState]);

  const handleReplayNext = useCallback(() => {
    const history = gameState?.moveHistory ?? [];
    const maxIdx = history.length - 1;

    if (replayIndex === maxIdx) {
      // Exit replay mode
      setReplayIndex(-1);
      setReplayFen(null);
    } else if (replayIndex >= 0 && replayIndex < maxIdx) {
      const newIdx = replayIndex + 1;
      setReplayIndex(newIdx);
      setReplayFen(history[newIdx].fen);
    }
  }, [replayIndex, gameState]);

  // ── Loading screen ────────────────────────────────────────────────────────
  if (loading || !matchData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-slate-200 p-6">
        <div className="flex flex-col items-center gap-5">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
            <div className="absolute inset-2 border-4 border-indigo-500/40 border-b-transparent rounded-full animate-spin" style={{ animationDirection: 'reverse' }} />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-bold text-white">Loading Arena</h3>
            <p className="text-xs text-slate-500 font-mono mt-1">Preparing Rollmate battlefield…</p>
          </div>
        </div>
      </div>
    );
  }

  const isGameOver = gameState?.status === 'completed' || gameState?.status === 'terminated';
  const boardFen = isReplayMode && replayFen ? replayFen : (gameState?.fen ?? new Chess().fen());
  const boardOrientation = myColor === 'b' ? 'black' : 'white';

  // Determine currently shown replay move for dice display in replay
  const replayRecord = isReplayMode && replayIndex >= 0
    ? (gameState?.moveHistory?.[replayIndex] ?? null)
    : null;
  const displayReplayDice = replayRecord?.diceRoll ?? null;

  return (
    <div className="min-h-screen bg-zinc-950 text-slate-200 flex flex-col overflow-hidden">

      {/* ── Slim In-Game Top Bar ───────────────────────────────────────────── */}
      <header className="glass sticky top-0 z-40 px-4 py-2.5 border-b border-white/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <img src="/game_logo.png" alt="ChessMania" className="w-7 h-7 rounded-lg object-cover border border-white/10" />
          <div>
            <p className="text-xs font-bold text-white leading-none">Rollmate</p>
            <p className="text-[9px] text-slate-500 font-mono leading-none mt-0.5">{matchId.slice(0, 12)}…</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <NetworkSignal />
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* ── Main Game Layout ──────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: Chess Board ───────────────────────────────────────────── */}
        <div className="flex-1 flex items-center justify-center p-4 min-w-0">
          <div className="w-full max-w-[min(calc(100vh-140px),600px)] aspect-square">
            {/* Opponent (top) */}
            <div className="mb-2">
              <PlayerCard
                profile={opponentProfile}
                isActive={gameState?.turn !== myColor && !isGameOver}
                color={myColor === 'w' ? 'b' : 'w'}
                label={myColor === 'w' ? 'Black' : 'White'}
              />
            </div>

            {/* Board */}
            <div className="chessboard-container w-full aspect-square relative" data-board-element>
              <Chessboard
                options={{
                  position: boardFen,
                  boardOrientation: boardOrientation,
                  pieces: customPieces,
                  boardStyle: {
                    ...boardStyle,
                    backgroundImage: `url('/boards/${boardTheme}.png')`,
                    backgroundSize: 'cover',
                  },
                  squareStyles: {
                    ...(selectedSquare ? { [selectedSquare]: { background: 'rgba(139,92,246,0.4)' } } : {}),
                    ...customSquareStyles,
                  },
                  allowDragging: !isReplayMode && isMyTurn && !!gameState?.diceRolled,
                  animationDurationInMs: 180,
                  showAnimations: true,
                  canDragPiece: ({ piece, isSparePiece }) => {
                    if (isReplayMode || !isMyTurn || !gameState?.diceRolled || isSparePiece) return false;
                    const pColor = piece.pieceType[0].toLowerCase();
                    const pType = piece.pieceType[1].toLowerCase();
                    return pColor === myColor && pType === diceRolledPieceType;
                  },
                  onPieceDrop: isReplayMode ? undefined : ({ piece, sourceSquare, targetSquare }) => {
                    if (!targetSquare) return false;
                    const pColor = piece.pieceType[0].toLowerCase();
                    const pType = piece.pieceType[1].toLowerCase();
                    if (pColor !== myColor || pType !== diceRolledPieceType) {
                      playIllegalMoveSound();
                      return false;
                    }
                    return executeMoveIfLegal(sourceSquare, targetSquare);
                  },
                  onSquareClick: isReplayMode ? undefined : ({ square }) => {
                    handleSquareClick(square);
                  },
                }}
              />
              {/* Replay overlay */}
              {isReplayMode && (
                <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-sm rounded-lg px-2.5 py-1.5 text-[10px] text-amber-400 font-bold uppercase tracking-widest flex items-center gap-1.5 pointer-events-none">
                  <RotateCcw className="w-3 h-3" />
                  Replay Mode
                </div>
              )}
            </div>

            {/* My player (bottom) */}
            <div className="mt-2">
              <PlayerCard
                profile={myProfile}
                isActive={isMyTurn && !isGameOver}
                color={myColor ?? 'w'}
                label={myColor === 'w' ? 'White (You)' : 'Black (You)'}
              />
            </div>
          </div>
        </div>

        {/* ── Right Panel ─────────────────────────────────────────────────── */}
        <div className="w-[300px] shrink-0 border-l border-zinc-800/60 flex flex-col bg-zinc-900/40 overflow-hidden">

          {/* Panel Tab Switcher */}
          <div className="flex border-b border-zinc-800 shrink-0">
            {(['game', 'chat'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActivePanel(tab)}
                className={`flex-1 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  activePanel === tab
                    ? 'text-violet-400 border-b-2 border-violet-500 bg-violet-500/5'
                    : 'text-slate-600 hover:text-slate-400'
                }`}
              >
                {tab === 'game' ? <><Trophy className="w-3 h-3" />Game</> : <><MessageCircle className="w-3 h-3" />Chat</>}
              </button>
            ))}
          </div>

          {/* Game Panel */}
          {activePanel === 'game' && (
            <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3 min-h-0">

              {/* Status message */}
              {statusMessage && (
                <div className="bg-violet-950/30 border border-violet-500/20 rounded-xl p-2.5 text-[10px] text-violet-300 text-center animate-pulse">
                  {statusMessage}
                </div>
              )}

              {/* Check warning */}
              {gameState && !isGameOver && chess.isCheck() && (
                <div className="bg-red-950/30 border border-red-500/20 rounded-xl p-2.5 flex items-center gap-2 text-[10px] text-red-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                  <span className="font-semibold">King is in check!</span>
                </div>
              )}

              {/* Turn indicator */}
              {gameState && !isGameOver && !isReplayMode && (
                <div className={`rounded-xl p-2.5 border text-[10px] text-center font-bold uppercase tracking-widest ${
                  isMyTurn
                    ? 'bg-violet-600/10 border-violet-500/30 text-violet-400'
                    : 'bg-zinc-800/50 border-zinc-700 text-slate-500'
                }`}>
                  {isMyTurn
                    ? (gameState.diceRolled ? `Move your ${getPieceTypeName(diceRolledPieceType!)}` : 'Your turn — Roll the dice!')
                    : `Waiting for ${opponentProfile?.displayName || 'opponent'}…`
                  }
                </div>
              )}

              {/* ── Dice ─────────────────────────────────────────────────── */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold mb-2.5 text-center">
                  {isReplayMode ? 'Dice (Replay)' : 'Dice Roll'}
                </p>
                {isReplayMode ? (
                  <div className="flex flex-col items-center gap-2">
                    {displayReplayDice !== null ? (
                      <div className="flex items-center gap-2 bg-zinc-800 rounded-xl px-4 py-2.5 border border-zinc-700">
                        <span className="text-2xl">{PIECE_SYMBOLS[getPieceTypeForFace(displayReplayDice)]}</span>
                        <span className="text-sm font-bold text-white">
                          {getPieceTypeName(getPieceTypeForFace(displayReplayDice))}
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-600 italic">No dice for this move</p>
                    )}
                  </div>
                ) : (
                  <DiceComponent
                    result={isMyTurn ? (gameState?.diceRolled ? gameState.diceRoll ?? null : localDiceResult) : (gameState?.diceRoll ?? null)}
                    rolling={rolling}
                    onRoll={handleRollDice}
                    disabled={!isMyTurn || !!gameState?.diceRolled || isGameOver}
                    label={gameState?.diceRolled ? `Move: ${getPieceTypeName(diceRolledPieceType ?? 'p')}` : undefined}
                  />
                )}
              </div>

              {/* ── Game Controls ─────────────────────────────────────────── */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
                <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold">Controls</p>

                {/* Replay navigation */}
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={handleReplayBack}
                    disabled={!gameState?.moveHistory?.length}
                    className="flex items-center justify-center gap-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-slate-300 text-[10px] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Back
                  </button>
                  <button
                    onClick={handleReplayNext}
                    disabled={!isReplayMode}
                    className="flex items-center justify-center gap-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-slate-300 text-[10px] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Skip */}
                <button
                  onClick={handleSkip}
                  disabled={!isMyTurn || !gameState?.diceRolled || isGameOver || isReplayMode}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-zinc-800 hover:bg-amber-600/20 border border-zinc-700 hover:border-amber-500/30 text-slate-400 hover:text-amber-400 text-[10px] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                  Skip Turn
                </button>

                {/* Resign & Draw */}
                {!isGameOver && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => setShowResignConfirm(true)}
                      disabled={isReplayMode}
                      className="flex items-center justify-center gap-1 py-2 rounded-lg bg-red-950/20 hover:bg-red-950/40 border border-red-500/20 hover:border-red-500/40 text-red-400 text-[10px] font-semibold transition-all cursor-pointer disabled:opacity-40"
                    >
                      <Flag className="w-3 h-3" />
                      Resign
                    </button>
                    <button
                      onClick={handleOfferDraw}
                      disabled={isReplayMode || !!gameState?.drawOffer}
                      className="flex items-center justify-center gap-1 py-2 rounded-lg bg-zinc-800 hover:bg-emerald-900/20 border border-zinc-700 hover:border-emerald-500/30 text-slate-400 hover:text-emerald-400 text-[10px] font-semibold transition-all cursor-pointer disabled:opacity-40"
                    >
                      <Handshake className="w-3 h-3" />
                      Draw
                    </button>
                  </div>
                )}

                {/* Exit / Return */}
                {isGameOver && (
                  <button
                    onClick={onExit}
                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-[10px] font-bold transition-all cursor-pointer border border-violet-500/25"
                  >
                    <Home className="w-3 h-3" />
                    Return to Dashboard
                  </button>
                )}
              </div>

              {/* ── Move History ──────────────────────────────────────────── */}
              {(gameState?.moveHistory?.length ?? 0) > 0 && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                  <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold mb-2">Move History</p>
                  <div className="max-h-32 overflow-y-auto scrollbar-thin space-y-0.5">
                    {(gameState?.moveHistory ?? []).map((m, i) => (
                      <div
                        key={i}
                        onClick={() => {
                          setReplayIndex(i);
                          setReplayFen(m.fen);
                        }}
                        className={`flex items-center gap-2 px-2 py-1 rounded-lg text-[10px] cursor-pointer transition-all ${
                          replayIndex === i
                            ? 'bg-violet-600/20 text-violet-300'
                            : 'hover:bg-zinc-800 text-slate-400'
                        }`}
                      >
                        <span className="w-5 text-right text-slate-600 shrink-0">{m.moveNumber}.</span>
                        <span className="shrink-0">{PIECE_SYMBOLS[m.pieceType] ?? '?'}</span>
                        <span className={m.skipped ? 'italic text-slate-600' : 'font-mono'}>
                          {m.skipped ? 'skip' : m.san}
                        </span>
                        {m.diceRoll !== undefined && (
                          <span className="ml-auto text-slate-600 shrink-0">
                            🎲{m.diceRoll + 1}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Captured Pieces ───────────────────────────────────────── */}
              {(capturedByWhiteFiles.length > 0 || capturedByBlackFiles.length > 0) && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                  <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold">Captures</p>
                  <CapturedPieces label="White took" pieces={capturedByWhiteFiles} pieceTheme={pieceTheme} />
                  <CapturedPieces label="Black took" pieces={capturedByBlackFiles} pieceTheme={pieceTheme} />
                </div>
              )}

            </div>
          )}

          {/* Chat Panel */}
          {activePanel === 'chat' && (
            <div className="flex-1 flex flex-col p-3 min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto min-h-0">
                {user && (
                  <GameChat
                    matchId={matchId}
                    currentUser={{ uid: user.uid, displayName: user.displayName, photoURL: user.photoURL }}
                    currentProfile={profile}
                    disabled={isGameOver}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}

      {/* Pawn Promotion */}
      {promotionPending && (
        <PromotionModal
          color={myColor ?? 'w'}
          pieceTheme={pieceTheme}
          onSelect={handlePromotionSelect}
        />
      )}

      {/* Resign Confirmation */}
      {showResignConfirm && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-xs w-full mx-4 text-center space-y-4">
            <div className="text-3xl">🏳️</div>
            <h3 className="text-base font-bold text-white">Resign from this match?</h3>
            <p className="text-xs text-slate-500">Your opponent will be declared the winner.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResignConfirm(false)}
                className="flex-1 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-slate-300 text-xs font-semibold cursor-pointer hover:bg-zinc-700 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleResign}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold cursor-pointer transition-all border border-red-500/25"
              >
                Resign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Draw Offer */}
      {showDrawOffer && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-xs w-full mx-4 text-center space-y-4">
            <div className="text-3xl">🤝</div>
            <h3 className="text-base font-bold text-white">Draw Offered!</h3>
            <p className="text-xs text-slate-400">
              {opponentProfile?.displayName || 'Your opponent'} is offering a draw. Do you accept?
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDeclineDraw}
                className="flex-1 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-slate-300 text-xs font-semibold cursor-pointer hover:bg-zinc-700 transition-all"
              >
                Decline
              </button>
              <button
                onClick={handleAcceptDraw}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer transition-all border border-emerald-500/25"
              >
                Accept Draw
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game Result Overlay */}
      {gameResult && (
        <GameResultOverlay
          winnerUid={gameResult.winnerUid}
          currentUid={user?.uid ?? ''}
          whiteProfile={whiteProfile}
          blackProfile={blackProfile}
          reason={gameResult.reason}
          onExit={onExit}
        />
      )}

      {/* Settings shortcut info */}
      {settingsOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-violet-400" />
                Active Settings
              </h3>
              <button onClick={() => setSettingsOpen(false)} className="text-slate-500 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs text-slate-300">
              <div className="flex justify-between bg-zinc-800 rounded-lg px-3 py-2">
                <span className="text-slate-500">Board Theme</span>
                <span className="font-mono text-violet-400 capitalize">{boardTheme.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex justify-between bg-zinc-800 rounded-lg px-3 py-2">
                <span className="text-slate-500">Piece Style</span>
                <span className="font-mono text-violet-400 capitalize">{pieceTheme.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex justify-between bg-zinc-800 rounded-lg px-3 py-2">
                <span className="text-slate-500">Legal Move Hints</span>
                <span className={showLegalMoves ? 'text-emerald-400' : 'text-slate-500'}>{showLegalMoves ? 'On' : 'Off'}</span>
              </div>
            </div>
            <p className="text-[10px] text-slate-600 text-center">Change settings via the main Settings page</p>
          </div>
        </div>
      )}
    </div>
  );
};
