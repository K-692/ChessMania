import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

export const NetworkSignal: React.FC = () => {
  const [ping, setPing] = useState<number | null>(null);
  const [status, setStatus] = useState<'good' | 'medium' | 'poor' | 'offline'>('offline');

  useEffect(() => {
    let active = true;

    const measurePing = async () => {
      // Check browser online status
      if (!navigator.onLine) {
        if (active) {
          setPing(null);
          setStatus('offline');
        }
        return;
      }

      const start = performance.now();
      try {
        // Perform a quick fetch to the same origin with a cache-buster
        await fetch(`${window.location.origin}/favicon.svg?cb=${Date.now()}`, {
          method: 'HEAD',
          cache: 'no-store',
          mode: 'same-origin'
        });
        const latency = Math.round(performance.now() - start);
        
        if (active) {
          setPing(latency);
          if (latency < 80) {
            setStatus('good');
          } else if (latency < 200) {
            setStatus('medium');
          } else {
            setStatus('poor');
          }
        }
      } catch (err) {
        // Fallback GET request if HEAD is not allowed
        try {
          const startFallback = performance.now();
          await fetch(`${window.location.origin}/?cb=${Date.now()}`, {
            method: 'GET',
            cache: 'no-store',
            mode: 'same-origin'
          });
          const latency = Math.round(performance.now() - startFallback);
          if (active) {
            setPing(latency);
            if (latency < 80) setStatus('good');
            else if (latency < 200) setStatus('medium');
            else setStatus('poor');
          }
        } catch (e) {
          if (active) {
            setPing(null);
            setStatus('offline');
          }
        }
      }
    };

    measurePing();
    const interval = setInterval(measurePing, 4000); // Update every 4 seconds

    const handleOnline = () => measurePing();
    const handleOffline = () => {
      setPing(null);
      setStatus('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const getStatusColor = () => {
    switch (status) {
      case 'good':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'medium':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'poor':
        return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
      case 'offline':
      default:
        return 'text-slate-500 bg-zinc-800 border-zinc-700';
    }
  };

  const getStatusDotColor = () => {
    switch (status) {
      case 'good':
        return 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]';
      case 'medium':
        return 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]';
      case 'poor':
        return 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.5)]';
      case 'offline':
      default:
        return 'bg-slate-500';
    }
  };

  return (
    <div className={`inline-flex items-center space-x-2 px-3 py-1.5 rounded-lg border text-[10px] font-bold font-mono transition-all duration-300 ${getStatusColor()}`}>
      {status === 'offline' ? (
        <WifiOff className="w-3.5 h-3.5" />
      ) : (
        <Wifi className="w-3.5 h-3.5" />
      )}
      <span className="flex items-center space-x-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${getStatusDotColor()}`} />
        <span>{status === 'offline' ? 'OFFLINE' : `${ping} ms`}</span>
      </span>
    </div>
  );
};
