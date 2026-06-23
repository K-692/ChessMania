import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { LogIn, LogOut, Menu, X, Settings } from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { ref as rRef, onValue } from 'firebase/database';
import { db, rtdb } from '../firebase';

interface NavbarProps {
  onNavigate: (view: 'dashboard' | 'social' | 'profile' | 'settings') => void;
  currentView: string;
  isGameActive?: boolean;
  unreadChatsCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({ onNavigate, currentView, isGameActive = false, unreadChatsCount = 0 }) => {
  const { user, profile, login, logout, loading } = useAuth();
  const [fCount, setFCount] = useState(0);
  const [cCount, setCCount] = useState(0);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const pendingCount = fCount + cCount + unreadChatsCount;

  useEffect(() => {
    if (!user) {
      setFCount(0);
      setCCount(0);
      return;
    }

    // Listen to incoming friend requests
    const qFriendships = query(
      collection(db, 'users', user.uid, 'friends'),
      where('status', '==', 'pending_received')
    );
    const unsubFriendships = onSnapshot(qFriendships, (snap) => {
      setFCount(snap.size);
    }, (err) => {
      console.warn("Error listening to pending friendships in Navbar:", err);
    });

    // Listen to incoming friendly challenges in RTDB
    const userChallengesRef = rRef(rtdb, `user_challenges/${user.uid}`);
    const unsubChallenges = onValue(userChallengesRef, (snap) => {
      if (snap.exists()) {
        const challenges = snap.val();
        let count = 0;
        for (const cid in challenges) {
          const ch = challenges[cid];
          if (ch.status === 'pending' && ch.challengedUid === user.uid) {
            count++;
          }
        }
        setCCount(count);
      } else {
        setCCount(0);
      }
    }, (err) => {
      console.warn("Error listening to pending challenges in Navbar:", err);
    });

    return () => {
      unsubFriendships();
      unsubChallenges();
    };
  }, [user]);

  return (
    <nav className="glass sticky top-0 z-50 px-6 py-4 border-b border-white/5 backdrop-blur-md">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        
        {/* Brand Logo & Name */}
        <div 
          className="flex items-center space-x-3 cursor-pointer"
          onClick={() => {
            if (!isGameActive) {
              onNavigate('dashboard');
            }
          }}
        >
          <div className="flex items-center justify-center bg-zinc-950 p-1 rounded-xl border border-white/5 overflow-hidden w-12 h-12 shrink-0">
            <img src="/game_logo.png" alt="ChessMania Logo" className="w-full h-full object-cover rounded-lg" />
          </div>
          <div className="flex flex-col text-left font-black tracking-wider text-white select-none leading-none">
            <span className="text-base font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-zinc-200 to-zinc-400">ChessMania</span>
            <span className="text-[9px] text-zinc-500 font-mono mt-0.5">THE ULTIMATE MANIA</span>
          </div>
        </div>

        {/* Desktop Navigation Links Menu */}
        <div className="hidden lg:flex items-center space-x-6">
          {!isGameActive && (
            user ? (
              <>
                <button
                  onClick={() => onNavigate('dashboard')}
                  className={`text-sm font-semibold transition-colors cursor-pointer ${
                    currentView === 'dashboard' ? 'text-violet-400' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Home
                </button>
                
                <button
                  onClick={() => onNavigate('social')}
                  className={`relative text-sm font-semibold transition-colors cursor-pointer flex items-center ${
                    currentView === 'social' ? 'text-violet-400' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>Friends</span>
                  {pendingCount > 0 && (
                    <span className="ml-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-violet-600 text-[9px] font-bold text-white ring-1 ring-zinc-950">
                      {pendingCount}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => onNavigate('profile')}
                  className={`text-sm font-semibold transition-colors cursor-pointer ${
                    currentView === 'profile' ? 'text-violet-400' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Profile
                </button>

                <button
                  onClick={() => onNavigate('settings')}
                  className={`transition-colors cursor-pointer flex items-center ${
                    currentView === 'settings' ? 'text-violet-400' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Settings"
                >
                  <Settings className="w-4.5 h-4.5" />
                </button>

                {/* User Profile Card */}
                <div 
                  className="flex items-center space-x-3 border-l border-white/10 pl-5 cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => onNavigate('profile')}
                >
                  <img
                    src={profile?.photoURL || user.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop'}
                    alt={profile?.displayName || ''}
                    className={`w-8 h-8 rounded-full object-cover ring-2 transition-all ${
                      currentView === 'profile' ? 'ring-violet-500' : 'ring-violet-500/20'
                    }`}
                  />
                  <div className="hidden md:block text-left leading-tight">
                    <p className="text-xs font-semibold text-slate-200">
                      {profile?.displayName || user.displayName}
                    </p>
                    <p className="text-[9px] text-amber-400 font-mono font-semibold">
                      {profile?.rating || 1200} Elo
                    </p>
                  </div>
                </div>

                <button
                  onClick={logout}
                  disabled={loading}
                  className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                onClick={login}
                disabled={loading}
                className="flex items-center space-x-2 bg-zinc-900 hover:bg-zinc-800 text-white px-5 py-2 rounded-xl font-medium shadow-md transition-all border border-zinc-800 disabled:opacity-50 cursor-pointer text-xs"
              >
                <LogIn className="w-4 h-4" />
                <span>Sign in</span>
              </button>
            )
          )}
        </div>

        {/* Mobile Hamburger Button Controls */}
        <div className="flex lg:hidden items-center space-x-3">
          {!isGameActive && user && (
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 text-slate-400 hover:text-white bg-zinc-900 border border-white/5 rounded-xl transition-all cursor-pointer flex items-center justify-center animate-fade-in"
              title="Navigation Menu"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}

          {!isGameActive && !user && (
            <button
              onClick={login}
              disabled={loading}
              className="flex items-center space-x-2 bg-zinc-900 hover:bg-zinc-800 text-white px-4 py-2 rounded-xl font-medium shadow-md transition-all border border-zinc-800 disabled:opacity-50 cursor-pointer text-xs"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile Drawer Slide Down Menu Overlay */}
      {!isGameActive && user && isMobileMenuOpen && (
        <div className="absolute top-[100%] left-0 right-0 lg:hidden glass border-b border-white/5 bg-zinc-950/95 backdrop-blur-xl p-5 flex flex-col space-y-4 shadow-2xl z-50 animate-fade-in text-left">
          <div className="flex flex-col space-y-1">
            <button
              onClick={() => {
                onNavigate('dashboard');
                setIsMobileMenuOpen(false);
              }}
              className={`text-left px-4 py-3 rounded-xl transition-all text-sm font-semibold ${
                currentView === 'dashboard'
                  ? 'bg-violet-600/10 text-violet-300 border border-violet-500/25'
                  : 'text-slate-300 hover:bg-white/5 border border-transparent'
              }`}
            >
              Home
            </button>
            
            <button
              onClick={() => {
                onNavigate('social');
                setIsMobileMenuOpen(false);
              }}
              className={`text-left px-4 py-3 rounded-xl transition-all text-sm font-semibold flex items-center justify-between ${
                currentView === 'social'
                  ? 'bg-violet-600/10 text-violet-300 border border-violet-500/25'
                  : 'text-slate-300 hover:bg-white/5 border border-transparent'
              }`}
            >
              <span>Friends</span>
              {pendingCount > 0 && (
                <span className="bg-violet-600 text-[10px] font-bold text-white px-2.5 py-0.5 rounded-full">
                  {pendingCount}
                </span>
              )}
            </button>

            <button
              onClick={() => {
                onNavigate('profile');
                setIsMobileMenuOpen(false);
              }}
              className={`text-left px-4 py-3 rounded-xl transition-all text-sm font-semibold ${
                currentView === 'profile'
                  ? 'bg-violet-600/10 text-violet-300 border border-violet-500/25'
                  : 'text-slate-300 hover:bg-white/5 border border-transparent'
              }`}
            >
              Profile
            </button>

            <button
              onClick={() => {
                onNavigate('settings');
                setIsMobileMenuOpen(false);
              }}
              className={`text-left px-4 py-3 rounded-xl transition-all text-sm font-semibold flex items-center space-x-2 ${
                currentView === 'settings'
                  ? 'bg-violet-600/10 text-violet-300 border border-violet-500/25'
                  : 'text-slate-300 hover:bg-white/5 border border-transparent'
              }`}
            >
              <span>Settings</span>
            </button>
          </div>

          <div className="border-t border-white/5 pt-4 flex items-center justify-between">
            <div 
              className="flex items-center space-x-3 cursor-pointer"
              onClick={() => {
                onNavigate('profile');
                setIsMobileMenuOpen(false);
              }}
            >
              <img
                src={profile?.photoURL || user.photoURL || 'https://images.unsplash.com/photo-1529665253569-6d01c0eaf7b6?w=100&h=100&fit=crop'}
                alt={profile?.displayName || ''}
                className="w-10 h-10 rounded-full object-cover border border-white/10 ring-2 ring-violet-500/20"
              />
              <div className="text-left leading-none">
                <p className="text-sm font-semibold text-slate-200">
                  {profile?.displayName || user.displayName}
                </p>
                <p className="text-[10px] text-amber-400 font-mono font-semibold mt-1">
                  {profile?.rating || 1200} Elo
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                logout();
                setIsMobileMenuOpen(false);
              }}
              className="flex items-center space-x-1.5 bg-red-500/10 hover:bg-red-500/25 text-red-400 border border-red-500/10 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </nav>
  );
};
