import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Navbar } from './components/Navbar';
import { PlayModal } from './components/PlayModal';
import { Matchmaking } from './components/Matchmaking';
import { ChessGame } from './components/ChessGame';
import { LedgerHistory } from './components/LedgerHistory';
import { Leaderboard } from './components/Leaderboard';
import { ProfileView } from './components/ProfileView';
import { SocialView } from './components/SocialView';
import { SettingsView } from './components/SettingsView';
import { AddFundsModal } from './components/AddFundsModal';
import { ProfilePopup } from './components/ProfilePopup';
import type { GameMode, Match, UserProfile } from './types';
import { collection, query, where, getDoc, getDocs, orderBy, limit, onSnapshot, doc, setDoc, addDoc } from 'firebase/firestore';
import { db } from './firebase';
import { formatCoins, formatActiveCount } from './utils/format';
import { getBestAchievement } from './utils/achievements';
import { Edit2, X, Lock, Calendar, UserPlus, Check, Plus } from 'lucide-react';
import './utils/sound';
import { applyLazyHourlyRewardTx } from './wallet/walletService';
import { createPracticeMatch } from './game/gameService';


const AppContent: React.FC = () => {
  const { user, profile, login, loading } = useAuth();
  const [view, setView] = useState<'dashboard' | 'ledger' | 'game' | 'leaderboard' | 'profile' | 'social' | 'settings'>('dashboard');
  
  // Play modal state
  const [isPlayModalOpen, setIsPlayModalOpen] = useState(false);
  
  // Matchmaking state
  const [matchmakingConfig, setMatchmakingConfig] = useState<{ mode: GameMode; stake: number } | null>(null);
  
  // Game state
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);

  // Friendly Challenge States
  const [acceptedChallenge, setAcceptedChallenge] = useState<any | null>(null);
  const [acceptedChallengerProfile, setAcceptedChallengerProfile] = useState<any | null>(null);
  
  // User matches history state (active or past games)
  const [recentMatches, setRecentMatches] = useState<Match[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);

  // Add Funds modal state
  const [isAddFundsOpen, setIsAddFundsOpen] = useState(false);

  // Hourly reward countdown state
  const [hourlyRewardTimer, setHourlyRewardTimer] = useState<string>('00:00');

  // Real-time online players count state
  const [onlineCount, setOnlineCount] = useState<number>(1);

  // Opponent profiles cache for recent matches
  const [opponentProfiles, setOpponentProfiles] = useState<Record<string, UserProfile>>({});
  // Track sent friend requests to opponents (key: opponentUid, value: 'sent' | 'friend')
  const [opponentFriendStatus, setOpponentFriendStatus] = useState<Record<string, 'sending' | 'sent' | 'friend'>>({});

  // Username edit modal states
  const [isEditNameOpen, setIsEditNameOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<UserProfile | null>(null);

  const handleSaveUsername = async () => {
    if (!user || !profile) return;
    const trimmed = newName.trim();
    if (trimmed === '') {
      setNameError('Username cannot be empty');
      return;
    }
    if (trimmed.length < 3 || trimmed.length > 20) {
      setNameError('Username must be between 3 and 20 characters');
      return;
    }
    
    // Alphanumeric validation (only English letters and numbers, strictly no symbols)
    const alphanumericRegex = /^[a-zA-Z0-9]+$/;
    if (!alphanumericRegex.test(trimmed)) {
      setNameError('Username must contain only letters and numbers (no symbols, spaces, or punctuation allowed)');
      return;
    }

    // Cooldown validation
    const lastChanged = profile?.lastUsernameChangedAt;
    const cooldownMs = 30 * 24 * 60 * 60 * 1000;
    if (lastChanged && (Date.now() - lastChanged < cooldownMs)) {
      setNameError('You can only change your username once a month.');
      return;
    }

    setIsSavingName(true);
    setNameError('');
    try {
      // Check for username uniqueness
      const q = query(collection(db, 'users'), where('displayName', '==', trimmed));
      const querySnap = await getDocs(q);
      let isDuplicate = false;
      querySnap.forEach((docSnap) => {
        if (docSnap.id !== user.uid) {
          isDuplicate = true;
        }
      });
      if (isDuplicate) {
        setNameError('The username is already taken, set something else.');
        setIsSavingName(false);
        return;
      }

      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, {
        displayName: trimmed,
        lastUsernameChangedAt: Date.now()
      }, { merge: true });
      setIsEditNameOpen(false);
    } catch (err: any) {
      setNameError(err.message || 'Failed to update username');
    } finally {
      setIsSavingName(false);
    }
  };

  // 1a. Periodically update lastActiveAt for online logged-in users to keep them active in DB
  useEffect(() => {
    if (!user) return;
    const userDocRef = doc(db, 'users', user.uid);
    const updateActiveStatus = async () => {
      try {
        await setDoc(userDocRef, { lastActiveAt: Date.now() }, { merge: true });
      } catch (err) {
        console.warn("Failed to update active status:", err);
      }
    };

    updateActiveStatus();
    const interval = setInterval(updateActiveStatus, 2 * 60 * 1000); // every 2 minutes
    return () => clearInterval(interval);
  }, [user?.uid]);

  // 1b. Real-time sliding active players query listener (active in last 5 minutes)
  useEffect(() => {
    const updateListener = () => {
      const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
      const q = query(
        collection(db, 'users'),
        where('lastActiveAt', '>=', fiveMinsAgo)
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        setOnlineCount(snapshot.size || 1);
      }, (err) => {
        console.warn("Error listening to active players:", err);
      });

      return unsubscribe;
    };

    let unsubscribe = updateListener();

    // Re-bind listener every 1 minute to move 5-min threshold forward
    const interval = setInterval(() => {
      unsubscribe();
      unsubscribe = updateListener();
    }, 60000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  // 1c. Monitor Hourly Reward countdown
  useEffect(() => {
    if (!profile || view !== 'dashboard') return;

    const baseBalance = typeof profile.bankBalance === 'number' && !isNaN(profile.bankBalance) ? profile.bankBalance : 1000;

    if (baseBalance >= 1000) {
      setHourlyRewardTimer('Limit Reached');
      return;
    }

    const lastHourlyRewardAt = typeof profile.lastHourlyRewardAt === 'number' && !isNaN(profile.lastHourlyRewardAt)
      ? profile.lastHourlyRewardAt
      : (profile.createdAt || Date.now());

    const updateTimer = () => {
      const now = Date.now();
      const hourMs = 60 * 60 * 1000;
      const elapsedMs = now - lastHourlyRewardAt;
      
      // Find out when the next hour will complete
      const elapsedHours = Math.floor(elapsedMs / hourMs);
      const nextRewardTime = lastHourlyRewardAt + (elapsedHours + 1) * hourMs;
      const remainingMs = nextRewardTime - now;

      if (remainingMs <= 0) {
        setHourlyRewardTimer('Eligible!');
        applyLazyHourlyRewardTx(profile.uid).catch(console.error);
      } else {
        const mins = Math.floor(remainingMs / 60000);
        const secs = Math.floor((remainingMs % 60000) / 1000);
        setHourlyRewardTimer(`${mins}:${secs < 10 ? '0' : ''}${secs}`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [profile, view]);

  // 1e. Real-time Friendly Challenge Accepted listener
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'challenges'),
      where('challengerUid', '==', user.uid),
      where('status', '==', 'accepted')
    );

    const unsubscribe = onSnapshot(q, async (snap) => {
      if (snap.empty) {
        setAcceptedChallenge(null);
        return;
      }
      
      const chDoc = snap.docs[0];
      const chData = { id: chDoc.id, ...chDoc.data() } as any;
      setAcceptedChallenge(chData);

      // Fetch profile details of challenged friend
      try {
        const friendSnap = await getDoc(doc(db, 'users', chData.challengedUid));
        if (friendSnap.exists()) {
          setAcceptedChallengerProfile({ uid: friendSnap.id, ...friendSnap.data() } as UserProfile);
        }
      } catch (err) {
        console.warn("Failed to fetch challenged friend profile:", err);
      }
    });

    return () => unsubscribe();
  }, [user]);

  const handleJoinFriendlyMatch = async () => {
    if (!acceptedChallenge) return;
    try {
      await setDoc(doc(db, 'challenges', acceptedChallenge.id), { status: 'completed' }, { merge: true });
      setView('game');
      setActiveMatchId(acceptedChallenge.matchId);
      setAcceptedChallenge(null);
    } catch (err) {
      console.error("Failed to join friendly match:", err);
    }
  };

  // 2. Fetch User's matches (for resuming or match logs)
  const fetchRecentMatches = async () => {
    if (!user) return;
    setLoadingMatches(true);
    try {
      const q = query(
        collection(db, 'matches'),
        where('players', 'array-contains', user.uid),
        orderBy('createdAt', 'desc'),
        limit(5)
      );
      const querySnap = await getDocs(q);
      const matches: Match[] = [];
      querySnap.forEach((docSnap) => {
        matches.push({ id: docSnap.id, ...docSnap.data() } as Match);
      });
      setRecentMatches(matches);

      // Fetch opponent profiles for all unique opponent UIDs
      const uniqueOpponentUids = [...new Set(matches.map((m) =>
        m.whiteUid === user.uid ? m.blackUid : m.whiteUid
      ))];

      const profileCache: Record<string, UserProfile> = {};
      const statusCache: Record<string, 'sent' | 'friend'> = {};

      for (const oppUid of uniqueOpponentUids) {
        if (oppUid.startsWith('bot_')) {
          const elo = parseInt(oppUid.split('_')[1]) || 800;
          profileCache[oppUid] = {
            uid: oppUid,
            displayName: `Chess Bot (${elo})`,
            photoURL: '/game_modes/practice.png',
            rating: elo,
            bankBalance: 0,
            createdAt: Date.now(),
            lastActiveAt: Date.now(),
            zeroBalanceAt: null,
            lastInterestAppliedAt: Date.now()
          };
          continue;
        }

        // Fetch profile
        try {
          const uSnap = await getDoc(doc(db, 'users', oppUid));
          if (uSnap.exists()) {
            profileCache[oppUid] = { uid: uSnap.id, ...uSnap.data() } as UserProfile;
          }
        } catch (err) {
          console.warn("Failed to fetch opponent profile:", err);
        }

        // Check friendship status
        const fSnap1 = await getDocs(query(
          collection(db, 'friendships'),
          where('requesterUid', '==', user.uid),
          where('receiverUid', '==', oppUid)
        ));
        const fSnap2 = await getDocs(query(
          collection(db, 'friendships'),
          where('requesterUid', '==', oppUid),
          where('receiverUid', '==', user.uid)
        ));

        if (!fSnap1.empty || !fSnap2.empty) {
          const anyDoc = (fSnap1.docs[0] || fSnap2.docs[0]).data();
          statusCache[oppUid] = anyDoc.status === 'accepted' ? 'friend' : 'sent';
        }
      }

      setOpponentProfiles((prev) => ({ ...prev, ...profileCache }));
      setOpponentFriendStatus((prev) => ({ ...prev, ...statusCache }));
    } catch (e) {
      console.warn('Error fetching recent matches:', e);
    } finally {
      setLoadingMatches(false);
    }
  };

  // Send a friend request to a recently played opponent
  const handleSendOpponentFriendRequest = async (oppUid: string) => {
    if (!user) return;
    setOpponentFriendStatus((prev) => ({ ...prev, [oppUid]: 'sending' }));
    try {
      await addDoc(collection(db, 'friendships'), {
        requesterUid: user.uid,
        receiverUid: oppUid,
        status: 'pending',
        createdAt: Date.now()
      });
      setOpponentFriendStatus((prev) => ({ ...prev, [oppUid]: 'sent' }));
    } catch (e) {
      console.warn('Failed to send friend request to opponent:', e);
      setOpponentFriendStatus((prev) => {
        const next = { ...prev };
        delete next[oppUid];
        return next;
      });
    }
  };

  useEffect(() => {
    if (user && view === 'dashboard') {
      fetchRecentMatches();
    }
  }, [user, view]);


  // Handle Match Pairing success
  const handleMatchFound = (matchId: string) => {
    setMatchmakingConfig(null);
    setActiveMatchId(matchId);
    setView('game');
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen space-y-4 bg-transparent text-[#e2e8f0]">
        <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500 font-medium font-mono animate-pulse">"Take, Take, Take..."</p>
      </div>
    );
  }
  // Not Authenticated Landing Page
  if (!user) {
    return (
      <div className="min-h-screen bg-transparent flex flex-col relative overflow-hidden">
        {/* Ambient Floating Chess Pieces */}
        <img 
          src="https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg" 
          alt="" 
          className="absolute top-[15%] left-[5%] w-24 h-24 opacity-[0.03] filter invert pointer-events-none animate-float-1" 
        />
        <img 
          src="https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg" 
          alt="" 
          className="absolute bottom-[20%] left-[8%] w-28 h-28 opacity-[0.02] filter invert pointer-events-none animate-drift" 
        />
        <img 
          src="https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg" 
          alt="" 
          className="absolute top-[25%] right-[10%] w-32 h-32 opacity-[0.03] filter invert pointer-events-none animate-float-2" 
        />
        <img 
          src="https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg" 
          alt="" 
          className="absolute bottom-[10%] right-[30%] w-20 h-20 opacity-[0.02] filter invert pointer-events-none animate-float-1" 
        />

        {/* Glow Effects */}
        <div className="absolute top-1/2 left-1/2 divine-glow w-[600px] h-[600px] rounded-full pointer-events-none z-0" />

        <Navbar onNavigate={() => {}} currentView="" />

        <main className="flex-grow flex items-center justify-center px-6 py-12 relative z-10">
          <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            
            {/* Left Column: Pitch & Details */}
            <div className="lg:col-span-7 text-left space-y-6">
              <div className="inline-flex items-center space-x-2.5 bg-violet-500/10 border border-violet-500/20 px-3.5 py-1.5 rounded-full text-xs font-semibold text-violet-400 uppercase tracking-widest">
                <img src="https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg" alt="Queen" className="w-4.5 h-4.5 filter invert brightness-125 animate-pulse" />
                <span>High-Voltage Chess-Coin Clashes ⚡</span>
              </div>
              
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white leading-none">
                Check & Mate: <br />
                <span className="bg-gradient-to-r from-violet-400 via-violet-500 to-indigo-400 bg-clip-text text-transparent">
                  High-Stakes Chess Lounge
                </span>
              </h1>
              <p className="text-base text-slate-400 font-light leading-relaxed">
                Step into the ultimate chess arena! Stake your chess-coins, outsmart rivals in real-time matches, and seize the entire prize pool. Watch your balance grow continuously with hourly coin credits, represent your country globally, and dominate the global rankings!
              </p>

              {/* Bullet points explaining the Chess Coin Stakes */}
              <div className="space-y-4 border-y border-white/5 py-6 my-2">
                <div className="flex items-start space-x-3.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mt-0.5 overflow-hidden p-0.5 shadow-md">
                    <img src="/coin_pack/100 coins.png" alt="Coin" className="w-5 h-5 object-contain" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200">Play Chess, Earn Coins</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Stalk the queues with 100+ coins in Rapid (10m) or Bullet (5m) games. The winner takes the entire prize pool.</p>
                  </div>
                </div>

                <div className="flex items-start space-x-3.5">
                  <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mt-0.5 overflow-hidden p-0.5 shadow-md">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg" alt="Rook" className="w-5 h-5 filter invert drop-shadow-[0_0_2px_rgba(139,92,246,0.5)] brightness-125" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200">Dynamic Elo Matchmaking</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Paired by rating band (±100 Elo). The band automatically widens every 10 seconds to keep queues fast.</p>
                  </div>
                </div>

                <div className="flex items-start space-x-3.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mt-0.5 overflow-hidden p-0.5 shadow-md">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg" alt="King" className="w-5 h-5 filter invert drop-shadow-[0_0_2px_rgba(99,102,241,0.5)] brightness-125" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-200">Hourly Coin Credits & Growth</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Receive 100 coins credited to your wallet balance automatically for every hour active, up to a maximum limit of 1000 coins.</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center pt-2">
                <button
                  onClick={login}
                  className="w-full sm:w-auto flex items-center justify-center space-x-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white px-8 py-4 rounded-xl font-semibold shadow-xl shadow-violet-600/25 hover:shadow-violet-600/35 transition-all text-base border border-violet-500/25 cursor-pointer"
                >
                  <img src="https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg" alt="Knight" className="w-6 h-6 filter invert brightness-125" />
                  <span>Play Chess Now (Get 1,000 Coins)</span>
                </button>
              </div>
            </div>

            {/* Right Column: High-quality Chess King Graphic */}
            <div className="lg:col-span-5 flex flex-col items-center">
              <div className="relative group">
                {/* Floating neon background glow */}
                <div className="absolute inset-0 bg-violet-600/15 rounded-2xl blur-2xl group-hover:bg-violet-600/20 transition-all duration-300" />
                
                <div className="glass-card rounded-2xl overflow-hidden border border-white/10 p-3 relative z-10 transition-transform duration-300 group-hover:scale-[1.02]">
                  <img
                    src="/chess_king_neon.png"
                    alt="Premium Chess King"
                    className="w-full h-auto rounded-xl shadow-2xl object-cover aspect-square"
                  />
                  
                  {/* Floating Active Players tag overlay - bottom right */}
                  <div className="absolute bottom-6 right-6 glass px-3.5 py-2 rounded-xl border border-white/10 backdrop-blur-md flex items-center space-x-2.5 shadow-xl z-20">
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span className="text-xs font-semibold text-slate-200">
                      Active Players: <span className="text-emerald-400 font-mono font-bold">{onlineCount}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </main>
      </div>
    );
  }

  // Router for Authenticated Application Views
  return (
    <div className="min-h-screen bg-transparent flex flex-col">
      <Navbar
        onNavigate={(v) => {
          setView(v);
          setActiveMatchId(null);
        }}
        currentView={view}
        isGameActive={view === 'game'}
        onAddFunds={() => setIsAddFundsOpen(true)}
      />

      <main className="flex-grow">
        {view === 'ledger' && (
          <LedgerHistory onBack={() => setView('dashboard')} />
        )}

        {view === 'leaderboard' && (
          <Leaderboard onBack={() => setView('dashboard')} />
        )}

        {view === 'profile' && (
          <ProfileView onBack={() => setView('dashboard')} />
        )}

        {view === 'settings' && (
          <SettingsView onBack={() => setView('dashboard')} />
        )}

        {view === 'social' && (
          <SocialView
            onBack={() => setView('dashboard')}
            onStartGame={(matchId) => {
              setView('game');
              setActiveMatchId(matchId);
            }}
          />
        )}

        {view === 'game' && activeMatchId && (
          <ChessGame
            matchId={activeMatchId}
            onExit={() => {
              setView('dashboard');
              setActiveMatchId(null);
            }}
          />
        )}

        {view === 'dashboard' && (
          <div className="max-w-6xl mx-auto px-6 py-10 space-y-8 text-left">
            {/* Greeting */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-3xl font-extrabold tracking-wide text-white flex flex-wrap items-center gap-3">
                  <span>Welcome back, {profile?.displayName || user.displayName}!</span>
                  {profile && profile.rating >= 2500 && (
                    <span className="font-serif font-extrabold tracking-wider bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-500 bg-clip-text text-transparent drop-shadow-[0_0_8px_rgba(251,191,36,0.8)] border border-amber-400/60 bg-amber-950/40 px-2.5 py-0.5 rounded-lg text-xs font-bold select-none" title="Grandmaster (Rating 2500+)">
                      GM
                    </span>
                  )}
                  {(() => {
                    const bestAch = getBestAchievement(profile?.gameplayCounts);
                    if (bestAch) {
                      return (
                        <span className={`px-2.5 py-0.5 rounded-lg text-xs font-bold border ${bestAch.color.split(' ')[0]} ${bestAch.color.split(' ')[1]} ${bestAch.color.split(' ')[2]}`} title={bestAch.description}>
                          {bestAch.name}
                        </span>
                      );
                    }
                    return null;
                  })()}
                  <button
                    onClick={() => {
                      setNewName(profile?.displayName || user.displayName || '');
                      setNameError('');
                      setIsEditNameOpen(true);
                    }}
                    className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-all border border-white/5 cursor-pointer"
                    title="Change Username"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  Your profiles, wallets, and games are fully synced and secure.
                </p>
              </div>

              {/* Live Active Players Counter */}
              <div className="flex items-center space-x-2.5 bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5 rounded-xl self-start sm:self-auto shadow-md">
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-semibold text-slate-200">
                  Active Players: <span className="text-emerald-400 font-mono font-bold">{formatActiveCount(onlineCount)}</span>
                </span>
              </div>
            </div>

            {/* Dashboard Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Elo card */}
              <div className="glass p-6 rounded-xl border border-white/5 flex flex-col justify-between items-center text-center space-y-4">
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Chess Rating</span>
                  {/* Wikimedia Chess Rook SVG */}
                  <img src="https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg" alt="Rook" className="w-6 h-6 filter invert drop-shadow-[0_0_2px_rgba(139,92,246,0.5)] brightness-125" />
                </div>
                <div className="flex flex-col items-center justify-center py-2">
                  <h3 className="text-4xl font-black font-mono text-violet-300">
                    {profile ? profile.rating : '0'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Standard Elo Rank Band
                  </p>
                </div>
                <div className="h-2 w-full" />
              </div>

              {/* Combined Wallet & Balance Card */}
              <div className="glass p-6 rounded-xl border border-white/5 md:col-span-2 flex flex-col justify-between space-y-4">
                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Wallet & Rewards</span>
                  <div className="flex items-center space-x-2">
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span className="text-[10px] text-emerald-400 font-medium font-mono">Hourly +100 Active</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-start">
                  {/* Bank Balance Column */}
                  <div className="space-y-3">
                    <div className="flex items-center space-x-2 text-slate-400">
                      <img src="/coin_pack/100 coins.png" alt="Coin" className="w-5 h-5 object-contain" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Balance</span>
                    </div>
                    <div className="space-y-3">
                      <h3 className="text-2xl sm:text-3xl md:text-4xl font-black font-mono text-amber-400 tracking-tight whitespace-nowrap truncate" title={profile ? profile.bankBalance.toLocaleString() : '1,000'}>
                        {profile ? profile.bankBalance.toLocaleString() : '1,000'}
                      </h3>
                      <p className="text-xs text-slate-500">
                        Available Play Stakes (Coins)
                      </p>
                      
                      <button
                        onClick={() => setIsAddFundsOpen(true)}
                        className="flex items-center space-x-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 px-3 py-1.5 rounded-xl font-bold shadow-lg shadow-amber-500/10 transition-all border border-amber-400/20 cursor-pointer text-xs"
                      >
                        <Plus className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />
                        <span>Add Funds</span>
                      </button>
                    </div>
                  </div>

                  {/* Hourly Reward countdown Column */}
                  <div className="space-y-2 border-t sm:border-t-0 sm:border-l border-white/5 pt-4 sm:pt-0 sm:pl-6">
                    <div className="flex items-center space-x-2 text-slate-400">
                      <img src="https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg" alt="King" className="w-5 h-5 filter invert drop-shadow-[0_0_2px_rgba(16,185,129,0.5)] brightness-125" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Hourly Reward</span>
                    </div>

                    {profile && profile.bankBalance >= 1000 ? (
                      <div className="bg-slate-950/40 border border-white/5 rounded-xl p-3 space-y-1.5">
                        <p className="text-xs font-semibold text-slate-400">
                          Balance limit reached (1,000+ Coins)
                        </p>
                        <p className="text-[10px] text-slate-500 leading-relaxed">
                          Hourly reward is paused. Spend your coins on game entries or challenges to resume earning free coins!
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs text-slate-400">Next Credit:</span>
                          <span className="font-mono text-emerald-400 text-lg font-bold">
                            {hourlyRewardTimer}
                          </span>
                        </div>
                        
                        <div className="space-y-1">
                          <div className="w-full bg-slate-950/80 rounded-full h-2 overflow-hidden border border-white/5">
                            {(() => {
                              const lastReward = profile?.lastHourlyRewardAt || profile?.createdAt || Date.now();
                              const elapsed = Date.now() - lastReward;
                              const pct = Math.min(100, Math.max(0, ((elapsed % (60 * 60 * 1000)) / (60 * 60 * 1000)) * 100));
                              return (
                                <div
                                  className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-1000"
                                  style={{ width: `${pct}%` }}
                                />
                              );
                            })()}
                          </div>
                          <div className="flex justify-between text-[9px] text-slate-500">
                            <span>0m</span>
                            <span>+100 Coins</span>
                            <span>60m</span>
                          </div>
                        </div>

                        <p className="text-[10px] text-slate-500">
                          Earn 100 coins every hour while balance is below 1,000 coins.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>

            {/* CTA Play Actions */}
            <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-900/30 border border-white/5 p-6 rounded-xl justify-between">
              <div>
                <h4 className="text-base font-bold text-slate-200">Ready for a Match?</h4>
                <p className="text-xs text-slate-400 font-light mt-0.5">Pick your entry fee, challenge players in your Elo bracket, and win the prize pool.</p>
              </div>

              <button
                onClick={() => setIsPlayModalOpen(true)}
                className="w-full sm:w-auto flex items-center justify-center space-x-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white px-6 py-3.5 rounded-xl font-semibold transition-all cursor-pointer play-btn-glow border border-violet-500/25"
              >
                {/* Wikimedia Chess Knight SVG */}
                <img src="https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg" alt="Knight" className="w-5 h-5 filter invert brightness-125" />
                <span>Play Now</span>
              </button>
            </div>

            {/* Active & Recent Matches resumes */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-200 flex items-center space-x-2.5">
                <img src="https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg" alt="Queen" className="w-5 h-5 filter invert brightness-125" />
                <span>Recent & Active Matches</span>
              </h3>

              {loadingMatches ? (
                <div className="py-10 text-center text-xs text-slate-500">
                  Scanning active game rooms...
                </div>
              ) : recentMatches.length === 0 ? (
                <div className="glass p-8 rounded-xl text-center border border-white/5 text-slate-500 text-xs italic">
                  No match history found. Click "Play Now" to start your first game!
                </div>
              ) : (
              <div className="glass rounded-xl border border-white/5 divide-y divide-white/5 overflow-hidden">
                {recentMatches.map((m) => {
                  const isMWhite = m.whiteUid === user.uid;
                  const oppUid = isMWhite ? m.blackUid : m.whiteUid;
                  const isActive = m.status === 'active';
                  const oppProfile = opponentProfiles[oppUid];
                  const friendStatus = opponentFriendStatus[oppUid];

                  const resultLabel = isActive ? null
                    : m.winnerUid === user.uid ? 'WON'
                    : m.winnerUid ? 'LOST'
                    : 'DRAW';

                  const resultColor = isActive ? ''
                    : m.winnerUid === user.uid ? 'text-emerald-400'
                    : m.winnerUid ? 'text-red-400'
                    : 'text-slate-500';

                  return (
                    <div
                      key={m.id}
                      className={`flex items-center justify-between px-4 py-3 gap-3 ${
                        isActive ? 'bg-violet-950/10' : 'hover:bg-white/[0.02]'
                      } transition-colors`}
                    >
                      {/* Left: Status badge + opponent */}
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          isActive ? 'bg-violet-500/20 text-violet-300' : 'bg-slate-800 text-slate-500'
                        }`}>
                          {isActive ? 'LIVE' : m.status}
                        </span>

                        {oppProfile?.photoURL && (
                          <img 
                            src={oppProfile.photoURL} 
                            alt={oppProfile.displayName} 
                            className="w-6 h-6 rounded-full object-cover border border-white/10 shrink-0 cursor-pointer hover:opacity-85 transition-opacity" 
                            title="View Profile"
                            onClick={() => setSelectedProfile(oppProfile)}
                          />
                        )}

                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-200 truncate">
                            vs {oppProfile?.displayName || `${oppUid.substring(0, 8)}…`}
                          </p>
                          <p className="text-[10px] text-slate-500 capitalize truncate">
                            {m.mode.replace(/_/g, ' ')} &bull; {
                              m.mode === 'all_in' && m.allInStakes && user
                                ? formatCoins(m.allInStakes[user.uid] || 0)
                                : formatCoins(m.stake)
                            }
                            {oppProfile && <span className="ml-1">· {oppProfile.rating} Elo</span>}
                          </p>
                        </div>
                      </div>

                      {/* Right: friend action + result or resume */}
                      <div className="flex items-center gap-2 shrink-0">
                        {friendStatus === 'friend' ? (
                          <span className="hidden sm:flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
                            <Check className="w-3 h-3" /> Friends
                          </span>
                        ) : friendStatus === 'sent' || friendStatus === 'sending' ? (
                          <span className="hidden sm:block text-[10px] text-slate-400 font-medium animate-pulse">
                            {friendStatus === 'sending' ? 'Sending…' : 'Sent'}
                          </span>
                        ) : oppProfile ? (
                          <button
                            onClick={() => handleSendOpponentFriendRequest(oppUid)}
                            className="hidden sm:flex items-center gap-1 text-[10px] font-semibold text-violet-400 hover:text-white bg-violet-600/10 hover:bg-violet-600 border border-violet-500/20 px-2 py-0.5 rounded transition-all cursor-pointer"
                          >
                            <UserPlus className="w-3 h-3" />
                            Add
                          </button>
                        ) : null}

                        {isActive ? (
                          <button
                            onClick={() => handleMatchFound(m.id)}
                            className="bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow transition-all cursor-pointer"
                          >
                            Resume
                          </button>
                        ) : (
                          <span className={`text-xs font-bold ${resultColor}`}>
                            {resultLabel}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
            </div>


          </div>
        )}
      </main>

      {/* Modals & Queue Components */}
        <PlayModal
          isOpen={isPlayModalOpen}
          onClose={() => setIsPlayModalOpen(false)}
          onStartSearch={async (mode, stake, _timeControl, practiceConfig) => {
            if (mode === 'practice' && practiceConfig && user) {
              try {
                const mId = await createPracticeMatch(user.uid, practiceConfig.elo, practiceConfig.color);
                handleMatchFound(mId);
              } catch (err) {
                console.error("Failed to start practice match:", err);
              }
            } else {
              setMatchmakingConfig({ mode, stake });
            }
          }}
        />

      <AddFundsModal
        isOpen={isAddFundsOpen}
        onClose={() => setIsAddFundsOpen(false)}
      />

      {matchmakingConfig && (
        <Matchmaking
          mode={matchmakingConfig.mode}
          stake={matchmakingConfig.stake}
          onMatchFound={handleMatchFound}
          onCancel={() => setMatchmakingConfig(null)}
        />
      )}

      {/* Modify Username Settings Modal */}
      {isEditNameOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="glass max-w-md w-full rounded-2xl border border-white/10 p-6 shadow-2xl relative space-y-6 text-left">
            <button
              onClick={() => setIsEditNameOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-2">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-violet-400" />
                <span>Modify Username</span>
              </h3>
              <p className="text-xs text-slate-400">
                Pick a unique display name for Check & Mate. You can only edit your username once every 30 days.
              </p>
            </div>

            {(() => {
              const lastChanged = profile?.lastUsernameChangedAt;
              const cooldownMs = 30 * 24 * 60 * 60 * 1000;
              const hasCooldown = lastChanged && (Date.now() - lastChanged < cooldownMs);
              const nextChangeDate = lastChanged ? new Date(lastChanged + cooldownMs) : null;

              if (hasCooldown && nextChangeDate) {
                return (
                  <div className="bg-amber-950/20 border border-amber-500/10 rounded-xl p-4 space-y-3">
                    <div className="flex items-center space-x-2 text-amber-400 font-semibold text-xs">
                      <Lock className="w-4 h-4 animate-pulse" />
                      <span>Username Change Locked</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      You changed your username recently. The system limits updates to once every 30 days to prevent profile abuse.
                    </p>
                    <div className="flex items-center space-x-2 text-[10px] text-slate-500">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Available on: <strong className="text-slate-400">{nextChangeDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong></span>
                    </div>
                    <button
                      onClick={() => setIsEditNameOpen(false)}
                      className="w-full mt-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2.5 rounded-lg transition-all cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                );
              }

              return (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      New Username
                    </label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => {
                        setNewName(e.target.value);
                        setNameError('');
                      }}
                      placeholder="Enter new username"
                      className="w-full bg-slate-950/60 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-violet-500 transition-colors"
                      maxLength={20}
                    />
                    {nameError && (
                      <p className="text-xs text-red-400 font-medium">{nameError}</p>
                    )}
                  </div>

                  <div className="flex items-center space-x-3 pt-2">
                    <button
                      onClick={() => setIsEditNameOpen(false)}
                      className="flex-1 bg-slate-900/60 hover:bg-slate-800/60 text-slate-300 border border-white/5 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveUsername}
                      disabled={isSavingName}
                      className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white py-2.5 rounded-lg text-xs font-semibold shadow-lg shadow-violet-600/10 transition-all border border-violet-500/20 disabled:opacity-50 cursor-pointer"
                    >
                      {isSavingName ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Real-time Challenge Accepted Popup */}
      {acceptedChallenge && acceptedChallengerProfile && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 animate-bounce">
          <div className="glass p-5 rounded-xl border border-violet-500/40 shadow-2xl flex items-center justify-between gap-6 max-w-lg bg-slate-950/90 backdrop-blur-xl">
            <div className="text-left space-y-1">
              <div className="flex items-center space-x-1.5">
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <span className="text-sm font-semibold text-slate-200">Challenge Accepted! ⚔️</span>
              </div>
              <p className="text-xs text-slate-400">
                <strong className="text-violet-300">{acceptedChallengerProfile.displayName}</strong> has accepted your challenge request for <strong>{acceptedChallenge.mode.replace('_', ' ')}</strong>.
              </p>
            </div>
            <div className="flex items-center space-x-2.5">
              <button
                onClick={handleJoinFriendlyMatch}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-lg shadow-emerald-500/20 transition-all border border-emerald-500/20 cursor-pointer"
              >
                Join Match
              </button>
              <button
                onClick={async () => {
                  try {
                    await setDoc(doc(db, 'challenges', acceptedChallenge.id), { status: 'completed' }, { merge: true });
                    setAcceptedChallenge(null);
                  } catch (e) {}
                }}
                className="text-slate-500 hover:text-slate-300 p-1.5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedProfile && (
        <ProfilePopup 
          profile={selectedProfile} 
          onClose={() => setSelectedProfile(null)} 
        />
      )}
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default App;
