import { Chess } from 'chess.js';

const PIECE_VALUES: Record<string, number> = {
  p: 10, n: 30, b: 30, r: 50, q: 90, k: 9000
};

// Simple positional evaluation to give basic chess sense
function evaluateBoard(chess: Chess, botColor: 'w' | 'b'): number {
  let score = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece) {
        let value = PIECE_VALUES[piece.type] || 0;
        
        // Center control bonus
        if ((r >= 3 && r <= 4) && (c >= 3 && c <= 4)) {
          value += 1.5;
        }
        
        if (piece.color === botColor) {
          score += value;
        } else {
          score -= value;
        }
      }
    }
  }
  return score;
}

// Minimax with Alpha-Beta pruning
function minimax(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizing: boolean,
  botColor: 'w' | 'b'
): { score: number; move: any } {
  if (depth === 0 || chess.isGameOver()) {
    return { score: evaluateBoard(chess, botColor), move: null };
  }

  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) {
    return { score: evaluateBoard(chess, botColor), move: null };
  }

  // Sort captures first to prune alpha-beta branches faster
  moves.sort((a, b) => {
    const aVal = (a.captured ? PIECE_VALUES[a.captured] : 0) + (a.san.includes('+') ? 3 : 0);
    const bVal = (b.captured ? PIECE_VALUES[b.captured] : 0) + (b.san.includes('+') ? 3 : 0);
    return bVal - aVal;
  });

  let bestMove = moves[0];

  if (isMaximizing) {
    let maxScore = -Infinity;
    for (const move of moves) {
      chess.move(move);
      const { score } = minimax(chess, depth - 1, alpha, beta, false, botColor);
      chess.undo();
      if (score > maxScore) {
        maxScore = score;
        bestMove = move;
      }
      alpha = Math.max(alpha, score);
      if (beta <= alpha) {
        break; // Beta cut-off
      }
    }
    return { score: maxScore, move: bestMove };
  } else {
    let minScore = Infinity;
    for (const move of moves) {
      chess.move(move);
      const { score } = minimax(chess, depth - 1, alpha, beta, true, botColor);
      chess.undo();
      if (score < minScore) {
        minScore = score;
        bestMove = move;
      }
      beta = Math.min(beta, score);
      if (beta <= alpha) {
        break; // Alpha cut-off
      }
    }
    return { score: minScore, move: bestMove };
  }
}

export function getBotMove(
  fen: string,
  elo: number,
  botColor: 'w' | 'b'
): { san: string; from: string; to: string; promotion?: string } | null {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return null;

  let depth = 2;
  let randomChance = 0.0;

  if (elo <= 800) {
    depth = 1;
    randomChance = 0.50; // 50% random moves for beginner difficulty
  } else if (elo <= 1200) {
    depth = 2;
    randomChance = 0.20; // 20% random moves
  } else if (elo <= 1600) {
    depth = 3;
    randomChance = 0.05; // 5% random moves
  } else {
    depth = 3; // depth 3 is fast and solid for ELO 2000 in browser
    randomChance = 0.0;
  }

  // Play random move sometimes based on Elo handicap
  if (Math.random() < randomChance) {
    const randomMove = moves[Math.floor(Math.random() * moves.length)];
    return {
      san: randomMove.san,
      from: randomMove.from,
      to: randomMove.to,
      promotion: randomMove.promotion
    };
  }

  const { move } = minimax(chess, depth, -Infinity, Infinity, true, botColor);
  if (!move) {
    const fallbackMove = moves[Math.floor(Math.random() * moves.length)];
    return {
      san: fallbackMove.san,
      from: fallbackMove.from,
      to: fallbackMove.to,
      promotion: fallbackMove.promotion
    };
  }

  return {
    san: move.san,
    from: move.from,
    to: move.to,
    promotion: move.promotion
  };
}
