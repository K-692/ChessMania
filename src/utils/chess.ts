import { Chess } from 'chess.js';
import type { CSSProperties } from 'react';
import type { RollmateMoveRecord } from '../types';

// ---------------------------------------------------------------------------
// Dice face definitions
// Each face maps to a chess piece type letter (chess.js convention)
// ---------------------------------------------------------------------------

/** Ordered dice faces: index 0-5 → piece type letter */
export const DICE_FACES: string[] = ['p', 'n', 'b', 'r', 'q', 'k'];

/** Human-readable labels for each piece type */
export const PIECE_TYPE_NAMES: Record<string, string> = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
};

/** Unicode chess symbols for display (white piece symbols used for all) */
export const PIECE_SYMBOLS: Record<string, string> = {
  p: '♟',
  n: '♞',
  b: '♝',
  r: '♜',
  q: '♛',
  k: '♚',
};

// ---------------------------------------------------------------------------
// Dice rolling
// ---------------------------------------------------------------------------

/**
 * Returns a random dice face index (0-5).
 * Each index corresponds to a piece type in DICE_FACES.
 * Uses cryptographically secure and mathematically unbiased randomness when available.
 */
export function rollDice(): number {
  if (typeof window !== 'undefined' && window.crypto) {
    const array = new Uint32Array(1);
    let val;
    do {
      window.crypto.getRandomValues(array);
      val = array[0];
    } while (val >= 4294967296 - (4294967296 % 6));
    return val % 6;
  }
  return Math.floor(Math.random() * 6);
}

/**
 * Returns the piece type letter for a given dice face index.
 */
export function getPieceTypeForFace(faceIndex: number): string {
  return DICE_FACES[faceIndex] ?? 'p';
}

/**
 * Returns the human-readable name for a piece type letter.
 */
export function getPieceTypeName(pieceType: string): string {
  return PIECE_TYPE_NAMES[pieceType] ?? pieceType.toUpperCase();
}

// ---------------------------------------------------------------------------
// Legal move filtering
// ---------------------------------------------------------------------------

/**
 * Returns a new Chess instance loaded from `fen`, but with its active color
 * forcibly set to `color`. This is critical because chess.moves() only
 * returns moves for the currently active color in the FEN. If the stored
 * FEN's active color doesn't match the player whose turn it is (due to
 * skip-flip or timing issues), we need to correct it before querying moves.
 *
 * @param fen   - Current board FEN string
 * @param color - The player whose turn it actually is
 * @returns A fresh Chess instance with the correct active color
 */
export function chessWithCorrectTurn(fen: string, color: 'w' | 'b'): Chess {
  const parts = fen.split(' ');
  const originalColor = parts[1]; // Save original active color before overwriting
  // parts[1] is the active color field in FEN — force it to the desired color
  parts[1] = color;
  // If we changed the active color, also reset the en passant square to '-'.
  // An en passant target square is only valid for the side that just moved
  // (the opponent). If we flip the active color without a real move having
  // occurred, the en passant square would be invalid for the new active color,
  // causing chess.js to reject the FEN or compute incorrect legal moves.
  if (originalColor !== color) {
    parts[3] = '-';
  }
  const normalizedFen = parts.join(' ');
  const tempChess = new Chess();
  try {
    tempChess.load(normalizedFen);
  } catch {
    // Fallback: load original FEN if normalized version fails
    try { tempChess.load(fen); } catch { /* ignore */ }
  }
  return tempChess;
}

/**
 * Returns all legal moves for the given color and piece type.
 * IMPORTANT: Uses a temporary chess instance with the correct active color
 * so that chess.moves() returns the right player's moves regardless of what
 * active color is encoded in the FEN. This prevents false "no legal moves"
 * results when the FEN's active color gets out of sync with gameState.turn.
 *
 * @param fen    - Current board FEN string
 * @param color  - 'w' or 'b' — the player whose turn it is
 * @param type   - piece type letter: p, n, b, r, q, k
 * @returns Array of verbose move objects that match the piece type
 */
export function getLegalMovesForPieceType(
  fen: string,
  color: 'w' | 'b',
  type: string
) {
  // Use a temporary chess instance with the correct active color
  const tempChess = chessWithCorrectTurn(fen, color);
  const allMoves = tempChess.moves({ verbose: true });
  return allMoves.filter(
    (m) => m.color === color && m.piece === type
  );
}

/**
 * Returns true if the board has at least one piece of the given type for the color.
 *
 * @param chess - Active chess.js Chess instance
 * @param color - 'w' or 'b'
 * @param type  - piece type letter
 */
