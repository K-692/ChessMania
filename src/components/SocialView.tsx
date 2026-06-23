import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { db, rtdb } from '../firebase';
import { collection, query, where, getDoc, getDocs, doc, setDoc, deleteDoc, onSnapshot, orderBy } from 'firebase/firestore';
import { ref as rRef, update as rUpdate, onValue as rOnValue } from 'firebase/database';
import { UserPlus, UserCheck, ShieldAlert, Star, Send, Check, X, ShieldCheck, ChevronLeft, Swords, Bell, MessageSquare } from 'lucide-react';
import type { Friendship, UserProfile, FriendlyChallenge, Match } from '../types';
import { ProfilePopup } from './ProfilePopup';

interface SocialViewProps {
  onBack: () => void;
  onStartGame: (matchId: string) => void;
  setOpenChatFriend: (friend: UserProfile | null) => void;
  unreadCounts: Record<string, number>;
}

export const SocialView: React.FC<SocialViewProps> = ({ onBack, onStartGame, setOpenChatFriend, unreadCounts }) => {
  const { user, profile } = useAuth();
  const [selectedProfile, setSelectedProfile] = useState<UserProfile | null>(null);

  // Friend Request States
  const [searchUsername, setSearchUsername] = useState('');
  const [requestError, setRequestError] = useState('');
  const [requestSuccess, setRequestSuccess] = useState('');
  const [isSendingRequest, setIsSendingRequest] = useState(false);

  // Firestore Subscriptions States
  const [incomingRequests, setIncomingRequests] = useState<Friendship[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<Friendship[]>([]);
  const [friendsProfiles, setFriendsProfiles] = useState<UserProfile[]>([]);
  const [receivedChallenges, setReceivedChallenges] = useState<FriendlyChallenge[]>([]);
  const [sentChallenges, setSentChallenges] = useState<FriendlyChallenge[]>([]);
  const [challengerProfiles, setChallengerProfiles] = useState<Record<string, UserProfile>>({});
  const profileCacheRef = React.useRef<Record<string, UserProfile>>({});
  const [h2hRecords, setH2hRecords] = useState<Record<string, { wins: number; losses: number; draws: number }>>({});

  // Active Challenge Modal State
  const [activeChallengeFriend, setActiveChallengeFriend] = useState<UserProfile | null>(null);
  const [challengeError, setChallengeError] = useState('');
  const [isSendingChallenge, setIsSendingChallenge] = useState(false);
  const [isAcceptingChallenge, setIsAcceptingChallenge] = useState<string | null>(null);

  // Real-time online statuses listener
  const [onlineStatuses, setOnlineStatuses] = useState<Record<string, { state: string, lastChanged: number }>>({});

  useEffect(() => {
    const statusRef = rRef(rtdb, 'status');
    const unsubscribe = rOnValue(statusRef, (snapshot) => {
      if (snapshot.exists()) {
        setOnlineStatuses(snapshot.val());
      } else {
        setOnlineStatuses({});
      }
    }, (err) => {
      console.warn("Error listening to presence status in RTDB:", err);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Pending challenges alert expanded state
  const [challengesExpanded, setChallengesExpanded] = useState(true);

  // Listen to all subcollection friends: users/{uid}/friends
  useEffect(() => {
    if (!user) return;

    const qFriends = collection(db, 'users', user.uid, 'friends');
    const unsubFriends = onSnapshot(qFriends, async (snap) => {
      const listFriendships: Friendship[] = [];
      const listIncoming: Friendship[] = [];
      const listOutgoing: Friendship[] = [];
      const profileIds: string[] = [];

      snap.forEach((docSnap) => {
        const friendUid = docSnap.id;
        const data = docSnap.data();
        if (data.status === 'accepted') {
          listFriendships.push({
            id: friendUid,
            requesterUid: user.uid,
            receiverUid: friendUid,
            status: 'accepted',
            createdAt: data.friendSince || Date.now()
          });
          profileIds.push(friendUid);
        } else if (data.status === 'pending_received') {
          listIncoming.push({
            id: friendUid,
            requesterUid: friendUid,
            receiverUid: user.uid,
            status: 'pending',
            createdAt: data.createdAt || Date.now()
          });
        } else if (data.status === 'pending_sent') {
          listOutgoing.push({
            id: friendUid,
            requesterUid: user.uid,
            receiverUid: friendUid,
            status: 'pending',
            createdAt: data.createdAt || Date.now()
          });
        }
      });

      setIncomingRequests(listIncoming);
      setOutgoingRequests(listOutgoing);

      // Fetch profiles for the friend list and requests using cached batch query
      const allNeededUids = [...profileIds, ...listIncoming.map(r => r.requesterUid), ...listOutgoing.map(r => r.receiverUid)];
      const missingUids = allNeededUids.filter(uid => !profileCacheRef.current[uid]);

      if (missingUids.length > 0) {
        const chunks: string[][] = [];
        for (let i = 0; i < missingUids.length; i += 30) {
          chunks.push(missingUids.slice(i, i + 30));
        }

        for (const chunk of chunks) {
          try {
            const q = query(collection(db, 'users'), where('uid', 'in', chunk));
            const querySnap = await getDocs(q);
            querySnap.forEach((docSnap) => {
              const p = { uid: docSnap.id, ...docSnap.data() } as UserProfile;
              profileCacheRef.current[p.uid] = p;
            });
          } catch (err) {
            console.warn("Failed to batch fetch user profiles, falling back to individual fetches:", err);
            for (const uid of chunk) {
              try {
                const uDoc = await getDoc(doc(db, 'users', uid));
                if (uDoc.exists()) {
                  profileCacheRef.current[uid] = { uid: uDoc.id, ...uDoc.data() } as UserProfile;
                }
              } catch (e) {}
            }
          }
        }
      }

      setChallengerProfiles({ ...profileCacheRef.current });

      const uProfiles: UserProfile[] = [];
      for (const fId of profileIds) {
        if (profileCacheRef.current[fId]) {
          uProfiles.push(profileCacheRef.current[fId]);
        }
      }
      setFriendsProfiles(uProfiles);
    });

    // Listen to friendly challenges mirrored under the user profile in RTDB
    const userChallengesRef = rRef(rtdb, `user_challenges/${user.uid}`);
    const unsubChallenges = rOnValue(userChallengesRef, async (snap) => {
      const received: FriendlyChallenge[] = [];
      const sent: FriendlyChallenge[] = [];
      const neededUids: string[] = [];

      if (snap.exists()) {
        const dataMap = snap.val();
        for (const cid in dataMap) {
          const data = dataMap[cid] as FriendlyChallenge;
          data.id = cid;

          if (data.status === 'pending') {
            if (data.challengerUid === user.uid) {
              sent.push(data);
              neededUids.push(data.challengedUid);
            } else {
              received.push(data);
              neededUids.push(data.challengerUid);
            }
          }
        }
      }

      const missingUids = neededUids.filter(uid => !profileCacheRef.current[uid]);
      if (missingUids.length > 0) {
        const chunks: string[][] = [];
        for (let i = 0; i < missingUids.length; i += 30) {
          chunks.push(missingUids.slice(i, i + 30));
        }

        for (const chunk of chunks) {
          try {
            const q = query(collection(db, 'users'), where('uid', 'in', chunk));
            const querySnap = await getDocs(q);
            querySnap.forEach((docSnap) => {
              const p = { uid: docSnap.id, ...docSnap.data() } as UserProfile;
              profileCacheRef.current[p.uid] = p;
            });
          } catch (err) {
            console.warn("Failed to batch fetch challenge user profiles:", err);
            for (const uid of chunk) {
              try {
                const uDoc = await getDoc(doc(db, 'users', uid));
                if (uDoc.exists()) {
                  profileCacheRef.current[uid] = { uid: uDoc.id, ...uDoc.data() } as UserProfile;
                }
              } catch (e) {}
            }
          }
        }
      }

      setReceivedChallenges(received);
      setSentChallenges(sent);
      setChallengerProfiles({ ...profileCacheRef.current });
    });

    return () => {
      unsubFriends();
      unsubChallenges();
    };
  }, [user]);

  // Load Head-to-Head records for friends list
  useEffect(() => {
    if (!user) return;
    const fetchH2H = async () => {
      try {
        const q = query(
          collection(db, 'matches'),
          where('players', 'array-contains', user.uid)
        );
        const snap = await getDocs(q);
        const records: Record<string, { wins: number; losses: number; draws: number }> = {};

        snap.forEach((docSnap) => {
          const matchData = docSnap.data() as Match;
          if (matchData.status === 'active') return;

          const oppUid = matchData.players.find(p => p !== user.uid);
          if (!oppUid) return;

          if (!records[oppUid]) {
            records[oppUid] = { wins: 0, losses: 0, draws: 0 };
          }

          if (matchData.winnerUid === user.uid) {
            records[oppUid].wins += 1;
          } else if (matchData.winnerUid) {
            records[oppUid].losses += 1;
          } else {
            records[oppUid].draws += 1;
          }
        });

        setH2hRecords(records);
      } catch (err) {
        console.warn('Failed to load H2H records:', err);
      }
    };
    fetchH2H();
  }, [user, friendsProfiles]);

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

      // Check subcollection users/{uid}/friends/{friendUid}
      const friendDocRef = doc(db, 'users', user.uid, 'friends', targetUser.uid);
      const friendSnap = await getDoc(friendDocRef);
      if (friendSnap.exists()) {
        setRequestError('Friend request or friendship already active or pending');
        setIsSendingRequest(false);
        return;
      }

      const docA = doc(db, 'users', user.uid, 'friends', targetUser.uid);
      const docB = doc(db, 'users', targetUser.uid, 'friends', user.uid);
      const now = Date.now();

      await Promise.all([
        setDoc(docA, {
          status: 'pending_sent',
          createdAt: now,
          displayName: targetUser.displayName,
          photoURL: targetUser.photoURL
        }),
        setDoc(docB, {
          status: 'pending_received',
          createdAt: now,
          displayName: profile.displayName,
          photoURL: profile.photoURL
        })
      ]);

      setRequestSuccess(`Friend request sent to ${targetUser.displayName}!`);
      setSearchUsername('');
    } catch (err: any) {
      setRequestError(err.message || 'Failed to send friend request');
    } finally {
      setIsSendingRequest(false);
    }
  };

  const handleAcceptRequest = async (friendUid: string) => {
    if (!user || !profile) return;
    try {
      const docA = doc(db, 'users', user.uid, 'friends', friendUid);
      const docB = doc(db, 'users', friendUid, 'friends', user.uid);
      const now = Date.now();

      const friendSnap = await getDoc(doc(db, 'users', friendUid));
      const friendData = friendSnap.exists() ? friendSnap.data() : {};

      await Promise.all([
        setDoc(docA, {
          status: 'accepted',
          friendSince: now,
          displayName: friendData.displayName || 'Player',
          photoURL: friendData.photoURL || ''
        }, { merge: true }),
        setDoc(docB, {
          status: 'accepted',
          friendSince: now,
          displayName: profile.displayName,
          photoURL: profile.photoURL
        }, { merge: true })
      ]);
    } catch (err) {
      console.error('Failed to accept request:', err);
    }
  };

  const handleDeclineRequest = async (friendUid: string) => {
    if (!user) return;
    try {
      const docA = doc(db, 'users', user.uid, 'friends', friendUid);
      const docB = doc(db, 'users', friendUid, 'friends', user.uid);
      await Promise.all([
        deleteDoc(docA),
        deleteDoc(docB)
      ]);
    } catch (err) {
      console.error('Failed to decline request:', err);
    }
  };

  // Rollmate Challenge Submission
  const handleSendChallenge = async () => {
    if (!user || !profile || !activeChallengeFriend) return;

    setIsSendingChallenge(true);
    setChallengeError('');

    try {
      const challengeId = 'challenge_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();

      const challengeObj = {
        challengeId,
        challengerUid: user.uid,
        challengedUid: activeChallengeFriend.uid,
        mode: 'Rollmate',
        status: 'pending',
        matchId: null,
        createdAt: Date.now()
      };

      const updates: Record<string, any> = {};
      updates[`challenges/${challengeId}`] = challengeObj;
      updates[`user_challenges/${user.uid}/${challengeId}`] = challengeObj;
      updates[`user_challenges/${activeChallengeFriend.uid}/${challengeId}`] = challengeObj;

      const dbRef = rRef(rtdb);
      await rUpdate(dbRef, updates);

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
      const mId = 'match_challenge_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
      const now = Date.now();

      // Seed match document in RTDB
      const newMatch: Match = {
        id: mId,
        players: [ch.challengerUid, ch.challengedUid],
        whiteUid: ch.challengerUid,
        blackUid: ch.challengedUid,
        mode: 'Rollmate',
        status: 'active',
        winnerUid: null,
        createdAt: now,
        finishedAt: null
      };

      const challengeObj = {
        ...ch,
        status: 'accepted',
        matchId: mId,
        acceptedAt: now
      };

      const updates: Record<string, any> = {};
      updates[`challenges/${ch.id}`] = challengeObj;
      updates[`user_challenges/${ch.challengerUid}/${ch.id}`] = challengeObj;
      updates[`user_challenges/${ch.challengedUid}/${ch.id}`] = challengeObj;
      updates[`matches/${mId}`] = newMatch;

      await rUpdate(rRef(rtdb), updates);
      onStartGame(mId);
    } catch (err: any) {
      alert(err.message || 'Failed to accept challenge.');
    } finally {
      setIsAcceptingChallenge(null);
    }
  };

  const handleDeclineChallenge = async (ch: FriendlyChallenge) => {
    try {
      const updates: Record<string, any> = {};
      updates[`challenges/${ch.id}/status`] = 'declined';
      updates[`user_challenges/${ch.challengerUid}/${ch.id}/status`] = 'declined';
      updates[`user_challenges/${ch.challengedUid}/${ch.id}/status`] = 'declined';
      
      const dbRef = rRef(rtdb);
      await rUpdate(dbRef, updates);
    } catch (err) {
      console.error('Failed to decline challenge:', err);
    }
  };

  const isFriendOnline = (friendUid: string) => {
    const status = onlineStatuses[friendUid];
    return status?.state === 'online';
  };

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
          <span>Back to Home</span>
        </button>
      </div>

      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-slate-100 flex items-center space-x-2.5">
          <UserCheck className="w-6 h-6 text-violet-400" />
          <span>Friends List</span>
        </h2>
        <p className="text-sm text-slate-500">
          Manage your friendships, chat in real-time, and challenge friends to Rollmate matches.
        </p>
      </div>

      {/* Active Challenge Alerts */}
      {receivedChallenges.length > 0 && (
        <div className="bg-zinc-900 border border-violet-500/30 rounded-xl overflow-hidden shadow-lg">
          <button
            onClick={() => setChallengesExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 bg-violet-950/20 cursor-pointer"
          >
            <span className="flex items-center gap-2 text-sm font-bold text-violet-300">
              <Bell className="w-4 h-4 animate-pulse" />
              <span>Incoming Battle Invites</span>
              <span className="bg-violet-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                {receivedChallenges.length}
              </span>
            </span>
            <span className="text-slate-400 text-xs">{challengesExpanded ? '▲ Hide' : '▼ Show'}</span>
          </button>

          {challengesExpanded && (
            <div className="divide-y divide-zinc-800 bg-zinc-950/20">
              {receivedChallenges.map((ch) => {
                const challenger = challengerProfiles[ch.challengerUid];
                return (
                  <div key={ch.id} className="px-5 py-4 flex items-center justify-between gap-4">
                    <div className="space-y-0.5 text-left">
                      <span className="text-xs font-bold text-violet-300">
                        ⚔️ {challenger?.displayName || 'Someone'} challenges you!
                      </span>
                      <p className="text-[11px] text-slate-400">
                        Game Mode: Rollmate • Friendly Match
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
                        onClick={() => handleDeclineChallenge(ch)}
                        disabled={isAcceptingChallenge === ch.id}
                        className="bg-zinc-800 hover:bg-zinc-700 text-slate-300 border border-zinc-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer disabled:opacity-50"
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
        
        {/* LEFT Friends List */}
        <div className="lg:col-span-8 space-y-5">
          
          {/* Incoming requests */}
          {incomingRequests.length > 0 && (
            <div className="bg-zinc-900/60 p-5 rounded-xl border border-zinc-800 space-y-3">
              <h3 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-emerald-400" />
                Incoming Friend Requests ({incomingRequests.length})
              </h3>
              <div className="space-y-2">
                {incomingRequests.map((req) => {
                  const sender = challengerProfiles[req.requesterUid];
                  return (
                    <div key={req.id} className="flex items-center justify-between bg-zinc-955 p-2.5 rounded-lg border border-zinc-800/50">
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

          {/* Friends list */}
          <div className="bg-zinc-900/60 p-6 rounded-xl border border-zinc-800 space-y-4">
            <h3 className="text-base font-bold text-slate-200 flex items-center gap-2 border-b border-zinc-800 pb-3">
              <Star className="w-5 h-5 text-amber-400" />
              <span>Your Friends ({friendsProfiles.length})</span>
            </h3>

            {friendsProfiles.length === 0 ? (
              <div className="py-10 text-center text-slate-500 text-sm italic">
                No friends added yet. Enter a username to send a request!
              </div>
            ) : (
              <div className="divide-y divide-zinc-800 max-h-[480px] overflow-y-auto pr-2 scrollbar-thin">
                {friendsProfiles.map((fProfile) => {
                  const online = isFriendOnline(fProfile.uid);
                  const hasPendingChallenge = pendingSentChallengeUids.has(fProfile.uid);
                  const record = h2hRecords[fProfile.uid] || { wins: 0, losses: 0, draws: 0 };

                  return (
                    <div key={fProfile.uid} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
                      
                      {/* Avatar & Online status */}
                      <div className="flex items-center space-x-3.5">
                        <div className="relative">
                          <img
                            src={fProfile.photoURL}
                            alt={fProfile.displayName}
                            className="w-10 h-10 rounded-full object-cover border border-zinc-800 cursor-pointer hover:opacity-80 transition-opacity"
                            title="View Profile"
                            onClick={() => setSelectedProfile(fProfile)}
                          />
                          <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-black ${
                            online ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]' : 'bg-zinc-600'
                          }`} />
                        </div>

                        <div className="text-left space-y-0.5">
                          <p className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                            <span>{fProfile.displayName}</span>
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono flex flex-wrap items-center gap-1.5 mt-0.5">
                            <span className="text-amber-400 font-semibold">{fProfile.rating || 1200} Elo</span>
                            <span>•</span>
                            <span className={online ? "text-emerald-400" : "text-slate-500"}>
                              {online ? 'Online' : 'Offline'}
                            </span>
                            <span>•</span>
                            <span>
                              Record: <span className="text-emerald-400">{record.wins}W</span> - <span className="text-red-400">{record.losses}L</span> - <span className="text-zinc-500">{record.draws}D</span>
                            </span>
                          </p>
                        </div>
                      </div>

                      {/* Inline Actions */}
                      <div className="flex items-center gap-2">
                        {/* Chat Button */}
                        <button
                          onClick={() => setOpenChatFriend(fProfile)}
                          className="relative flex items-center justify-center bg-zinc-950 hover:bg-violet-600 text-slate-400 hover:text-white border border-zinc-800 w-8 h-8 rounded-lg transition-all cursor-pointer"
                          title="Chat with Friend"
                        >
                          <MessageSquare className="w-4 h-4" />
                          {unreadCounts[fProfile.uid] > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white ring-1 ring-black">
                              {unreadCounts[fProfile.uid]}
                            </span>
                          )}
                        </button>

                        {/* Challenge Button */}
                        {hasPendingChallenge ? (
                          <span className="text-[10px] bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 rounded text-slate-500 font-semibold animate-pulse">
                            Sent...
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setChallengeError('');
                              setActiveChallengeFriend(fProfile);
                            }}
                            className="flex items-center gap-1.5 bg-violet-600/10 hover:bg-violet-600 text-violet-400 hover:text-white border border-violet-500/20 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                          >
                            <Swords className="w-3.5 h-3.5" />
                            Challenge
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Sent pending requests */}
            {outgoingRequests.length > 0 && (
              <div className="pt-4 border-t border-zinc-800 space-y-2">
                <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Sent Invites ({outgoingRequests.length})
                </h4>
                {outgoingRequests.map((req) => {
                  const receiver = challengerProfiles[req.receiverUid];
                  return (
                    <div key={req.id} className="flex items-center justify-between bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-800/40">
                      <span className="text-xs text-slate-400">{receiver?.displayName || 'Loading…'}</span>
                      <button
                        onClick={() => handleDeclineRequest(req.id!)}
                        className="text-[10px] font-bold text-red-400/80 hover:text-red-400 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        </div>

        {/* RIGHT Add Friend Panel */}
        <div className="lg:col-span-4 space-y-5">
          <div className="bg-zinc-900/60 p-6 rounded-xl border border-zinc-800 space-y-4 text-left">
            <h3 className="text-base font-bold text-slate-200 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-violet-400" />
              <span>Add Friend</span>
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Enter the exact username of the player you wish to add.
            </p>
            <form onSubmit={handleSendFriendRequest} className="space-y-3">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Enter username…"
                  value={searchUsername}
                  onChange={(e) => setSearchUsername(e.target.value)}
                  className="w-full bg-zinc-950/80 border border-zinc-800 rounded-lg pl-3.5 pr-10 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500 transition-colors"
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
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  <span>{requestError}</span>
                </p>
              )}
              {requestSuccess && (
                <p className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>{requestSuccess}</span>
                </p>
              )}
            </form>
          </div>
        </div>

      </div>

      {/* Challenge Confirmation Modal */}
      {activeChallengeFriend && (
        <div 
          className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 z-50 animate-fade-in"
        >
          <div className="bg-zinc-900 border border-zinc-850 w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl flex flex-col p-6 text-left space-y-6">
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                <Swords className="w-5 h-5 text-violet-400" />
                <span>Send Battle Invite</span>
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Are you sure you want to invite <strong className="text-white">{activeChallengeFriend.displayName}</strong> to a friendly match of **Rollmate**?
              </p>
            </div>

            {challengeError && (
              <p className="text-xs text-red-400 font-medium flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-red-500" />
                <span>{challengeError}</span>
              </p>
            )}

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setActiveChallengeFriend(null)}
                className="bg-zinc-800 hover:bg-zinc-700 text-slate-300 border border-zinc-700 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSendChallenge}
                disabled={isSendingChallenge}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white px-5 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer"
              >
                {isSendingChallenge ? 'Sending…' : 'Challenge'}
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

export interface FriendChatModalProps {
  friend: UserProfile;
  onClose: () => void;
}

export const FriendChatModal: React.FC<FriendChatModalProps> = ({ friend, onClose }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<{ id: string; senderUid: string; text: string; createdAt: number }[]>([]);
  const [input, setInput] = useState('');
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  const getThreadId = (uid1: string, uid2: string) => {
    return [uid1, uid2].sort().join('_');
  };

  // Clean up messages older than 24 hours on load
  useEffect(() => {
    if (!user) return;
    const cleanup = async () => {
      try {
        const threadId = getThreadId(user.uid, friend.uid);
        const q = collection(db, 'users', user.uid, 'chatThreads', threadId, 'messages');
        const snap = await getDocs(q);
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.createdAt < cutoff) {
            deleteDoc(doc(db, 'users', user.uid, 'chatThreads', threadId, 'messages', docSnap.id)).catch(console.warn);
          }
        });
      } catch (err) {
        console.warn("Failed to cleanup old messages:", err);
      }
    };
    cleanup();
  }, [user, friend.uid]);

  // Subscribe to messages
  useEffect(() => {
    if (!user) return;
    const threadId = getThreadId(user.uid, friend.uid);
    const q = query(
      collection(db, 'users', user.uid, 'chatThreads', threadId, 'messages'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      const msgs: any[] = [];
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.createdAt >= cutoff) {
          msgs.push({ id: docSnap.id, ...data });
        }
      });
      setMessages(msgs);
    });

    return () => unsubscribe();
  }, [user, friend.uid]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !user) return;
    const text = input.trim();
    setInput('');
    try {
      const threadId = getThreadId(user.uid, friend.uid);
      const msgColA = collection(db, 'users', user.uid, 'chatThreads', threadId, 'messages');
      const msgColB = collection(db, 'users', friend.uid, 'chatThreads', threadId, 'messages');
      
      const newMsgId = doc(msgColA).id;
      const msgData = {
        id: newMsgId,
        senderUid: user.uid,
        text,
        createdAt: Date.now(),
        read: false
      };

      await Promise.all([
        setDoc(doc(msgColA, newMsgId), msgData),
        setDoc(doc(msgColB, newMsgId), msgData)
      ]);
    } catch (err) {
      console.error("Failed to send message:", err);
    }
  };

  return (
    <div className="fixed top-[77px] bottom-0 left-0 right-0 z-45 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in text-xs">
      <div className="bg-zinc-900 border border-zinc-800 w-full max-w-md rounded-2xl overflow-hidden flex flex-col shadow-2xl h-[500px]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/20">
          <div className="flex items-center space-x-3 text-left">
            <img src={friend.photoURL} alt={friend.displayName} className="w-8 h-8 rounded-full object-cover border border-zinc-800" />
            <div>
              <h3 className="text-sm font-bold text-slate-200">{friend.displayName}</h3>
              <p className="text-[10px] text-slate-500 font-mono">Messages auto-deleted after 24 hours</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer">
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Message area */}
        <div className="flex-grow overflow-y-auto p-6 space-y-4 scrollbar-thin text-xs text-left">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 italic">
              No recent messages. Start the conversation!
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.senderUid === user?.uid;
              return (
                <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  <div className={`px-3 py-2 rounded-xl max-w-[85%] break-words shadow ${
                    isMe ? 'bg-violet-600 text-white rounded-tr-none' : 'bg-zinc-950 text-slate-200 rounded-tl-none border border-zinc-850'
                  }`}>
                    {msg.text}
                  </div>
                  <span className="text-[8px] text-slate-500 font-mono mt-1 block">
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              );
            })
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSendMessage} className="p-4 bg-zinc-950/20 border-t border-zinc-800 flex gap-2">
          <input
            type="text"
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-grow bg-zinc-950 border border-zinc-850 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500"
          />
          <button type="submit" className="bg-violet-600 hover:bg-violet-500 text-white p-2.5 rounded-xl transition-all cursor-pointer shrink-0">
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
