export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  rating: number;
  bankBalance: number;
  createdAt: number; // UTC timestamp
  lastActiveAt: number; // UTC timestamp
  zeroBalanceAt: number | null; // UTC timestamp when balance hit zero
  lastInterestAppliedAt: number; // UTC timestamp of last lazy interest accrual
  lastHourlyRewardAt?: number; // UTC timestamp of last lazy hourly reward credit
  lastUsernameChangedAt?: number | null; // UTC timestamp when username was last updated
  totalCoinsEarned?: number; // Total coins earned by the player
  gameplayCounts?: Record<string, number>; // Maps game mode to play count
  wins?: number;
  losses?: number;
  draws?: number;
  country?: string;
  lastCountryChangedAt?: number | null;
}

export type GameMode =
  | 'beginner'
  | 'casual_rapid'
  | 'standard_rapid'
  | 'competitive_rapid'
  | 'classical_lite'
  | 'blitz'
  | 'competitive_blitz'
  | 'bullet'
  | 'arena_bullet'
  | 'championship'
  | 'all_in'
  | 'practice';

export interface MatchQueueEntry {
  id?: string;
  uid: string;
  rating: number;
  stake: number;
  mode: GameMode;
  createdAt: number;
  status: 'waiting' | 'matched' | 'cancelled';
  matchId?: string;
  timeControl?: string; // Chosen time control for All In
}

export type MatchStatus = 'active' | 'checkmate' | 'stalemate' | 'draw' | 'resigned' | 'timeout' | 'terminated';

export interface MatchClocks {
  [uid: string]: number; // remaining time in milliseconds
}

export interface Match {
  id: string;
  players: string[]; // [whiteUid, blackUid]
  challengeId?: string | null;
  whiteUid: string;
  blackUid: string;
  stake: number;
  mode: GameMode;
  boardFEN: string;
  turn: 'w' | 'b';
  clocks: MatchClocks;
  status: MatchStatus;
  winnerUid: string | null;
  createdAt: number;
  finishedAt: number | null;
  moves: string[]; // history of moves in SAN format
  lastMoveAt: number; // UTC timestamp of last move to compute clock elapsed
  drawOffers?: string[]; // uids of players offering draw
  timeControl?: string; // Time control string (e.g. '10 | 5', '15 min')
  allInStakes?: Record<string, number>; // Dynamic stakes for All In mode
  presence?: Record<string, boolean>; // Presence map for each player (UID -> online/offline)
  disconnectedAt?: number | null; // Timestamp when connection was lost
  disconnectedUid?: string | null; // UID of player who disconnected
  heartbeats?: Record<string, number>; // Live client heartbeats (UID -> timestamp)
}

export type WalletTransactionType = 'seed' | 'interest' | 'topup' | 'hourly_reward' | 'game_escrow' | 'game_payout' | 'purchase';

export interface WalletLedgerEntry {
  id?: string;
  uid: string;
  type: WalletTransactionType;
  amount: number;
  matchId: string | null;
  balanceBefore: number;
  balanceAfter: number;
  createdAt: number;
  pricePaid?: number; // Fiat price paid for purchase
  pricePaidINR?: number; // Fiat price paid in base INR
  currency?: string; // Currency used for purchase (INR, USD, etc.)
  opponentUid?: string;
}

export interface RatingLedgerEntry {
  id?: string;
  uid: string;
  matchId: string;
  delta: number;
  expectedScore: number;
  actualScore: number; // 1 (win), 0.5 (draw), 0 (loss)
  kFactor: number;
  createdAt: number;
  opponentUid?: string;
}

export interface Friendship {
  id?: string;
  requesterUid: string;
  receiverUid: string;
  status: 'pending' | 'accepted';
  createdAt: number;
  stats?: Record<
    string,
    {
      wins: number;
      losses: number;
      draws: number;
    }
  >;
}

export interface FriendlyChallenge {
  id?: string;
  challengerUid: string;
  challengedUid: string;
  mode: GameMode;
  stake: number;
  status: 'pending' | 'accepted' | 'declined' | 'completed';
  matchId: string | null;
  createdAt: number;
  acceptedAt?: number | null;
  colorChoice?: 'white' | 'black' | 'random';
}

