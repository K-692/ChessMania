import type { GameMode } from '../types';

export interface Achievement {
  id: GameMode;
  name: string;
  badge: string;
  description: string;
  color: string; // Styling color class
  difficultyRank: number; // Higher is harder
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'beginner',
    name: 'Beginner Pioneer 🌱',
    badge: '🌱 Pioneer',
    description: 'Won 5 Beginner matches. Fundamentals established.',
    color: 'text-slate-400 border-slate-500/30 bg-slate-500/5 hover:bg-slate-500/10 hover:border-slate-500/50',
    difficultyRank: 1
  },
  {
    id: 'casual_rapid',
    name: 'Rapid Casual 🍃',
    badge: '🍃 Casual',
    description: 'Won 5 Casual Rapid matches. Daily flow established.',
    color: 'text-teal-400 border-teal-500/30 bg-teal-500/5 hover:bg-teal-500/10 hover:border-teal-500/50',
    difficultyRank: 2
  },
  {
    id: 'standard_rapid',
    name: 'Rapid Challenger ⚔️',
    badge: '⚔️ Challenger',
    description: 'Won 5 Standard Rapid matches. Ready for climb.',
    color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 hover:border-emerald-500/50',
    difficultyRank: 3
  },
  {
    id: 'competitive_rapid',
    name: 'Rapid Tactician 🛡️',
    badge: '🛡️ Tactician',
    description: 'Won 5 Competitive Rapid matches. Strategic mind at work.',
    color: 'text-blue-400 border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500/50',
    difficultyRank: 4
  },
  {
    id: 'classical_lite',
    name: 'Classical strategist 🧠',
    badge: '🧠 Positional',
    description: 'Won 5 Classical Lite matches. Position master.',
    color: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/5 hover:bg-indigo-500/10 hover:border-indigo-500/50',
    difficultyRank: 5
  },
  {
    id: 'blitz',
    name: 'Blitz Veteran ⏱️',
    badge: '⏱️ Blitz Vet',
    description: 'Won 5 Blitz matches. Combat tested in fast arenas.',
    color: 'text-amber-400 border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-500/50',
    difficultyRank: 6
  },
  {
    id: 'competitive_blitz',
    name: 'Blitz Warlord ⚡',
    badge: '⚡ Blitz GM',
    description: 'Won 5 Competitive Blitz matches. Grand speed specialist.',
    color: 'text-pink-400 border-pink-500/30 bg-pink-500/5 hover:bg-pink-500/10 hover:border-pink-500/50',
    difficultyRank: 7
  },
  {
    id: 'bullet',
    name: 'Bullet Speedster 🔥',
    badge: '🔥 Bullet',
    description: 'Won 5 Bullet matches. Lightning reflex speed matches.',
    color: 'text-red-400 border-red-500/30 bg-red-500/5 hover:bg-red-500/10 hover:border-red-500/50',
    difficultyRank: 8
  },
  {
    id: 'arena_bullet',
    name: 'Arena Bullet Overlord 💀',
    badge: '💀 Speed Demon',
    description: 'Won 5 Arena Bullet matches. Elite speed chess champion.',
    color: 'text-fuchsia-400 border-fuchsia-500/30 bg-fuchsia-500/5 hover:bg-fuchsia-500/10 hover:border-fuchsia-500/50',
    difficultyRank: 9
  },
  {
    id: 'championship',
    name: 'Champion 🏆',
    badge: '🏆 Champion',
    description: 'Won 5 Championship matches. The ultimate arena champion.',
    color: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/10 hover:border-yellow-500/50',
    difficultyRank: 10
  }
];

export function getBestAchievement(gameplayCounts?: Record<string, number>): Achievement | null {
  if (!gameplayCounts) return null;

  // Sort achievements by difficulty rank desc
  const sorted = [...ACHIEVEMENTS].sort((a, b) => b.difficultyRank - a.difficultyRank);
  for (const ach of sorted) {
    if ((gameplayCounts[ach.id] || 0) >= 5) {
      return ach;
    }
  }
  return null;
}
