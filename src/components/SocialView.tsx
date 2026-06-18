import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { db } from '../firebase';
import { collection, query, where, getDocs, doc, setDoc, addDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { getBestAchievement } from '../utils/achievements';
import { formatCoins } from '../utils/format';
import { acceptFriendlyChallenge } from '../game/gameService';
import { UserPlus, UserCheck, ShieldAlert, Star, Gamepad2, Send, Check, X, ShieldCheck, ChevronLeft, Swords, Bell } from 'lucide-react';
import type { UserProfile, Friendship, FriendlyChallenge, GameMode } from '../types';

interface SocialViewProps {
  onBack: () => void;
  onStartGame: (matchId: string) => void;
}

const CHALLENGE_MODES = [
  { id: 'beginner' as GameMode, label: 'Beginner', price: 100, tc: '15 min' },
  { id: 'casual_rapid' as GameMode, label: 'Casual Rapid', price: 500, tc: '10 min' },
  { id: 'standard_rapid' as GameMode, label: 'Standard Rapid', price: 2500, tc: '10 | 5' },
  { id: 'competitive_rapid' as GameMode, label: 'Competitive Rapid', price: 10000, tc: '15 | 10' },
  { id: 'classical_lite' as GameMode, label: 'Classical Lite', price: 25000, tc: '20 | 10' },
  { id: 'blitz' as GameMode, label: 'Blitz', price: 50000, tc: '5 | 3' },
  { id: 'competitive_blitz' as GameMode, label: 'Competitive Blitz', price: 100000, tc: '3 | 2' },
  { id: 'bullet' as GameMode, label: 'Bullet', price: 500000, tc: '1 | 1' },
  { id: 'arena_bullet' as GameMode, label: 'Arena Bullet', price: 1000000, tc: '1 min' },
  { id: 'championship' as GameMode, label: 'Championship', price: 5000000, tc: '30 | 20' },
  { id: 'all_in' as GameMode, label: 'All In ‼️', price: 'all_in', tc: '10 | 5' }
];

export const SocialView: React.FC<SocialViewProps> = ({ onBack, onStartGame }) => {
  const { user, profile } = useAuth();

  // Friend Request States
  const [searchUsername, setSearchUsername] = useState('');
  const [requestError, setRequestError] = useState('');
  const [requestSuccess, setRequestSuccess] = useState('');
  const [isSendingRequest, setIsSendingRequest] = useState(false);

  // Firestore Subscriptions States
  const [incomingRequests, setIncomingRequests] = useState<Friendship[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<Friendship[]>([]);
  const [friendsProfiles, setFriendsProfiles] = useState<UserProfile[]>([]);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [receivedChallenges, setReceivedChallenges] = useState<FriendlyChallenge[]>([]);
  const [sentChallenges, setSentChallenges] = useState<FriendlyChallenge[]>([]);
  const [challengerProfiles, setChallengerProfiles] = useState<Record<string, UserProfile>>({});

  // Active Challenge Modal State
  const [activeChallengeFriend, setActiveChallengeFriend] = useState<UserProfile | null>(null);
  const [challengeType, setChallengeType] = useState<'friendly' | 'arena'>('friendly');
  const [selectedModeIdx, setSelectedModeIdx] = useState(0);
  const [challengeError, setChallengeError] = useState('');
  const [isSendingChallenge, setIsSendingChallenge] = useState(false);
  const [isAcceptingChallenge, setIsAcceptingChallenge] = useState<string | null>(null);

  // Pending challenges alert expanded state
  const [challengesExpanded, setChallengesExpanded] = useState(true);

  useEffect(() => {
    if (!user) return;

    // Listen to all accepted friendships
    const qFriendships = query(
      collection(db, 'friendships'),
      where('status', '==', 'accepted')
    );

    const unsubFriendships = onSnapshot(qFriendships, async (snap) => {
      const profileIds: string[] = [];
      const list: Friendship[] = [];

      snap.forEach((docSnap) => {
        const data = { id: docSnap.id, ...docSnap.data() } as Friendship;
        if (data.requesterUid === user.uid || data.receiverUid === user.uid) {
          list.push(data);
          if (data.requesterUid === user.uid) {
            profileIds.push(data.receiverUid);
          } else {
            profileIds.push(data.requesterUid);
          }
        }
      });

      setFriendships(list);

      if (profileIds.length > 0) {
        const uProfiles: UserProfile[] = [];
        for (const fId of profileIds) {
          const uSnap = await getDocs(query(collection(db, 'users'), where('uid', '==', fId)));
          uSnap.forEach((docSnap) => {
            uProfiles.push(docSnap.data() as UserProfile);
          });
        }
        setFriendsProfiles(uProfiles);
      } else {
        setFriendsProfiles([]);
      }
    });

    // Listen to incoming requests
    const qIncoming = query(
      collection(db, 'friendships'),
      where('receiverUid', '==', user.uid),
      where('status', '==', 'pending')
    );
    const unsubIncoming = onSnapshot(qIncoming, async (snap) => {
      const list: Friendship[] = [];
      const reqProfiles: Record<string, UserProfile> = { ...challengerProfiles };

      for (const docSnap of snap.docs) {
        const data = docSnap.data() as Friendship;
        data.id = docSnap.id;
        list.push(data);

        if (!reqProfiles[data.requesterUid]) {
          const uSnap = await getDocs(query(collection(db, 'users'), where('uid', '==', data.requesterUid)));
          uSnap.forEach((uDoc) => {
            reqProfiles[data.requesterUid] = uDoc.data() as UserProfile;
          });
        }
      }
      setIncomingRequests(list);
      setChallengerProfiles(reqProfiles);
    });

    // Listen to outgoing requests
    const qOutgoing = query(
      collection(db, 'friendships'),
      where('requesterUid', '==', user.uid),
      where('status', '==', 'pending')
    );
    const unsubOutgoing = onSnapshot(qOutgoing, async (snap) => {
      const list: Friendship[] = [];
      const reqProfiles = { ...challengerProfiles };

      for (const docSnap of snap.docs) {
        const data = docSnap.data() as Friendship;
        data.id = docSnap.id;
        list.push(data);

        if (!reqProfiles[data.receiverUid]) {
          const uSnap = await getDocs(query(collection(db, 'users'), where('uid', '==', data.receiverUid)));
          uSnap.forEach((uDoc) => {
            reqProfiles[data.receiverUid] = uDoc.data() as UserProfile;
          });
        }
      }
      setOutgoingRequests(list);
      setChallengerProfiles(reqProfiles);
    });

    // Listen to received friendly challenges
    const qRecChallenges = query(
      collection(db, 'challenges'),
      where('challengedUid', '==', user.uid),
      where('status', '==', 'pending')
    );
    const unsubRecChallenges = onSnapshot(qRecChallenges, async (snap) => {
      const list: FriendlyChallenge[] = [];
      const reqProfiles = { ...challengerProfiles };

      for (const docSnap of snap.docs) {
        const data = docSnap.data() as FriendlyChallenge;
        data.id = docSnap.id;
        list.push(data);

        if (!reqProfiles[data.challengerUid]) {
          const uSnap = await getDocs(query(collection(db, 'users'), where('uid', '==', data.challengerUid)));
          uSnap.forEach((uDoc) => {
            reqProfiles[data.challengerUid] = uDoc.data() as UserProfile;
          });
        }
      }
      setReceivedChallenges(list);
      setChallengerProfiles(reqProfiles);
    });

    // Listen to sent friendly challenges
    const qSentChallenges = query(
      collection(db, 'challenges'),
      where('challengerUid', '==', user.uid),
      where('status', '==', 'pending')
    );
    const unsubSentChallenges = onSnapshot(qSentChallenges, async (snap) => {
      const list: FriendlyChallenge[] = [];
      const reqProfiles = { ...challengerProfiles };

      for (const docSnap of snap.docs) {
        const data = docSnap.data() as FriendlyChallenge;
        data.id = docSnap.id;
        list.push(data);

        if (!reqProfiles[data.challengedUid]) {
          const uSnap = await getDocs(query(collection(db, 'users'), where('uid', '==', data.challengedUid)));
          uSnap.forEach((uDoc) => {
            reqProfiles[data.challengedUid] = uDoc.data() as UserProfile;
          });
        }
      }
      setSentChallenges(list);
      setChallengerProfiles(reqProfiles);
    });

    return () => {
      unsubFriendships();
      unsubIncoming();
      unsubOutgoing();
      unsubRecChallenges();
      unsubSentChallenges();
    };
  }, [user]);

  // Add Friend Request submission
  const handleSendFriendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;
    const target = searchUsername.trim();
    if (target === '') return;

    if (target.toLowerCase() === profile.displayName.toLowerCase()) {
      setRequestError('You cannot add yourself as a friend');
      return;
    }

    setIsSendingRequest(true);
    setRequestError('');
    setRequestSuccess('');

    try {
      const qUser = query(collection(db, 'users'), where('displayName', '==', target));
      const uSnap = await getDocs(qUser);

      if (uSnap.empty) {
        setRequestError(`No user found with the username "${target}"`);
        setIsSendingRequest(false);
        return;
      }

      const targetUser = uSnap.docs[0]?.data() as UserProfile | undefined;
      if (!targetUser) {
        setRequestError(`No user found with the username "${target}"`);
        setIsSendingRequest(false);
        return;
      }

      const qExist1 = query(
        collection(db, 'friendships'),
        where('requesterUid', '==', user.uid),
        where('receiverUid', '==', targetUser.uid)
      );
      const qExist2 = query(
        collection(db, 'friendships'),
        where('requesterUid', '==', targetUser.uid),
        where('receiverUid', '==', user.uid)
      );

      const [snap1, snap2] = await Promise.all([getDocs(qExist1), getDocs(qExist2)]);
      if (!snap1.empty || !snap2.empty) {
        setRequestError('Friend request or friendship already active or pending');
        setIsSendingRequest(false);
        return;
      }

      await addDoc(collection(db, 'friendships'), {
        requesterUid: user.uid,
        receiverUid: targetUser.uid,
        status: 'pending',
        createdAt: Date.now()
      } as Friendship);

      setRequestSuccess(`Friend request sent to ${targetUser.displayName}!`);
      setSearchUsername('');
    } catch (err: any) {
      setRequestError(err.message || 'Failed to send friend request');
    } finally {
      setIsSendingRequest(false);
    }
  };

  const handleAcceptRequest = async (reqId: string) => {
    try {
      await setDoc(doc(db, 'friendships', reqId), { status: 'accepted' }, { merge: true });
    } catch (err) {
      console.error('Failed to accept request:', err);
    }
  };

  const handleDeclineRequest = async (reqId: string) => {
    try {
      await deleteDoc(doc(db, 'friendships', reqId));
    } catch (err) {
      console.error('Failed to decline request:', err);
    }
  };

  const handleSendChallenge = async () => {
    if (!user || !profile || !activeChallengeFriend) return;

    const modeConfig = CHALLENGE_MODES[selectedModeIdx];
    const stake = challengeType === 'friendly' ? 0 : (modeConfig.price === 'all_in' ? profile.bankBalance : (modeConfig.price as number));

    if (challengeType === 'arena') {
      if (profile.bankBalance < stake || stake <= 0) {
        setChallengeError(`You have insufficient coins (${formatCoins(stake)} needed).`);
        return;
      }
    }

    setIsSendingChallenge(true);
    setChallengeError('');

    try {
      await addDoc(collection(db, 'challenges'), {
        challengerUid: user.uid,
        challengedUid: activeChallengeFriend.uid,
        mode: modeConfig.id,
        stake,
        status: 'pending',
        matchId: null,
        createdAt: Date.now()
      } as FriendlyChallenge);

      setActiveChallengeFriend(null);
    } catch (err: any) {
      setChallengeError(err.message || 'Failed to send challenge');
    } finally {
      setIsSendingChallenge(false);
    }
  };

  const handleAcceptChallenge = async (ch: FriendlyChallenge) => {
    if (!user || !profile) return;
    setIsAcceptingChallenge(ch.id!);

    try {
      const matchId = await acceptFriendlyChallenge(
        ch.id!,
        ch.challengerUid,
        ch.challengedUid,
        ch.mode,
        ch.stake
      );
      onStartGame(matchId);
    } catch (err: any) {
      alert(err.message || 'Failed to accept challenge.');
    } finally {
      setIsAcceptingChallenge(null);
    }
  };

  const handleDeclineChallenge = async (chId: string) => {
    try {
      await setDoc(doc(db, 'challenges', chId), { status: 'declined' }, { merge: true });
    } catch (err) {
      console.error('Failed to decline challenge:', err);
    }
  };

  const isOnline = (lastActive: number) => Date.now() - lastActive < 5 * 60 * 1000;

  // Pending sent challenge IDs (to avoid showing challenge button while one is pending)
  const pendingSentChallengeUids = new Set(sentChallenges.map((c) => c.challengedUid));

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8 text-left animate-fade-in relative z-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center space-x-2 text-slate-400 hover:text-white transition-colors text-sm font-medium cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back to Play</span>
        </button>
      </div>

      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-slate-100 flex items-center space-x-2.5">
          <UserCheck className="w-6 h-6 text-violet-400" />
          <span>Friends</span>
        </h2>
        <p className="text-sm text-slate-500">
          Manage your friends, send challenges, and track incoming battle invites.
        </p>
      </div>

      {/* Active Challenge Alerts — collapsible banner */}
      {receivedChallenges.length > 0 && (
        <div className="glass rounded-xl border border-violet-500/30 overflow-hidden shadow-lg shadow-violet-900/20">
          <button
            onClick={() => setChallengesExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 bg-violet-950/30 cursor-pointer"
          >
            <span className="flex items-center gap-2 text-sm font-bold text-violet-300">
              <Bell className="w-4 h-4 animate-pulse" />
              <span>{receivedChallenges.length} Incoming Challenge{receivedChallenges.length > 1 ? 's' : ''}</span>
              <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                {receivedChallenges.length}
              </span>
            </span>
            <span className="text-slate-400 text-xs">{challengesExpanded ? '▲ Hide' : '▼ Show'}</span>
          </button>

          {challengesExpanded && (
            <div className="divide-y divide-white/5">
              {receivedChallenges.map((ch) => {
                const challenger = challengerProfiles[ch.challengerUid];
                return (
                  <div key={ch.id} className="px-5 py-4 flex items-center justify-between gap-4">
                    <div className="space-y-0.5 text-left">
                      <span className="text-xs font-bold text-violet-300">
                        {ch.stake === 0 ? '🤝' : '⚔️'} {challenger?.displayName || 'Someone'} challenges you!
                      </span>
                      <p className="text-[11px] text-slate-400 font-mono">
                        {CHALLENGE_MODES.find((m) => m.id === ch.mode)?.label} ({CHALLENGE_MODES.find((m) => m.id === ch.mode)?.tc}) •{' '}
                        {ch.stake === 0 ? (
                          <span className="text-emerald-400 font-semibold">Friendly Match (0 🪙)</span>
                        ) : (
                          <strong className="text-amber-400">{formatCoins(ch.stake)}</strong>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleAcceptChallenge(ch)}
                        disabled={isAcceptingChallenge === ch.id}
                        className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white px-4 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                      >
                        {isAcceptingChallenge === ch.id ? 'Starting…' : 'Accept & Play'}
                      </button>
                      <button
                        onClick={() => handleDeclineChallenge(ch.id!)}
                        disabled={isAcceptingChallenge === ch.id}
                        className="bg-red-500/10 hover:bg-red-600 hover:text-white text-red-400 border border-red-500/20 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

        {/* ── LEFT: Friends List ── */}
        <div className="lg:col-span-8 space-y-5">

          {/* Incoming friend requests */}
          {incomingRequests.length > 0 && (
            <div className="glass p-5 rounded-xl border border-emerald-500/20 space-y-3">
              <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-emerald-400" />
                Incoming Friend Requests ({incomingRequests.length})
              </h3>
              <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1 scrollbar-thin">
                {incomingRequests.map((req) => {
                  const sender = challengerProfiles[req.requesterUid];
                  return (
                    <div key={req.id} className="flex items-center justify-between bg-slate-950/40 p-2.5 rounded-lg border border-white/5">
                      <span className="text-xs font-semibold text-slate-300">{sender?.displayName || 'Loading…'}</span>
                      <div className="flex items-center space-x-1.5">
                        <button
                          onClick={() => handleAcceptRequest(req.id!)}
                          className="p-1 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded border border-emerald-500/20 transition-all cursor-pointer"
                          title="Accept Request"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeclineRequest(req.id!)}
                          className="p-1 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white rounded border border-red-500/20 transition-all cursor-pointer"
                          title="Decline Request"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Friends list with inline challenge button */}
          <div className="glass p-6 rounded-xl border border-white/5 space-y-4">
            <h3 className="text-base font-bold text-slate-200 flex items-center gap-2 border-b border-white/5 pb-3">
              <Star className="w-5 h-5 text-amber-400" />
              <span>Your Friends ({friendsProfiles.length})</span>
            </h3>

            {friendsProfiles.length === 0 ? (
              <div className="py-10 text-center text-slate-500 text-sm italic">
                No friends yet. Add someone by their unique username →
              </div>
            ) : (
              <div className="divide-y divide-white/5 max-h-[480px] overflow-y-auto pr-2 scrollbar-thin">
                {friendsProfiles.map((fProfile) => {
                  const bestAch = getBestAchievement(fProfile.gameplayCounts);
                  const online = isOnline(fProfile.lastActiveAt);
                  const hasPendingChallenge = pendingSentChallengeUids.has(fProfile.uid);

                  const friendship = user ? friendships.find(
                    (f) =>
                      (f.requesterUid === user.uid && f.receiverUid === fProfile.uid) ||
                      (f.requesterUid === fProfile.uid && f.receiverUid === user.uid)
                  ) : undefined;
                  const userStats = user ? friendship?.stats?.[user.uid] : undefined;

                  return (
                    <div key={fProfile.uid} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
                      {/* Avatar + Name */}
                      <div className="flex items-center space-x-3.5">
                        <div className="relative">
                          <img
                            src={fProfile.photoURL}
                            alt={fProfile.displayName}
                            className="w-10 h-10 rounded-full object-cover border border-white/10"
                          />
                          <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#121318] ${
                            online ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]' : 'bg-slate-600'
                          }`} title={online ? 'Online' : 'Offline'} />
                        </div>

                        <div className="text-left space-y-0.5">
                          <p className="text-sm font-semibold text-slate-200 flex items-center gap-2 flex-wrap">
                            <span>{fProfile.displayName}</span>
                            {fProfile.rating >= 2500 && (
                              <span className="font-serif font-extrabold tracking-wider bg-gradient-to-r from-amber-400 via-yellow-200 to-amber-500 bg-clip-text text-transparent border border-amber-400/60 bg-amber-950/40 px-1.5 py-0.2 rounded text-[8px] uppercase select-none font-bold" title="Grandmaster">
                                GM
                              </span>
                            )}
                            {bestAch && (
                              <span className={`px-1.5 py-0.2 rounded text-[8px] font-bold border ${bestAch.color.split(' ')[0]} ${bestAch.color.split(' ')[1]} ${bestAch.color.split(' ')[2]}`}>
                                {bestAch.badge}
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono flex flex-wrap items-center gap-1.5 mt-0.5">
                            <span>{fProfile.rating} Elo</span>
                            <span>•</span>
                            <span className={online ? "text-emerald-400 font-medium" : "text-slate-500"}>
                              {online ? 'Online' : 'Offline'}
                            </span>
                            {userStats && (userStats.wins > 0 || userStats.losses > 0 || userStats.draws > 0) && (
                              <>
                                <span>•</span>
                                <span className="bg-slate-950/60 border border-white/5 px-2 py-0.5 rounded text-slate-400 font-medium font-mono">
                                  H2H: <span className="text-emerald-400 font-bold">{userStats.wins}W</span> - <span className="text-red-400 font-bold">{userStats.losses}L</span>{userStats.draws > 0 && <span className="text-slate-400"> - {userStats.draws}D</span>}
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                      </div>

                      {/* Inline Challenge Button */}
                      {hasPendingChallenge ? (
                        <span className="text-[10px] bg-slate-900 border border-white/5 px-2.5 py-1 rounded text-slate-400 font-medium animate-pulse">
                          Pending…
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            setChallengeError('');
                            setSelectedModeIdx(0);
                            setChallengeType('friendly');
                            setActiveChallengeFriend(fProfile);
                          }}
                          className="flex items-center gap-1.5 bg-violet-600/10 hover:bg-violet-600 hover:text-white text-violet-400 border border-violet-500/20 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                        >
                          <Swords className="w-3.5 h-3.5" />
                          Challenge
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pending sent requests */}
            {outgoingRequests.length > 0 && (
              <div className="pt-4 border-t border-white/5 space-y-2">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Sent Requests ({outgoingRequests.length})
                </h4>
                {outgoingRequests.map((req) => {
                  const receiver = challengerProfiles[req.receiverUid];
                  return (
                    <div key={req.id} className="flex items-center justify-between bg-slate-950/40 p-2.5 rounded-lg border border-white/5">
                      <span className="text-xs font-semibold text-slate-400">{receiver?.displayName || 'Loading…'}</span>
                      <button
                        onClick={() => handleDeclineRequest(req.id!)}
                        className="text-[10px] font-bold text-red-400/70 hover:text-red-400 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Sent (pending) challenges list */}
            {sentChallenges.length > 0 && (
              <div className="pt-4 border-t border-white/5 space-y-2">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Gamepad2 className="w-3.5 h-3.5" />
                  Outgoing Challenges ({sentChallenges.length})
                </h4>
                {sentChallenges.map((ch) => {
                  const challenged = challengerProfiles[ch.challengedUid];
                  return (
                    <div key={ch.id} className="flex items-center justify-between bg-slate-950/40 border border-white/5 rounded-lg p-2.5">
                      <div className="text-left space-y-0.5">
                        <span className="text-[10px] text-slate-500 font-semibold block">→ {challenged?.displayName || 'Loading…'}</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {CHALLENGE_MODES.find((m) => m.id === ch.mode)?.label} •{' '}
                          {ch.stake === 0 ? (
                            <span className="text-emerald-400 font-semibold">Friendly Match</span>
                          ) : (
                            <span className="text-amber-400">{formatCoins(ch.stake)}</span>
                          )}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDeclineChallenge(ch.id!)}
                        className="p-1 hover:bg-white/5 rounded text-slate-500 hover:text-red-400 transition-all cursor-pointer"
                        title="Cancel Invite"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Add Friend Panel ── */}
        <div className="lg:col-span-4 space-y-5">
          <div className="glass p-6 rounded-xl border border-white/5 space-y-4">
            <h3 className="text-base font-bold text-slate-200 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-violet-400" />
              <span>Add Friend</span>
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Enter the exact unique username of the player you want to add.
            </p>
            <form onSubmit={handleSendFriendRequest} className="space-y-3">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Enter unique username…"
                  value={searchUsername}
                  onChange={(e) => setSearchUsername(e.target.value)}
                  className="w-full bg-slate-950/60 border border-white/10 rounded-lg pl-3.5 pr-10 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500 transition-colors"
                />
                <button
                  type="submit"
                  disabled={isSendingRequest || !searchUsername.trim()}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors disabled:opacity-30 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>

              {requestError && (
                <p className="text-[11px] text-red-400 font-medium flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>{requestError}</span>
                </p>
              )}
              {requestSuccess && (
                <p className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{requestSuccess}</span>
                </p>
              )}
            </form>
          </div>
        </div>
      </div>

      {/* ── Challenge Mode Selection Modal ── */}
      {activeChallengeFriend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
          <div className="glass-card w-full max-w-md rounded-2xl overflow-hidden border border-white/10 flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/5 bg-slate-900/40">
              <h3 className="text-base font-bold text-slate-200 flex items-center space-x-2">
                <Swords className="w-5 h-5 text-violet-400" />
                <span>Challenge {activeChallengeFriend.displayName}</span>
              </h3>
              <button
                onClick={() => setActiveChallengeFriend(null)}
                className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block text-left">
                  Challenge Type
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950/60 rounded-xl border border-white/5">
                  <button
                    type="button"
                    onClick={() => {
                      setChallengeType('friendly');
                      setChallengeError('');
                    }}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      challengeType === 'friendly'
                        ? 'bg-violet-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🤝 Friendly (No Coins)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setChallengeType('arena');
                      setChallengeError('');
                    }}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      challengeType === 'arena'
                        ? 'bg-violet-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ⚔️ Arena Clash (Staked)
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block text-left">
                  Choose Game Mode
                </label>
                <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-1 scrollbar-thin">
                  {CHALLENGE_MODES.map((mode, idx) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setSelectedModeIdx(idx)}
                      className={`p-2.5 rounded-lg border text-left flex flex-col justify-between gap-1 transition-all cursor-pointer ${
                        selectedModeIdx === idx
                          ? 'border-violet-500 bg-violet-500/10 text-violet-300 ring-1 ring-violet-500'
                          : 'border-white/5 bg-slate-950/40 hover:bg-slate-900/40 text-slate-400'
                      }`}
                    >
                      <span className="text-xs font-bold block">{mode.label}</span>
                      <span className="text-[9px] font-mono text-slate-500">
                        {mode.tc} • {challengeType === 'friendly' ? 'Free (0 🪙)' : (mode.price === 'all_in' ? 'ALL IN' : formatCoins(mode.price as number))}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {challengeError && (
                <p className="text-xs text-red-400 font-medium flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4" />
                  <span>{challengeError}</span>
                </p>
              )}
            </div>

            <div className="p-6 bg-slate-950/40 border-t border-white/5 flex items-center justify-end space-x-3">
              <button
                onClick={() => setActiveChallengeFriend(null)}
                className="bg-slate-900/60 hover:bg-slate-800/60 text-slate-300 border border-white/5 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSendChallenge}
                disabled={isSendingChallenge}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white px-5 py-2.5 rounded-lg text-xs font-semibold transition-all border border-violet-500/20 disabled:opacity-50 cursor-pointer"
              >
                {isSendingChallenge ? 'Sending…' : 'Send Challenge Invite'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
