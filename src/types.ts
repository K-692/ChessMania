export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  rating: number;           // Elo rating of the player
  currentEloRating?: number; // Compatibility ELO rating
  createdAt: number;        // UTC timestamp
  lastActiveAt?: number;     // UTC timestamp
  lastUsernameChangedAt?: number | null; // UTC timestamp when username was last updated
  
  wins?: number;
  losses?: number;
  draws?: number;
  totalGamesPlayed?: number;
  totalWins?: number;
  totalLosses?: number;
  totalDraws?: number;
  winRateRatio?: number;
  lastLoginAt?: number;
  updatedAt?: number;

  // Embedded settings preference map
  settings?: {
    musicEnabled?: boolean;
    musicVolume?: number;
    soundEffectsEnabled?: boolean;
    legalMoveHintsEnabled?: boolean;
    boardTheme?: string;
    pieceStyle?: string;
  };
}

export type GameMode = 'Rollmate';

export type MatchStatus = 'active' | 'completed' | 'terminated';

export interface Match {
  id: string;
  players: string[]; // [challengerUid, challengedUid]
  whiteUid: string;
  blackUid: string;
  challengeId?: string | null;
  mode: GameMode;
  status: MatchStatus;
  winnerUid: string | null; // UID of winner, or null for draw/terminated
  createdAt: number;
  finishedAt: number | null;
  // Replay fields — populated when match is finalized in Firestore
  moveHistory?: RollmateMoveRecord[];
  totalMoves?: number;
}

export interface Friendship {
  id?: string;
  requesterUid: string;
  receiverUid: string;
  status: 'pending' | 'accepted';
  createdAt: number;
}

export interface FriendlyChallenge {
  id?: string;
  challengerUid: string;
  challengedUid: string;
  mode: GameMode;
  status: 'pending' | 'accepted' | 'declined' | 'completed';
  matchId: string | null;
  createdAt: number;
  acceptedAt?: number | null;
}

/**
 * A single move record in the Rollmate game, storing the dice roll
 * alongside the move so replays are fully accurate.
 */
export interface RollmateMoveRecord {
  moveNumber: number;       // Sequential move number (1-based)
  san: string;              // Standard Algebraic Notation of the move
  from: string;             // Source square e.g. "e2"
  to: string;               // Destination square e.g. "e4"
  fen: string;              // Board FEN *after* this move was applied
  diceRoll: number;         // Dice face index (0-5)
  pieceType: string;        // One of: p, n, b, r, q, k
  timestamp: number;        // UTC ms when the move was played
  skipped: boolean;         // true if turn was skipped (no legal moves)
  capturedPiece?: string;   // Piece type of captured piece, if any
  promotion?: string;       // Promotion piece type if pawn promoted
}

/**
 * Draw offer signal stored in RTDB to coordinate draw negotiations.
 */
export interface DrawOffer {
  fromUid: string;
  timestamp: number;
}

/**
 * Live RTDB game state structure for a Rollmate match.
 */
export interface RollmateRTDBState {
  fen: string;
  turn: 'w' | 'b';         // Whose turn it is
  diceRoll: number | null;  // Current dice face (null = not yet rolled)
  diceRolled: boolean;      // Whether dice has been rolled this turn
  status: MatchStatus;
  winnerUid: string | null;
  drawOffer: DrawOffer | null;
  moveHistory: RollmateMoveRecord[];
  moveCount: number;
}

/**
 * A single chat message stored in RTDB for the current game session.
 * Deleted when the game ends.
 */
export interface GameChatMessage {
  id: string;
  senderUid: string;
  displayName: string;
  photoURL: string;
  text: string;
  timestamp: number;
}
