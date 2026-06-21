import React, { useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

export const NetworkSignal: React.FC = () => {
  const [latency, setLatency] = useState<number | null>(null);
  const [status, setStatus] = useState<'excellent' | 'good' | 'fair' | 'poor' | 'offline'>('excellent');

  useEffect(() => {
    let active = true;

    const checkPing = async () => {
      if (!navigator.onLine) {
        if (active) {
          setLatency(null);
          setStatus('offline');
        }
        return;
      }

      const start = performance.now();
      try {
        // Fetch index.html headers with cache buster to measure real round trip time
        await fetch(`/?t=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
        const rtt = Math.round(performance.now() - start);
        if (!active) return;
        setLatency(rtt);
        if (rtt < 150) setStatus('excellent');
        else if (rtt < 300) setStatus('good');
        else if (rtt < 500) setStatus('fair');
        else setStatus('poor');
      } catch (err) {
        if (!active) return;
        setLatency(null);
        setStatus('offline');
      }
    };

    checkPing();
    const interval = setInterval(checkPing, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const getBars = () => {
    switch (status) {
      case 'excellent':
        return (
          <div className="flex items-end gap-[2px] h-3">
            <span className="w-[3px] h-[3px] bg-emerald-500 rounded-[1px] shadow-[0_0_4px_rgba(16,185,129,0.5)]"></span>
            <span className="w-[3px] h-[6px] bg-emerald-500 rounded-[1px] shadow-[0_0_4px_rgba(16,185,129,0.5)]"></span>
            <span className="w-[3px] h-[9px] bg-emerald-500 rounded-[1px] shadow-[0_0_4px_rgba(16,185,129,0.5)]"></span>
            <span className="w-[3px] h-[12px] bg-emerald-500 rounded-[1px] shadow-[0_0_4px_rgba(16,185,129,0.5)]"></span>
          </div>
        );
      case 'good':
        return (
          <div className="flex items-end gap-[2px] h-3">
            <span className="w-[3px] h-[3px] bg-lime-500 rounded-[1px]"></span>
            <span className="w-[3px] h-[6px] bg-lime-500 rounded-[1px]"></span>
            <span className="w-[3px] h-[9px] bg-lime-500 rounded-[1px]"></span>
            <span className="w-[3px] h-[12px] bg-white/20 rounded-[1px]"></span>
          </div>
        );
      case 'fair':
        return (
          <div className="flex items-end gap-[2px] h-3">
            <span className="w-[3px] h-[3px] bg-amber-500 rounded-[1px]"></span>
            <span className="w-[3px] h-[6px] bg-amber-500 rounded-[1px]"></span>
            <span className="w-[3px] h-[9px] bg-white/20 rounded-[1px]"></span>
            <span className="w-[3px] h-[12px] bg-white/20 rounded-[1px]"></span>
          </div>
        );
      case 'poor':
        return (
          <div className="flex items-end gap-[2px] h-3">
            <span className="w-[3px] h-[3px] bg-red-500 rounded-[1px] animate-pulse"></span>
            <span className="w-[3px] h-[6px] bg-white/20 rounded-[1px]"></span>
            <span className="w-[3px] h-[9px] bg-white/20 rounded-[1px]"></span>
            <span className="w-[3px] h-[12px] bg-white/20 rounded-[1px]"></span>
          </div>
        );
      default:
        return (
          <div className="flex items-end gap-[2px] h-3">
            <span className="w-[3px] h-[3px] bg-red-600/40 rounded-[1px]"></span>
            <span className="w-[3px] h-[6px] bg-red-600/40 rounded-[1px]"></span>
            <span className="w-[3px] h-[9px] bg-red-600/40 rounded-[1px]"></span>
            <span className="w-[3px] h-[12px] bg-red-600/40 rounded-[1px]"></span>
          </div>
        );
    }
  };

  const getTooltip = () => {
    if (status === 'offline') return 'Connection: Offline';
    return `Ping: ${latency ?? 'Measuring...'}ms (${status.toUpperCase()})`;
  };

  return (
    <div 
      className="flex items-center gap-2 bg-slate-950/40 border border-white/10 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold font-mono text-slate-400 hover:text-slate-200 transition-all shadow-inner relative group cursor-help"
      title={getTooltip()}
    >
      {status === 'offline' ? (
        <WifiOff className="w-3.5 h-3.5 text-red-500 animate-pulse" />
      ) : (
        <Wifi className={`w-3.5 h-3.5 ${status === 'excellent' ? 'text-emerald-500' : status === 'good' ? 'text-lime-500' : status === 'fair' ? 'text-amber-500' : 'text-red-500'}`} />
      )}
      
      {getBars()}
      
      <span className="hidden sm:inline">
        {status === 'offline' ? 'Offline' : `${latency !== null ? `${latency}ms` : 'Connecting...'}`}
      </span>

      {/* Premium tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-950/90 border border-white/10 text-white rounded text-[9px] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-xl">
        {getTooltip()}
      </div>
    </div>
  );
};
