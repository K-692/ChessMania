import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Navbar } from './components/Navbar';
import { SocialView, FriendChatModal } from './components/SocialView';
import { SettingsView } from './components/SettingsView';
import { ProfileView } from './components/ProfileView';
import { RollmateGame } from './components/RollmateGame';
import type { UserProfile } from './types';
import { collection, query, where, getDocs, getDoc, doc, onSnapshot } from 'firebase/firestore';
import { ref as rRef, onValue, update as rUpdate } from 'firebase/database';
import { db, rtdb } from './firebase';
import { Swords, Users, X, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { getSoundSettings, updateSoundSettings } from './utils/sound';
import { NetworkSignal } from './components/NetworkSignal';

const AppContent: React.FC = () => {
  const { user, profile, loading, login } = useAuth();
  const [isMuted, setIsMuted] = useState(() => getSoundSettings().muted);
  
  // Navigation states
  const [view, setView] = useState<'dashboard' | 'social' | 'profile' | 'settings' | 'game'>('dashboard');
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    updateSoundSettings({ muted: nextMuted });
  };

  // Chat/Notifications states
  const [openChatFriend, setOpenChatFriend] = useState<UserProfile | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [friendsUids, setFriendsUids] = useState<string[]>([]);
  
  // Rollmate Friend Challenge Popup State
  const [isChallengePopupOpen, setIsChallengePopupOpen] = useState(false);
  const [onlineFriends, setOnlineFriends] = useState<UserProfile[]>([]);
  const [onlineStatuses, setOnlineStatuses] = useState<Record<string, any>>({});
  const [challengeSuccessMsg, setChallengeSuccessMsg] = useState('');

  // 1. Monitor Friend list for chat subscriptions
  useEffect(() => {
    if (!user) {
      setFriendsUids([]);
      return;
    }
    const q = collection(db, 'users', user.uid, 'friends');
    const unsubscribe = onSnapshot(q, (snap) => {
      const uids: string[] = [];
      snap.forEach((docSnap) => {
        if (docSnap.data().status === 'accepted') {
          uids.push(docSnap.id);
        }
      });
      setFriendsUids(uids);
    });
    return () => unsubscribe();
  }, [user]);

  // 2. Fetch online status references from RTDB
  useEffect(() => {
    const statusRef = rRef(rtdb, 'status');
    const unsubscribe = onValue(statusRef, (snapshot) => {
      if (snapshot.exists()) {
        setOnlineStatuses(snapshot.val());
      } else {
        setOnlineStatuses({});
      }
    });
    return () => unsubscribe();
  }, []);

  // 3. Keep Unread Messages counts updated
  useEffect(() => {
    if (!user || friendsUids.length === 0) {
      setUnreadCounts({});
      return;
    }

    const unsubscribers: (() => void)[] = [];
    friendsUids.forEach((friendUid) => {
      const threadId = [user.uid, friendUid].sort().join('_');
      const q = query(
        collection(db, 'users', user.uid, 'chatThreads', threadId, 'messages'),
        where('senderUid', '==', friendUid),
        where('read', '==', false)
      );

      const unsub = onSnapshot(q, (snap) => {
        setUnreadCounts((prev) => ({
          ...prev,
          [friendUid]: snap.size
        }));
      });
      unsubscribers.push(unsub);
    });

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [user, friendsUids]);

  // 4. Listen to accepted challenges in RTDB for automatic game launch
  useEffect(() => {
    if (!user) return;

    const userChallengesRef = rRef(rtdb, `user_challenges/${user.uid}`);
    const unsubscribe = onValue(userChallengesRef, (snap) => {
      if (!snap.exists()) return;
      const challenges = snap.val();
      for (const cid in challenges) {
        const ch = challenges[cid];
        if (ch.status === 'accepted' && ch.matchId) {
          setActiveMatchId(ch.matchId);
          setView('game');
        }
      }
    });

    return () => unsubscribe();
  }, [user]);

  // 5. Gather online friends list for the Challenge Modal
  useEffect(() => {
    if (!isChallengePopupOpen || !user) return;
    const fetchFriends = async () => {
      try {
        const q = query(
          collection(db, 'users', user.uid, 'friends'),
          where('status', '==', 'accepted')
        );
        const snap = await getDocs(q);
        const list: UserProfile[] = [];
        
        for (const docSnap of snap.docs) {
          const friendUid = docSnap.id;
          const status = onlineStatuses[friendUid];
          const isOnline = status?.state === 'online';
          
          if (isOnline) {
            const uSnap = await getDoc(doc(db, 'users', friendUid));
            if (uSnap.exists()) {
              list.push({ uid: friendUid, ...uSnap.data() } as UserProfile);
            }
          }
        }
        setOnlineFriends(list);
      } catch (err) {
        console.warn("Failed to fetch online friends:", err);
      }
    };
    fetchFriends();
  }, [isChallengePopupOpen, user, onlineStatuses]);

  // Send a Rollmate Challenge to a selected online friend
  const handleChallengeFriend = async (friendUid: string, displayName: string) => {
    if (!user) return;
    try {
      const challengeId = 'challenge_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
      const challengeObj = {
        challengeId,
        challengerUid: user.uid,
        challengedUid: friendUid,
        mode: 'Rollmate',
        status: 'pending',
        matchId: null,
        createdAt: Date.now()
      };

      const updates: Record<string, any> = {};
      updates[`challenges/${challengeId}`] = challengeObj;
      updates[`user_challenges/${user.uid}/${challengeId}`] = challengeObj;
      updates[`user_challenges/${friendUid}/${challengeId}`] = challengeObj;

      await rUpdate(rRef(rtdb), updates);
      setChallengeSuccessMsg(`Rollmate challenge invite sent to ${displayName}!`);
      setTimeout(() => {
        setChallengeSuccessMsg('');
        setIsChallengePopupOpen(false);
      }, 2000);
    } catch (e) {
      console.error("Failed to challenge friend:", e);
    }
  };

  // Dynamic background image selection based on active tab/view
  useEffect(() => {
    if (user && view === 'profile') {
      document.body.style.backgroundImage = "linear-gradient(to bottom, rgba(13, 14, 18, 0.85) 0%, rgba(13, 14, 18, 0.95) 100%), url('/chess_king_neon.png')";
    } else {
      document.body.style.backgroundImage = "linear-gradient(to bottom, rgba(13, 14, 18, 0.85) 0%, rgba(13, 14, 18, 0.95) 100%), url('/chess_cinematic_bg.png')";
    }
  }, [user, view]);

  // Loading indicator for authentication
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0e0f12] text-[#f1f5f9]">
        <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        <p className="mt-3 text-xs text-slate-500 font-mono animate-pulse">Initializing ChessMania...</p>
      </div>
    );
  }

  // Not Authenticated: Landing Page
  if (!user) {
    return (
      <div className="min-h-screen bg-[#0d0e12] flex flex-col justify-between text-[#f1f5f9] select-none">
        <header className="px-6 py-5 border-b border-zinc-850 bg-zinc-950">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <img src="/game_logo.png" alt="ChessMania Logo" className="w-8 h-8 rounded-lg" />
              <span className="text-base font-extrabold tracking-wider">ChessMania</span>
            </div>
            <div className="flex items-center space-x-3.5">
              <NetworkSignal />
              <button
                onClick={toggleMute}
                className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-slate-300 hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                title={isMuted ? "Unmute Music" : "Mute Music"}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 animate-pulse" />}
              </button>
            </div>
          </div>
        </header>

        <main className="flex-grow flex items-center justify-center px-6 py-12">
          <div className="max-w-xl text-center space-y-8">
            <div className="flex justify-center">
              <img src="/game_logo.png" alt="ChessMania Logo" className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl border border-zinc-800 shadow-2xl p-1 bg-zinc-950" />
            </div>

            <div className="space-y-4">
              <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight uppercase">
                ChessMania
              </h1>
              <p className="text-sm sm:text-base text-slate-400 font-medium max-w-md mx-auto leading-relaxed">
                Bored with Traditional chess game? Play the ultimate Chess Mania of all time.
              </p>
            </div>

            <div className="pt-4 flex justify-center">
              <button
                onClick={login}
                className="flex items-center space-x-3 bg-violet-600 hover:bg-violet-500 text-white font-bold px-8 py-3.5 rounded-xl transition-all shadow-lg hover:scale-105 border border-violet-500/25 cursor-pointer text-sm tracking-wide"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5 filter invert-0" />
                <span>Sign in with Google</span>
              </button>
            </div>
          </div>
        </main>

        <footer className="w-full text-center py-5 text-[10px] text-slate-600 border-t border-white/5 bg-zinc-950/20">
          <span>&copy; {new Date().getFullYear()} ChessMania. All rights reserved.</span>
        </footer>
      </div>
    );
  }

  // Calculate total unread chats
  const totalUnreadChats = Object.values(unreadCounts).reduce((sum, val) => sum + val, 0);

  // Authenticated Router
  return (
    <div className="min-h-screen bg-[#0d0e12] flex flex-col">
      <Navbar
        onNavigate={(v) => {
          setView(v);
          setActiveMatchId(null);
        }}
        currentView={view}
        isGameActive={view === 'game'}
        unreadChatsCount={totalUnreadChats}
      />

      <main className="flex-grow">
        
        {view === 'social' && (
          <SocialView
            onBack={() => setView('dashboard')}
            onStartGame={(matchId) => {
              setActiveMatchId(matchId);
              setView('game');
            }}
            setOpenChatFriend={setOpenChatFriend}
            unreadCounts={unreadCounts}
          />
        )}

        {view === 'profile' && (
          <ProfileView
            onBack={() => setView('dashboard')}
          />
        )}

        {view === 'settings' && (
          <SettingsView
            onBack={() => setView('dashboard')}
          />
        )}

        {view === 'game' && activeMatchId && (
          <RollmateGame
            matchId={activeMatchId}
            onExit={async () => {
              // Mark the match status terminated/completed locally
              setActiveMatchId(null);
              setView('dashboard');
            }}
          />
        )}

        {/* Dashboard / Home Tab */}
        {view === 'dashboard' && (
          <div className="max-w-4xl mx-auto px-4 py-12 space-y-8 text-left animate-fade-in">
            
            {/* Header Greeting */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-800 pb-5">
              <div className="space-y-1">
                <h2 className="text-2xl font-black text-white flex items-center gap-2">
                  <span>Welcome to ChessMania, {profile?.displayName}!</span>
                  <Sparkles className="w-5 h-5 text-violet-400 shrink-0" />
                </h2>
                <p className="text-xs text-slate-500 font-medium">
                  Sync status, message friends, and play friendly Rollmate chess invites.
                </p>
              </div>
              <div className="shrink-0">
                <NetworkSignal />
              </div>
            </div>

            {/* Main Dash Cards */}
            <div className="grid grid-cols-1 gap-5">

              {/* Rollmate Game Mode Card */}
              <div className="bg-zinc-900 border border-zinc-850 p-6 rounded-2xl flex flex-col justify-between space-y-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between border-b border-zinc-850 pb-2">
                    <span className="text-sm font-bold text-white uppercase tracking-wider">Game Mode</span>
                    <span className="text-[10px] text-violet-400 font-extrabold uppercase font-mono bg-violet-600/10 px-2 py-0.5 rounded border border-violet-500/10">Active</span>
                  </div>
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Swords className="w-5 h-5 text-violet-400" />
                    <span>Rollmate</span>
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed font-medium">
                    Bored with Traditional chess game? Play the ultimate Chess Mania of all time. Send a real-time battle challenge invite to any of your online friends, and join the match instantly when accepted.
                  </p>
                </div>

                <div className="flex items-center justify-end">
                  <button
                    onClick={() => {
                      setChallengeSuccessMsg('');
                      setIsChallengePopupOpen(true);
                    }}
                    className="w-full sm:w-auto flex items-center justify-center space-x-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold px-6 py-3 rounded-xl transition-all cursor-pointer border border-violet-500/25 shadow-lg shadow-violet-600/10 hover:shadow-violet-600/20 text-xs"
                  >
                    <Swords className="w-4 h-4" />
                    <span>Challenge Friend</span>
                  </button>
                </div>
              </div>

            </div>

          </div>
        )}

      </main>

      {/* Online Friends Challenge Popup Modal */}
      {isChallengePopupOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 z-50 animate-fade-in">
          <div className="bg-zinc-900 border border-zinc-850 w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl flex flex-col p-6 text-left space-y-6">
            <div className="flex items-center justify-between border-b border-zinc-850 pb-3">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Users className="w-5 h-5 text-violet-400" />
                <span>Challenge Online Friend</span>
              </h3>
              <button
                onClick={() => setIsChallengePopupOpen(false)}
                className="p-1 text-slate-500 hover:text-white cursor-pointer"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {challengeSuccessMsg && (
              <div className="bg-emerald-950/20 border border-emerald-500/10 rounded-xl p-3 flex items-center justify-center gap-2 text-xs text-emerald-400 animate-pulse">
                <span>{challengeSuccessMsg}</span>
              </div>
            )}

            <div className="max-h-[220px] overflow-y-auto pr-1 space-y-2 scrollbar-thin">
              {onlineFriends.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500 italic space-y-1.5">
                  <p>No friends are online right now.</p>
                  <p className="text-[10px] text-slate-600">Open the Friends tab to add friends or verify their status.</p>
                </div>
              ) : (
                onlineFriends.map((f) => (
                  <div key={f.uid} className="flex items-center justify-between bg-zinc-950/50 p-2.5 rounded-xl border border-zinc-850">
                    <div className="flex items-center space-x-2.5">
                      <img src={f.photoURL} alt={f.displayName} className="w-7 h-7 rounded-full object-cover border border-zinc-800" />
                      <div>
                        <span className="text-xs font-semibold text-white block">{f.displayName}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleChallengeFriend(f.uid, f.displayName)}
                      className="bg-violet-600 hover:bg-violet-500 text-white font-bold px-3 py-1.5 rounded-lg text-[10px] transition-all cursor-pointer border border-violet-500/25"
                    >
                      Invite
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-end pt-1">
              <button
                onClick={() => setIsChallengePopupOpen(false)}
                className="bg-zinc-800 hover:bg-zinc-700 text-slate-300 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer border border-zinc-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Global chat modal overlay */}
      {openChatFriend && (
        <FriendChatModal
          friend={openChatFriend}
          onClose={() => setOpenChatFriend(null)}
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
