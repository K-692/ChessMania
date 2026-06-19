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

function getDepthForElo(elo: number): number {
  if (elo <= 600) return 2;
  if (elo <= 800) return 3;
  if (elo <= 1000) return 4;
  if (elo <= 1200) return 5;
  if (elo <= 1400) return 6;
  if (elo <= 1600) return 7;
  if (elo <= 1800) return 9;
  return 12; // 2000+
}

export async function getBotMove(
  fen: string,
  elo: number,
  botColor: 'w' | 'b',
  movesHistory?: string[]
): Promise<{ san: string; from: string; to: string; promotion?: string } | null> {
  const depth = getDepthForElo(elo);

  let uciMoves: string[] = [];
  if (movesHistory && movesHistory.length > 0) {
    const tempChess = new Chess();
    for (const m of movesHistory) {
      try {
        const result = tempChess.move(m);
        if (result) {
          uciMoves.push(result.from + result.to + (result.promotion ? result.promotion.toLowerCase() : ''));
        }
      } catch (e) {
        console.warn("Failed to replay move in bot move calculation:", m, e);
      }
    }
  }

  try {
    const response = await fetch("https://chess-api.com/v1", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...(uciMoves.length > 0 ? { moves: uciMoves } : { fen }),
        depth
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.from && data.to) {
        let promotion = undefined;
        if (data.promotion) {
          promotion = data.promotion.toLowerCase();
        } else if (data.isPromotion) {
          promotion = 'q';
        }
        return {
          san: data.san || '',
          from: data.from,
          to: data.to,
          promotion
        };
      }
    }
  } catch (err) {
    console.warn("Failed to fetch move from Stockfish API, falling back to minimax:", err);
  }

  // Fallback to local minimax engine
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return null;

  const fallbackDepth = elo <= 800 ? 1 : elo <= 1400 ? 2 : 3;
  const { move } = minimax(chess, fallbackDepth, -Infinity, Infinity, true, botColor);
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
