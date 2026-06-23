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
  flipFenActiveColor,
  chessWithCorrectTurn,
  PIECE_SYMBOLS,
} from '../utils/chess';
import { getSoundSettings } from '../utils/sound';
import { playMoveSound, playCaptureSound, playCheckSound, playWinSound, playIllegalMoveSound } from '../utils/sound';
import type { Match, UserProfile, RollmateMoveRecord, GameChatMessage, RollmateRTDBState } from '../types';
import { SettingsPanelContent } from './SettingsView';

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
  <div className={`flex items-center gap-2.5 p-2 rounded-xl border transition-all ${
    isActive
      ? 'bg-violet-600/10 border-violet-500/40 shadow-lg shadow-violet-500/10'
      : 'bg-zinc-900/60 border-zinc-800'
  }`}>
    <div className="relative shrink-0">
      <img
        src={profile?.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop'}
        alt={profile?.displayName || '?'}
        className="w-7 h-7 rounded-full object-cover border-2 border-zinc-700"
      />
      <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-zinc-900 ${
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
    <div className="flex items-center gap-1 flex-wrap">
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
  onNewMessages?: (count: number) => void;
}

const GameChat: React.FC<GameChatProps> = ({ matchId, currentUser, currentProfile, disabled, onNewMessages }) => {
  const [messages, setMessages] = useState<GameChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Track the count of messages already seen so we can compute new arrivals
  const seenCountRef = useRef(0);

  // Listen to RTDB chat node for this match session
  useEffect(() => {
    const chatRef = rRef(rtdb, `matches/${matchId}/chat`);
    const unsub = rOnValue(chatRef, (snap) => {
      if (!snap.exists()) { setMessages([]); seenCountRef.current = 0; return; }
      const val = snap.val();
      const msgs: GameChatMessage[] = Object.keys(val).map((k) => ({ id: k, ...val[k] }));
      msgs.sort((a, b) => a.timestamp - b.timestamp);
      // Notify parent about new messages from opponents (not from self)
      const newCount = msgs.length - seenCountRef.current;
      if (newCount > 0) {
        const newMsgs = msgs.slice(seenCountRef.current);
        const opponentNewMsgs = newMsgs.filter(m => m.senderUid !== currentUser.uid);
        if (opponentNewMsgs.length > 0) {
          onNewMessages?.(opponentNewMsgs.length);
        }
      }
      seenCountRef.current = msgs.length;
      setMessages(msgs);
    });
    return () => unsub();
  }, [matchId, currentUser.uid, onNewMessages]);

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
  /**
   * gameStateRef always holds the most recent gameState value.
   * This is critical for executeMoveIfLegal: the callback must read the
   * freshest state when writing to RTDB, even if React hasn't re-rendered yet.
   * Using a ref prevents stale-closure bugs in move execution (issues 6 & 11).
   */
  const gameStateRef = useRef<RollmateRTDBState | null>(null);
  const [chess] = useState(() => new Chess()); // Local chess engine instance

  // ── Dice state ─────────────────────────────────────────────────────────────
  const [rolling, setRolling] = useState(false);
  const [localDiceResult, setLocalDiceResult] = useState<number | null>(null);

  // ── Board interaction state ─────────────────────────────────────────────────
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [customSquareStyles, setCustomSquareStyles] = useState<Record<string, React.CSSProperties>>({});
  const [promotionPending, setPromotionPending] = useState<{ from: string; to: string } | null>(null);
  /**
   * localBoardFen provides an optimistic board update immediately after the
   * current player makes a move, so the UI shows the new position without
   * waiting for the RTDB round-trip. Cleared when RTDB fires back with the
   * authoritative new state.
   */
  const [localBoardFen, setLocalBoardFen] = useState<string | null>(null);

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
  /**
   * unreadChatCount tracks messages received while chat panel is not active.
   * Resets to 0 when user opens the chat panel.
   */
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  // ── Settings — re-read whenever settingsVersion bumps ─────────────────────
  /**
   * settingsVersion increments whenever SettingsPanelContent fires onSettingsChange.
   * This forces the component to re-read localStorage and re-derive board/piece theme
   * so changes made in the in-game settings modal apply to the board immediately.
   */
  const [settingsVersion, setSettingsVersion] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const boardTheme = React.useMemo(() => getSoundSettings().boardTheme || '8_bit', [settingsVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pieceTheme = React.useMemo(() => getSoundSettings().pieceTheme || 'neo', [settingsVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const showLegalMoves = React.useMemo(() => getSoundSettings().showLegalMoves !== false, [settingsVersion]);

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

  // Build custom pieces for react-chessboard — rebuilds when pieceTheme changes
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
        // State not initialized yet — initialization handled below
        return;
      }
      const state = snap.val() as RollmateRTDBState;

      // Always update both the React state and the ref simultaneously
      setGameState(state);
      gameStateRef.current = state;

      // Clear optimistic local board FEN — RTDB is now authoritative
      setLocalBoardFen(null);

      // Sync local chess instance to current FEN with the correct active color.
      // We always normalise the FEN's active color to match state.turn so that
      // chess.moves() returns the right player's moves throughout this component.
      try {
        const normalizedFen = state.fen.split(' ').map((p, i) => i === 1 ? state.turn : p).join(' ');
        chess.load(normalizedFen);
      } catch (e) {
        console.warn('Failed to load FEN:', e);
        // Attempt to load raw FEN as fallback
        try { chess.load(state.fen); } catch { /* ignore */ }
      }

      // Check if game just ended
      if (state.status === 'completed' || state.status === 'terminated') {
        setGameResult(prev => prev ?? { winnerUid: state.winnerUid, reason: 'Game over' });
      }

      // Check for incoming draw offer from opponent
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

    // Always read from ref for latest state
    const currentState = gameStateRef.current!;

    // Check if this roll has any legal moves.
    // IMPORTANT: Pass the FEN and myColor (not the chess instance) so that
    // hasLegalMovesForRoll uses a temporary chess instance with the correct
    // active color. This prevents false "no moves" when the stored FEN's
    // active color doesn't match myColor due to skip/turn sync issues.
    const hasLegal = hasLegalMovesForRoll(currentState.fen, myColor, pieceType);

    // Write the dice roll to RTDB
    const stateRef = rRef(rtdb, `matches/${matchId}/gameState`);

    if (!hasLegal) {
      // Auto-skip: record a skip move, flip turn
      const skipRecord: RollmateMoveRecord = {
        moveNumber: (currentState.moveCount ?? 0) + 1,
        san: `(skip)`,
        from: '',
        to: '',
        fen: currentState.fen,
        diceRoll: faceIndex,
        pieceType,
        timestamp: Date.now(),
        skipped: true,
      };

      const newHistory = [...(currentState.moveHistory ?? []), skipRecord];
      setStatusMessage(`No ${getPieceTypeName(pieceType)} moves — turn skipped!`);
      setTimeout(() => setStatusMessage(''), 3000);

      // CRITICAL: flip the FEN's active color so chess.js knows whose turn it is next.
      // Without this, chess.moves() would return the wrong player's moves on the
      // following turn, causing hasLegalMovesForRoll to falsely return 0 => infinite auto-skips.
      const nextTurn = currentState.turn === 'w' ? 'b' : 'w';
      await rSet(stateRef, {
        ...currentState,
        fen: flipFenActiveColor(currentState.fen),
        diceRoll: faceIndex,
        diceRolled: false,
        turn: nextTurn,
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
  }, [isMyTurn, gameState?.diceRolled, rolling, myColor, matchId]);

  // ── Manual skip handler ───────────────────────────────────────────────────
  const handleSkip = useCallback(async () => {
    if (!isMyTurn || !gameState?.diceRolled || !myColor) return;
    if (!diceRolledPieceType) return;

    const currentState = gameStateRef.current!;

    // It is the player's choice whether they want to move or just skip the turn.
    // So we allow manual skipping even if hasLegal is true.


    const skipRecord: RollmateMoveRecord = {
      moveNumber: (currentState.moveCount ?? 0) + 1,
      san: '(skip)',
      from: '',
      to: '',
      fen: currentState.fen,
      diceRoll: currentState.diceRoll!,
      pieceType: diceRolledPieceType,
      timestamp: Date.now(),
      skipped: true,
    };

    const nextTurn = currentState.turn === 'w' ? 'b' : 'w';
    const stateRef = rRef(rtdb, `matches/${matchId}/gameState`);
    // CRITICAL: flip FEN active color so the next player's chess.moves() returns
    // the right moves. We flip from currentState.fen (not chess.fen()) to avoid
    // any discrepancy caused by the chess instance being mutated elsewhere.
    await rSet(stateRef, {
      ...currentState,
      fen: flipFenActiveColor(currentState.fen),
      diceRoll: null,
      diceRolled: false,
      turn: nextTurn,
      moveHistory: [...(currentState.moveHistory ?? []), skipRecord],
      moveCount: (currentState.moveCount ?? 0) + 1,
    });
  }, [isMyTurn, gameState?.diceRolled, myColor, matchId, diceRolledPieceType]);

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

  // ── Execute a legal move ──────────────────────────────────────────────────
  /**
   * Attempts to execute a chess move.
   *
   * KEY FIXES:
   * 1. Uses a temporary chess instance created from currentState.fen with the
   *    correct active color (myColor). This prevents chess.move() from failing
   *    when the shared chess instance's active color doesn't match myColor due
   *    to FEN/turn sync issues — which was causing turns to silently advance.
   * 2. Immediately sets localBoardFen after a successful move for optimistic
   *    UI update, so the board shows the new position without waiting for the
   *    RTDB round-trip (fixes the "piece not showing after move" UI bug).
   * 3. Reads game state from the ref (not closure) to guarantee we always
   *    write the freshest state to RTDB.
   */
  const executeMoveIfLegal = useCallback((from: string, to: string, promotionPiece?: string): boolean => {
    // Always read from ref for latest state
    const currentState = gameStateRef.current;
    if (!currentState || !myColor || !diceRolledPieceType) return false;

    // Create a temporary chess instance with the correct active color.
    // This is the critical fix: if the stored FEN's active color differs from
    // myColor (due to a skip or other sync issue), the shared chess instance
    // would reject the move. Using a fresh instance with myColor ensures that
    // legal moves are always accepted for the correct player.
    const tempChess = chessWithCorrectTurn(currentState.fen, myColor);

    // Check for pawn promotion using the temp instance
    const piece = tempChess.get(from as any);
    if (piece?.type === 'p') {
      const toRank = to[1];
      if ((myColor === 'w' && toRank === '8') || (myColor === 'b' && toRank === '1')) {
        if (!promotionPiece) {
          setPromotionPending({ from, to });
          return true; // Will complete after user picks promotion piece
        }
      }
    }

    try {
      const moveResult = tempChess.move({
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

      if (tempChess.isCheck()) playCheckSound();

      setSelectedSquare(null);
      setCustomSquareStyles({});

      // New FEN after the move (chess.js automatically flips active color)
      const newFen = tempChess.fen();

      // Optimistic UI update: immediately show the moved piece on the board
      // without waiting for RTDB to confirm. This fixes the bug where the
      // board appeared frozen after a move until the opponent's next action.
      setLocalBoardFen(newFen);

      // Also sync the shared chess instance so subsequent queries (e.g. isCheck)
      // reflect the current board position
      try { chess.load(newFen); } catch { /* ignore */ }

      // Detect game end conditions
      let newStatus: 'active' | 'completed' = 'active';
      let newWinnerUid: string | null = null;
      let endReason = '';

      if (tempChess.isCheckmate()) {
        newStatus = 'completed';
        newWinnerUid = user?.uid ?? null;
        endReason = 'checkmate';
        playWinSound();
      } else if (tempChess.isStalemate()) {
        newStatus = 'completed';
        newWinnerUid = null;
        endReason = 'stalemate';
      } else if (tempChess.isInsufficientMaterial()) {
        newStatus = 'completed';
        newWinnerUid = null;
        endReason = 'insufficient material';
      } else if (tempChess.isThreefoldRepetition()) {
        newStatus = 'completed';
        newWinnerUid = null;
        endReason = 'threefold repetition';
      } else if (tempChess.isDraw()) {
        newStatus = 'completed';
        newWinnerUid = null;
        endReason = 'draw (50-move rule)';
      }

      // Build move record for history
      const moveRecord: RollmateMoveRecord = {
        moveNumber: (currentState.moveCount ?? 0) + 1,
        san: moveResult.san,
        from,
        to,
        fen: newFen,
        diceRoll: currentState.diceRoll!,
        pieceType: moveResult.piece,
        timestamp: Date.now(),
        skipped: false,
        capturedPiece: moveResult.captured,
        promotion: promotionPiece,
      };

      const newHistory = [...(currentState.moveHistory ?? []), moveRecord];
      const nextTurn = currentState.turn === 'w' ? 'b' : 'w';

      // Write new state to RTDB using the freshest currentState from ref
      const newRTDBState: RollmateRTDBState = {
        ...currentState,
        fen: newFen,
        turn: nextTurn,
        diceRoll: null,
        diceRolled: false,
        status: newStatus,
        winnerUid: newWinnerUid,
        moveHistory: newHistory,
        moveCount: (currentState.moveCount ?? 0) + 1,
      };

      const stateRef = rRef(rtdb, `matches/${matchId}/gameState`);
      rSet(stateRef, newRTDBState).catch((err) => {
        // If RTDB write fails, clear the optimistic update so the board reverts
        console.error('Failed to write move to RTDB:', err);
        setLocalBoardFen(null);
      }).then(() => {
        if (newStatus === 'completed') {
          finalizeGame(newWinnerUid, newHistory, endReason);
        }
      });

      // Exit replay mode if we were somehow in it
      setReplayIndex(-1);
      setReplayFen(null);

      return true;
    } catch (e) {
      playIllegalMoveSound();
      setSelectedSquare(null);
      setCustomSquareStyles({});
      return false;
    }
  }, [myColor, chess, matchId, diceRolledPieceType, user?.uid, finalizeGame]);

  // ── Board square click handler ────────────────────────────────────────────
  const handleSquareClick = useCallback((square: string) => {
    // Read live gameState via the ref to avoid stale closure
    const currentState = gameStateRef.current;
    if (!currentState?.diceRolled || !myColor || isReplayMode) return;
    if (!diceRolledPieceType) return;
    // Only allow moves on my turn
    if (currentState.turn !== myColor || currentState.status !== 'active') return;

    // Use a temp chess instance with the correct active color for piece lookup
    // so we can correctly identify pieces regardless of FEN/turn sync state
    const tempChess = chessWithCorrectTurn(currentState.fen, myColor);
    const piece = tempChess.get(square as any);

    // Selecting a piece of the correct type
    if (piece && piece.color === myColor && piece.type === diceRolledPieceType) {
      setSelectedSquare(square);
      if (showLegalMoves) {
        // Pass the FEN (not chess instance) so getLegalMoveSquares uses the
        // correct active color when computing move hints
        setCustomSquareStyles(getLegalMoveSquares(currentState.fen, square, diceRolledPieceType, myColor));
      }
      return;
    }

    // Attempting a move from selected square
    if (selectedSquare) {
      executeMoveIfLegal(selectedSquare, square);
    }
  }, [myColor, diceRolledPieceType, selectedSquare, isReplayMode, showLegalMoves, executeMoveIfLegal]);

  // ── Handle promotion choice ───────────────────────────────────────────────
  const handlePromotionSelect = useCallback((piece: 'q' | 'r' | 'b' | 'n') => {
    if (!promotionPending) return;
    const { from, to } = promotionPending;
    setPromotionPending(null);
    executeMoveIfLegal(from, to, piece);
  }, [promotionPending, executeMoveIfLegal]);

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
  /**
   * Replay index convention:
   *   -1   = live game view (gameState.fen)
   *    N   = show board after move N was applied (history[N].fen)
   *
   * Back: -1 → enter at maxIdx, N → N-1 (or initial FEN if N=0)
   * Next: N → N+1, maxIdx → exit replay (-1)
   */
  const handleReplayBack = useCallback(() => {
    const history = gameState?.moveHistory ?? [];
    const maxIdx = history.length - 1;
    if (maxIdx < 0) return;

    if (replayIndex === -1) {
      // Enter replay at the last move
      setReplayIndex(maxIdx);
      setReplayFen(history[maxIdx].fen);
    } else if (replayIndex === 0) {
      // Go before the first move: show initial FEN
      setReplayIndex(0);
      setReplayFen(new Chess().fen());
    } else {
      const newIdx = replayIndex - 1;
      setReplayIndex(newIdx);
      setReplayFen(history[newIdx].fen);
    }
  }, [replayIndex, gameState]);

  const handleReplayNext = useCallback(() => {
    const history = gameState?.moveHistory ?? [];
    const maxIdx = history.length - 1;

    if (replayIndex < 0 || replayIndex > maxIdx) return;

    if (replayIndex === maxIdx) {
      // Exit replay mode — return to live board
      setReplayIndex(-1);
      setReplayFen(null);
    } else {
      const newIdx = replayIndex + 1;
      setReplayIndex(newIdx);
      setReplayFen(history[newIdx].fen);
    }
  }, [replayIndex, gameState]);

  // ── Loading screen ────────────────────────────────────────────────────────
  if (loading || !matchData) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 text-slate-200 p-6">
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
  /**
   * Board FEN priority:
   * 1. Replay mode: show the selected history position
   * 2. Optimistic local FEN: immediately show piece after current player's move
   *    (before RTDB round-trip completes, avoids the "piece not showing" bug)
   * 3. Authoritative RTDB state FEN
   * 4. Fallback to initial position
   */
  const boardFen = isReplayMode && replayFen
    ? replayFen
    : (localBoardFen ?? gameState?.fen ?? new Chess().fen());
  const boardOrientation = myColor === 'b' ? 'black' : 'white';

  // Determine currently shown replay move for dice display in replay
  const replayRecord = isReplayMode && replayIndex >= 0
    ? (gameState?.moveHistory?.[replayIndex] ?? null)
    : null;
  const displayReplayDice = replayRecord?.diceRoll ?? null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    /**
     * Root: h-screen + overflow-hidden ensures the game never scrolls (issue 2).
     * All child flex containers use min-h-0 so they shrink correctly.
     */
    <div className="h-screen bg-zinc-950 text-slate-200 flex flex-col overflow-hidden">

      {/* ── Slim In-Game Top Bar ───────────────────────────────────────────── */}
      <header className="glass sticky top-0 z-40 px-4 py-2 border-b border-white/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <img src="/game_logo.png" alt="ChessMania" className="w-6 h-6 rounded-lg object-cover border border-white/10" />
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
      <div className="flex-1 grid overflow-hidden min-h-0" style={{ gridTemplateColumns: '62% 38%' }}>

        {/* ── Left: Chess Board ───────────────────────────────────────────── */}
        {/* Board is sized via CSS min() to fill as much space as possible while
            remaining square: min(left-column-width, available-height).
            Left column = 62vw - 16px padding; available height = 100vh - header(44px)
            - two player cards(84px) - gaps(12px) - padding(16px) = 100vh - 156px */}
        <div className="flex items-center justify-center p-2 min-w-0 min-h-0 bg-zinc-950/20">
          <div className="flex flex-col justify-center items-center gap-1.5">
            {/* Opponent (top) */}
            <div className="shrink-0" style={{ width: 'min(calc(62vw - 16px), calc(100vh - 156px))' }}>
              <PlayerCard
                profile={opponentProfile}
                isActive={gameState?.turn !== myColor && !isGameOver}
                color={myColor === 'w' ? 'b' : 'w'}
                label={myColor === 'w' ? 'Black' : 'White'}
              />
            </div>

            {/* Board - explicit square size via CSS min() */}
            <div
              className="relative shrink-0"
              data-board-element
              style={{
                width: 'min(calc(62vw - 16px), calc(100vh - 156px))',
                height: 'min(calc(62vw - 16px), calc(100vh - 156px))',
              }}
            >
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
                    // react-chessboard v5: `piece` in canDragPiece/onPieceDrop is a string
                    // like "wP", "bN" — NOT an object with a .pieceType field.
                    // Index 0 = color ('w'/'b'), index 1 = type ('p','n','b','r','q','k').
                    canDragPiece: ({ piece, isSparePiece }) => {
                      if (isReplayMode || !isMyTurn || !gameState?.diceRolled || isSparePiece) return false;
                      // piece.pieceType is a string like "wP" or "bN" (react-chessboard v5)
                      // [0] = color ('w'/'b'), [1] = piece letter (uppercase) -> lowercase for chess.js
                      const pColor = piece.pieceType[0].toLowerCase();
                      const pType  = piece.pieceType[1].toLowerCase();
                      return pColor === myColor && pType === diceRolledPieceType;
                    },
                    onPieceDrop: isReplayMode ? undefined : ({ piece, sourceSquare, targetSquare }) => {
                      if (!targetSquare) return false;
                      // piece.pieceType is a string like "wP" or "bN" (react-chessboard v5)
                      const pColor = piece.pieceType[0].toLowerCase();
                      const pType  = piece.pieceType[1].toLowerCase();
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
                <div className="absolute top-2 left-2 z-10 bg-black/70 backdrop-blur-sm rounded-lg px-2.5 py-1.5 text-[10px] text-amber-400 font-bold uppercase tracking-widest flex items-center gap-1.5 pointer-events-none">
                  <RotateCcw className="w-3 h-3" />
                  Replay Mode
                </div>
              )}
            </div>

            {/* My player (bottom) */}
            <div className="shrink-0" style={{ width: 'min(calc(62vw - 16px), calc(100vh - 156px))' }}>
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
        <div className="border-l border-zinc-800/60 flex flex-col bg-zinc-900/40 overflow-hidden min-h-0 w-full">

          {/* Panel Tab Switcher */}
          <div className="flex border-b border-zinc-800 shrink-0">
            {(['game', 'chat'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActivePanel(tab);
                  // Reset unread count when opening chat
                  if (tab === 'chat') setUnreadChatCount(0);
                }}
                className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer flex items-center justify-center gap-1.5 relative ${
                  activePanel === tab
                    ? 'text-violet-400 border-b-2 border-violet-500 bg-violet-500/5'
                    : 'text-slate-600 hover:text-slate-400'
                }`}
              >
                {tab === 'game' ? (
                  <><Trophy className="w-3 h-3" />Game</>
                ) : (
                  <>
                    <MessageCircle className="w-3 h-3" />
                    Chat
                    {/* Unread message badge (issue 4) */}
                    {unreadChatCount > 0 && activePanel !== 'chat' && (
                      <span className="absolute top-1 right-3 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 shadow-lg">
                        {unreadChatCount > 9 ? '9+' : unreadChatCount}
                      </span>
                    )}
                  </>
                )}
              </button>
            ))}
          </div>

          {/* Game Panel — fixed header (status/dice/controls) + flex-1 scrollable move history */}
          {activePanel === 'game' && (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

              {/* ── Fixed top section: status, dice, controls ─────────────── */}
              <div className="shrink-0 p-2.5 space-y-2 overflow-hidden">

                {/* Status message */}
                {statusMessage && (
                  <div className="bg-violet-950/30 border border-violet-500/20 rounded-xl p-2 text-[10px] text-violet-300 text-center animate-pulse">
                    {statusMessage}
                  </div>
                )}

                {/* Check warning */}
                {gameState && !isGameOver && chess.isCheck() && (
                  <div className="bg-red-950/30 border border-red-500/20 rounded-xl p-2 flex items-center gap-2 text-[10px] text-red-400">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                    <span className="font-semibold">King is in check!</span>
                  </div>
                )}

                {/* Turn indicator */}
                {gameState && !isGameOver && !isReplayMode && (
                  <div className={`rounded-xl p-2 border text-[10px] text-center font-bold uppercase tracking-widest ${
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
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5">
                  <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold mb-2 text-center">
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
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 space-y-2">
                  <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold">Controls</p>

                  {/* Replay navigation */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={handleReplayBack}
                      disabled={!gameState?.moveHistory?.length}
                      className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-slate-300 text-[10px] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Back
                    </button>
                    <button
                      onClick={handleReplayNext}
                      disabled={!isReplayMode}
                      className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-slate-300 text-[10px] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Next
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Skip */}
                  <button
                    onClick={handleSkip}
                    disabled={!isMyTurn || !gameState?.diceRolled || isGameOver || isReplayMode}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-amber-600/20 border border-zinc-700 hover:border-amber-500/30 text-slate-400 hover:text-amber-400 text-[10px] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
                        className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-red-950/20 hover:bg-red-950/40 border border-red-500/20 hover:border-red-500/40 text-red-400 text-[10px] font-semibold transition-all cursor-pointer disabled:opacity-40"
                      >
                        <Flag className="w-3 h-3" />
                        Resign
                      </button>
                      <button
                        onClick={handleOfferDraw}
                        disabled={isReplayMode || !!gameState?.drawOffer}
                        className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-zinc-800 hover:bg-emerald-900/20 border border-zinc-700 hover:border-emerald-500/30 text-slate-400 hover:text-emerald-400 text-[10px] font-semibold transition-all cursor-pointer disabled:opacity-40"
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
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-[10px] font-bold transition-all cursor-pointer border border-violet-500/25"
                    >
                      <Home className="w-3 h-3" />
                      Return to Dashboard
                    </button>
                  )}
                </div>

              </div>{/* end fixed top section */}

              {/* ── Move History — flex-1, scrolls independently, never overflows window ── */}
              <div className="flex-1 min-h-0 px-2.5 pb-2.5 overflow-hidden flex flex-col">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 flex flex-col min-h-0 flex-1">
                  <p className="shrink-0 text-[9px] text-slate-600 uppercase tracking-widest font-bold mb-1.5">
                    Move History
                    {(gameState?.moveHistory?.length ?? 0) > 0 && (
                      <span className="ml-1.5 text-zinc-600 normal-case">({gameState!.moveHistory!.length})</span>
                    )}
                  </p>

                  {/* Scrollable table — only this element scrolls, not the window */}
                  <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
                    {(gameState?.moveHistory?.length ?? 0) === 0 ? (
                      <p className="text-[9px] text-slate-600 italic text-center pt-4">No moves yet</p>
                    ) : (
                      <table className="w-full text-[9px] border-collapse">
                        <thead className="sticky top-0 bg-zinc-900 z-10">
                          <tr className="text-slate-600 uppercase tracking-wider border-b border-zinc-800">
                            <th className="text-right pr-1.5 py-1 w-6">#</th>
                            <th className="text-left px-1 py-1">Side</th>
                            <th className="text-left px-1 py-1">Piece</th>
                            <th className="text-left px-1 py-1">Move</th>
                            <th className="text-left px-1 py-1">SAN</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(gameState?.moveHistory ?? []).map((m, i) => {
                            // White always moves on odd moveNumbers (1, 3, 5…)
                            const isWhiteMove = m.moveNumber % 2 === 1;
                            const playerName = isWhiteMove
                              ? (whiteProfile?.displayName || 'White')
                              : (blackProfile?.displayName || 'Black');
                            const isHighlighted = replayIndex === i;
                            return (
                              <tr
                                key={i}
                                onClick={() => {
                                  setReplayIndex(i);
                                  setReplayFen(m.fen);
                                }}
                                className={`cursor-pointer transition-colors ${
                                  isHighlighted
                                    ? 'bg-violet-600/20 text-violet-300'
                                    : 'hover:bg-zinc-800 text-slate-400'
                                }`}
                              >
                                <td className="text-right pr-1.5 py-0.5 text-slate-600 font-mono">{m.moveNumber}.</td>
                                <td className="px-1 py-0.5 max-w-[60px] truncate text-slate-400">{playerName}</td>
                                {/* Piece name as text instead of symbol for clarity */}
                                <td className="px-1 py-0.5 text-slate-300 font-semibold capitalize">
                                  {getPieceTypeName(m.pieceType)}
                                </td>
                                <td className="px-1 py-0.5 font-mono text-slate-300">
                                  {m.skipped ? (
                                    <span className="italic text-slate-600">skip</span>
                                  ) : (
                                    <span>{m.from}→{m.to}{m.capturedPiece ? '×' : ''}</span>
                                  )}
                                </td>
                                <td className="px-1 py-0.5 font-mono">
                                  {m.skipped ? (
                                    <span className="italic text-slate-600">—</span>
                                  ) : (
                                    <span>{m.san}</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* ── Captured Pieces (below move history, shrunk to content) ── */}
                {(capturedByWhiteFiles.length > 0 || capturedByBlackFiles.length > 0) && (
                  <div className="shrink-0 mt-2 bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 space-y-1.5">
                    <p className="text-[9px] text-slate-600 uppercase tracking-widest font-bold">Captures</p>
                    <CapturedPieces label="White took" pieces={capturedByWhiteFiles} pieceTheme={pieceTheme} />
                    <CapturedPieces label="Black took" pieces={capturedByBlackFiles} pieceTheme={pieceTheme} />
                  </div>
                )}
              </div>

            </div>
          )}

          {/* Chat Panel */}
          <div className={`flex-1 flex flex-col p-2.5 min-h-0 overflow-hidden ${activePanel !== 'chat' ? 'hidden' : ''}`}>
            <div className="flex-1 overflow-y-auto min-h-0">
              {user && (
                <GameChat
                  matchId={matchId}
                  currentUser={{ uid: user.uid, displayName: user.displayName, photoURL: user.photoURL }}
                  currentProfile={profile}
                  disabled={isGameOver}
                  onNewMessages={(count) => {
                    // Only increment when chat panel is not active
                    if (activePanel !== 'chat') {
                      setUnreadChatCount(prev => prev + count);
                    }
                  }}
                />
              )}
            </div>
          </div>
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

      {/* In-Game Settings Modal (issue 3) — renders the full SettingsPanelContent */}
      {settingsOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-violet-400" />
                Game Settings
              </h3>
              <button onClick={() => setSettingsOpen(false)} className="text-slate-500 hover:text-white cursor-pointer transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Scrollable settings panel content */}
            <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
              <SettingsPanelContent
                onSettingsChange={() => {
                  // Increment settingsVersion to force RollmateGame to re-derive
                  // board/piece theme from localStorage immediately (live refresh)
                  setSettingsVersion(v => v + 1);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
