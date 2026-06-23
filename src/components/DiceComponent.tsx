import React, { useEffect, useRef } from 'react';
import { PIECE_SYMBOLS, PIECE_TYPE_NAMES, DICE_FACES } from '../utils/chess';

interface DiceComponentProps {
  /** Current dice result face index (0-5), null if not yet rolled */
  result: number | null;
  /** Whether the dice is currently animating */
  rolling: boolean;
  /** Called when the Roll button is clicked */
  onRoll: () => void;
  /** Whether rolling is currently disabled (not your turn, game over, etc.) */
  disabled: boolean;
  /** Label shown below the roll button */
  label?: string;
}

/**
 * Animated 3D dice component for Rollmate mode.
 * Displays a CSS 3D cube that animates on roll, then snaps to the result face.
 * Each face shows the chess piece symbol + label corresponding to that face index.
 */
export const DiceComponent: React.FC<DiceComponentProps> = ({
  result,
  rolling,
  onRoll,
  disabled,
  label,
}) => {
  const diceRef = useRef<HTMLDivElement>(null);

  // Map face index to CSS transform that shows that face when applied to the inner cube
  // Face layout: 0=front(p), 1=back(n), 2=right(b), 3=left(r), 4=top(q), 5=bottom(k)
  const faceTransforms: Record<number, string> = {
    0: 'rotateX(0deg) rotateY(0deg)',
    1: 'rotateX(0deg) rotateY(180deg)',
    2: 'rotateX(0deg) rotateY(-90deg)',
    3: 'rotateX(0deg) rotateY(90deg)',
    4: 'rotateX(-90deg) rotateY(0deg)',
    5: 'rotateX(90deg) rotateY(0deg)',
  };

  // Trigger a brief shake animation, then snap to result face
  useEffect(() => {
    if (!rolling || !diceRef.current) return;
    const el = diceRef.current;
    el.style.transition = 'transform 0.1s ease';
    // Rapid random rotations to simulate rolling
    let count = 0;
    const interval = setInterval(() => {
      const rx = Math.floor(Math.random() * 4) * 90;
      const ry = Math.floor(Math.random() * 4) * 90;
      el.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
      count++;
      if (count >= 8) {
        clearInterval(interval);
      }
    }, 80);
    return () => clearInterval(interval);
  }, [rolling]);

  // Snap to result face after rolling stops
  useEffect(() => {
    if (rolling || result === null || !diceRef.current) return;
    const el = diceRef.current;
    el.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
    el.style.transform = faceTransforms[result] ?? faceTransforms[0];
  }, [rolling, result]);

  const pieceColors: Record<string, string> = {
    p: 'from-violet-500 to-violet-700',
    n: 'from-indigo-500 to-indigo-700',
    b: 'from-blue-500 to-blue-700',
    r: 'from-emerald-500 to-emerald-700',
    q: 'from-amber-500 to-amber-700',
    k: 'from-rose-500 to-rose-700',
  };

  const faceBgColors = [
    'bg-gradient-to-br from-violet-900/80 to-violet-950/90 border-violet-500/40',  // pawn
    'bg-gradient-to-br from-indigo-900/80 to-indigo-950/90 border-indigo-500/40',  // knight
    'bg-gradient-to-br from-blue-900/80 to-blue-950/90 border-blue-500/40',        // bishop
    'bg-gradient-to-br from-emerald-900/80 to-emerald-950/90 border-emerald-500/40', // rook
    'bg-gradient-to-br from-amber-900/80 to-amber-950/90 border-amber-500/40',     // queen
    'bg-gradient-to-br from-rose-900/80 to-rose-950/90 border-rose-500/40',        // king
  ];

  // Face positions in CSS 3D space (size = 72px = 4.5rem)
  const faceStyles: React.CSSProperties[] = [
    { transform: 'rotateY(0deg) translateZ(36px)' },   // front: pawn
    { transform: 'rotateY(180deg) translateZ(36px)' }, // back: knight
    { transform: 'rotateY(90deg) translateZ(36px)' },  // right: bishop
    { transform: 'rotateY(-90deg) translateZ(36px)' }, // left: rook
    { transform: 'rotateX(90deg) translateZ(36px)' },  // top: queen
    { transform: 'rotateX(-90deg) translateZ(36px)' }, // bottom: king
  ];

  const resultType = result !== null ? DICE_FACES[result] : null;

  return (
    <div className="flex flex-col items-center gap-3">
      {/* 3D Dice Scene */}
      <div
        className="relative"
        style={{ perspective: '300px', width: '72px', height: '72px' }}
      >
        <div
          ref={diceRef}
          style={{
            width: '72px',
            height: '72px',
            position: 'relative',
            transformStyle: 'preserve-3d',
            transform: result !== null ? faceTransforms[result] : 'rotateX(0deg) rotateY(0deg)',
            transition: 'transform 0.4s ease',
          }}
        >
          {DICE_FACES.map((pieceType, i) => (
            <div
              key={i}
              className={`absolute w-full h-full flex flex-col items-center justify-center rounded-xl border ${faceBgColors[i]} shadow-lg`}
              style={{
                ...faceStyles[i],
                backfaceVisibility: 'visible',
              }}
            >
              {/* Show only the chess piece symbol — no text label or number on the dice face */}
              <span className="text-2xl select-none leading-none" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.5))' }}>
                {PIECE_SYMBOLS[pieceType]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Result display */}
      <div className={`h-8 flex items-center justify-center transition-all duration-300 ${rolling ? 'opacity-0 scale-90' : 'opacity-100 scale-100'}`}>
        {resultType ? (
          <div className={`flex items-center gap-1.5 bg-gradient-to-r ${pieceColors[resultType]} px-3 py-1 rounded-full shadow-lg`}>
            <span className="text-base leading-none">{PIECE_SYMBOLS[resultType]}</span>
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              {PIECE_TYPE_NAMES[resultType]}
            </span>
          </div>
        ) : (
          <span className="text-xs text-slate-500 italic">Roll to play</span>
        )}
      </div>

      {/* Roll button */}
      <button
        onClick={onRoll}
        disabled={disabled || rolling}
        className={`w-full px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all border shadow-lg
          ${disabled || rolling
            ? 'bg-zinc-800/50 text-zinc-600 border-zinc-700/50 cursor-not-allowed'
            : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white border-violet-500/30 cursor-pointer hover:shadow-violet-500/20 hover:scale-[1.02] active:scale-[0.98]'
          }`}
      >
        {rolling ? (
          <span className="flex items-center justify-center gap-1.5">
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
            Rolling…
          </span>
        ) : (
          label || 'Roll Dice'
        )}
      </button>
    </div>
  );
};
