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
 */
export function rollDice(): number {
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
 * Returns all legal moves for the given color and piece type.
 * Relies on chess.js which already filters out moves that leave king in check.
 *
 * @param chess  - Active chess.js Chess instance
 * @param color  - 'w' or 'b'
 * @param type   - piece type letter: p, n, b, r, q, k
 * @returns Array of verbose move objects that match the piece type
 */
export function getLegalMovesForPieceType(
  chess: Chess,
  color: 'w' | 'b',
  type: string
) {
  const allMoves = chess.moves({ verbose: true });
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
 * This encapsulates both the "no pieces of that type" and "no legal moves" cases.
 *
 * @param chess     - Active chess.js Chess instance
 * @param color     - Active player color
 * @param pieceType - Piece type letter from dice roll
 */
export function hasLegalMovesForRoll(
  chess: Chess,
  color: 'w' | 'b',
  pieceType: string
): boolean {
  return getLegalMovesForPieceType(chess, color, pieceType).length > 0;
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
 *
 * @param chess      - Active chess.js Chess instance
 * @param square     - Currently selected square (e.g., "e2")
 * @param pieceType  - Rolled piece type (only show hints if piece matches)
 * @param color      - Active player color
 * @returns Record of square → style object for react-chessboard customSquareStyles
 */
export function getLegalMoveSquares(
  chess: Chess,
  square: string,
  pieceType: string,
  color: 'w' | 'b'
): Record<string, CSSProperties> {
  const piece = chess.get(square as any);
  if (!piece || piece.type !== pieceType || piece.color !== color) return {};

  const moves = chess.moves({ square: square as any, verbose: true });
  const styles: Record<string, CSSProperties> = {};

  for (const move of moves) {
    const isCapture = !!move.captured;
    styles[move.to] = isCapture
      ? {
          background: 'radial-gradient(circle, rgba(239,68,68,0.6) 40%, transparent 41%)',
          borderRadius: '50%',
        }
      : {
          background: 'radial-gradient(circle, rgba(139,92,246,0.5) 25%, transparent 26%)',
          borderRadius: '50%',
        };
  }

  return styles;
}