export function hasPieceType(chess: Chess, color: 'w' | 'b', type: string): boolean {
  const board = chess.board();
  for (const row of board) {
    for (const cell of row) {
      if (cell && cell.color === color && cell.type === type) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Returns true if the rolled piece type has any legal moves this turn.
 * Uses the FEN-based approach to correctly identify legal moves regardless
 * of the chess instance's current active color state.
 *
 * @param fen       - Current board FEN string
 * @param color     - Active player color
 * @param pieceType - Piece type letter from dice roll
 */
export function hasLegalMovesForRoll(
  fen: string,
  color: 'w' | 'b',
  pieceType: string
): boolean {
  return getLegalMovesForPieceType(fen, color, pieceType).length > 0;
}

// ---------------------------------------------------------------------------
// Captured pieces extraction
// ---------------------------------------------------------------------------

/**
 * Derives captured pieces for both sides from the move history array.
 * Returns two arrays: pieces captured by white (i.e., black pieces taken)
 * and pieces captured by black (i.e., white pieces taken).
 *
 * @param moveHistory - Full array of RollmateMoveRecord
 * @returns { capturedByWhite: string[], capturedByBlack: string[] }
 */
export function getCaptures(moveHistory: RollmateMoveRecord[]): {
  capturedByWhite: string[];
  capturedByBlack: string[];
} {
  const capturedByWhite: string[] = [];
  const capturedByBlack: string[] = [];

  for (const move of moveHistory) {
    if (move.skipped || !move.capturedPiece) continue;
    // White moves (w) capture black pieces → show under black
    // But from the perspective of "what white captured" we track black captures
    // pieceType is the mover's piece; capturedPiece is what was taken
    if (move.pieceType && move.capturedPiece) {
      // Determine mover color from the chess perspective:
      // White moves on odd half-turns, black on even (moveNumber is sequential including skips)
      // Instead we rely on the turn embedded: odd move numbers are white (since white goes first)
      const isWhiteMove = move.moveNumber % 2 === 1;
      if (isWhiteMove) {
        capturedByWhite.push(move.capturedPiece);
      } else {
        capturedByBlack.push(move.capturedPiece);
      }
    }
  }

  return { capturedByWhite, capturedByBlack };
}

// ---------------------------------------------------------------------------
// Board state helpers
// ---------------------------------------------------------------------------

/**
 * Returns highlighted squares for legal moves of a selected piece.
 * Used to render move-hint dots on the board.
 * Uses a FEN-based temporary chess instance to correctly handle the active
 * color, preventing move hints from failing when FEN color is out of sync.
 *
 * @param fen        - Current board FEN string
 * @param square     - Currently selected square (e.g., "e2")
 * @param pieceType  - Rolled piece type (only show hints if piece matches)
 * @param color      - Active player color
 * @returns Record of square → style object for react-chessboard customSquareStyles
 */
export function getLegalMoveSquares(
  fen: string,
  square: string,
  pieceType: string,
  color: 'w' | 'b'
): Record<string, CSSProperties> {
  // Use a temporary chess instance with the correct active color
  const tempChess = chessWithCorrectTurn(fen, color);
  const piece = tempChess.get(square as any);
  if (!piece || piece.type !== pieceType || piece.color !== color) return {};

  const moves = tempChess.moves({ square: square as any, verbose: true });
  const styles: Record<string, CSSProperties> = {};

  for (const move of moves) {
    const isCapture = !!move.captured;
    styles[move.to] = isCapture
      ? {
          // Red ring for capture squares — clearly visible on all board themes
          background: 'radial-gradient(circle, rgba(220,38,38,0.75) 36%, transparent 37%)',
          borderRadius: '50%',
        }
      : {
          // Black dot for legal move squares — standard chess convention
          background: 'radial-gradient(circle, rgba(0,0,0,0.65) 28%, transparent 29%)',
          borderRadius: '50%',
        };
  }

  return styles;
}

// ---------------------------------------------------------------------------
// FEN active color flip (used for skip turns)
// ---------------------------------------------------------------------------

/**
 * Returns a new FEN string with the active color flipped.
 * This is CRITICAL for skip turns: when a player skips, the board position
 * stays the same but chess.js must know it is now the OTHER player's turn.
 * Without this, chess.moves() would always return the previous player's moves,
 * causing hasLegalMovesForRoll to incorrectly auto-skip every subsequent turn.
 *
 * @param fen - Current FEN string
 * @returns   - New FEN with active color toggled ('w' <-> 'b') and en-passant reset
 */
export function flipFenActiveColor(fen: string): string {
  const parts = fen.split(' ');
  // parts[1] = active color ('w' or 'b')
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  // parts[3] = en passant target square; reset to '-' since no move was made
  parts[3] = '-';
  return parts.join(' ');
}

