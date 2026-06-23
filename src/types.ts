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
