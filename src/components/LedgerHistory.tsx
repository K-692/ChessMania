import React, { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import type { WalletLedgerEntry } from '../types';
import { ChevronLeft, Calendar, Info, RefreshCw } from 'lucide-react';

interface LedgerHistoryProps {
  onBack: () => void;
}

export function formatTimestampLocal(utcMs: number): string {
  const date = new Date(utcMs);
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
}

export const LedgerHistory: React.FC<LedgerHistoryProps> = ({ onBack }) => {
  const { user } = useAuth();
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchLedger = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Query without orderBy to avoid needing a Firestore composite index
      const q = query(
        collection(db, 'transactions'),
        where('userId', '==', user.uid)
      );
      
      const querySnapshot = await getDocs(q);
      const entries: WalletLedgerEntry[] = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        entries.push({
          id: docSnap.id,
          ...data,
          uid: data.uid || data.userId || user.uid,
          userId: data.userId || data.uid || user.uid,
          amount: typeof data.coins === 'number' ? data.coins : (data.amount || 0),
        } as WalletLedgerEntry);
      });
      
      // Sort in memory by createdAt descending
      entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      
      setLedger(entries.slice(0, 100));
    } catch (err) {
      console.error('Error fetching ledger:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLedger();
  }, [user]);

  const getTypeText = (type: string) => {
    switch (type) {
      case 'seed': return 'Account Seed Credits';
      case 'interest': return 'Daily Yield Interest (1%)';
      case 'topup': return 'Zero-Balance Recovery Credit';
      case 'hourly_reward':
      case 'reward': return 'Hourly Reward Credit';
      case 'game_escrow':
      case 'stakeDebit': return 'Match Entry Stakes (Escrow)';
      case 'game_payout':
      case 'stakeCredit': return 'Match Settlement Payout';
      case 'purchase':
      case 'coinPack': return 'Coins Pack Purchase';
      case 'refund': return 'Match Stakes Refunded';
      case 'penalty': return 'Game Rule Penalty';
      default: return type;
    }
  };

  const getTypeStyle = (amount: number) => {
    if (amount > 0) {
      return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25';
    } else if (amount < 0) {
      return 'text-red-400 bg-red-500/10 border-red-500/25';
    }
    return 'text-slate-400 bg-slate-500/10 border-slate-500/25';
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6 text-left">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center space-x-2 text-slate-400 hover:text-white transition-colors text-sm font-medium"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back to Play</span>
        </button>

        <button
          onClick={fetchLedger}
          className="flex items-center space-x-2 text-slate-400 hover:text-white transition-colors text-xs border border-white/5 bg-slate-900/60 px-3 py-1.5 rounded-lg"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center space-x-2.5">
          <img src="/coin_pack/100 coins.png" alt="Coin" className="w-6 h-6 object-contain" />
          <span>Transactions</span>
        </h2>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Retrieving ledger log...</p>
        </div>
      ) : ledger.length === 0 ? (
        <div className="glass p-12 rounded-xl text-center border border-white/5 space-y-2">
          <Info className="w-8 h-8 text-slate-500 mx-auto" />
          <p className="text-slate-400 font-medium">No ledger records found</p>
          <p className="text-xs text-slate-600">Transactions will appear here once rewards accrue or you make purchases/play games.</p>
        </div>
      ) : (
        <div className="glass rounded-xl border border-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse text-left">
              <thead>
                <tr className="bg-slate-950/40 border-b border-white/5 text-slate-400 font-semibold text-xs uppercase tracking-wider">
                  <th className="px-6 py-4">Transaction / Event</th>
                  <th className="px-6 py-4">Change Amount</th>
                  <th className="px-6 py-4">Wallet Balance</th>
                  <th className="px-6 py-4">Timestamp</th>
                  <th className="px-6 py-4">Reference Match ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-slate-950/10">
                {ledger.map((entry) => (
                  <tr key={entry.id} className="hover:bg-white/[0.02] transition-colors">
                    {/* Event Description */}
                    <td className="px-6 py-4 font-medium text-slate-200">
                      {getTypeText(entry.type)}
                    </td>
                    
                    {/* Amount Change */}
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-xs border font-semibold ${getTypeStyle(entry.amount)}`}>
                        {entry.amount > 0 ? `+${entry.amount.toFixed(2)}` : entry.amount.toFixed(2)}
                      </span>
                    </td>

                    {/* Balance After */}
                    <td className="px-6 py-4 font-mono font-medium text-slate-300">
                      {entry.balanceAfter.toFixed(2)}
                    </td>

                    {/* Timestamp in IST */}
                    <td className="px-6 py-4 text-slate-400 flex items-center space-x-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      <span>{formatTimestampLocal(entry.createdAt)}</span>
                    </td>

                    {/* Reference ID */}
                    <td className="px-6 py-4 font-mono text-xs text-slate-500">
                      {entry.matchId ? entry.matchId.substring(0, 8) + '...' : '---'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
