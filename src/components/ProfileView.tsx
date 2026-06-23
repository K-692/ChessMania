import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { db } from '../firebase';
import { collection, getDocs, query, where, orderBy, limit, getDoc, doc } from 'firebase/firestore';
import { ChevronLeft, Camera, User, Calendar, Users, History, Edit2, Lock, X } from 'lucide-react';
import type { UserProfile } from '../types';

interface ProfileViewProps {
  onBack: () => void;
  onStartGame?: (matchId: string) => void;
}

const PIECE_STYLES = [
  { id: 'neon', name: 'Neon Glow' },
  { id: '8_bit', name: '8-Bit Retro' },
  { id: 'neo', name: 'Neo Modern' },
  { id: 'glass', name: 'Glassic' },
  { id: 'gothic', name: 'Gothic Dark' },
  { id: 'wood', name: 'Classic Wood' },
  { id: 'classic', name: 'Standard Classic' },
  { id: 'graffiti', name: 'Street Art' },
  { id: 'space', name: 'Cosmic Space' }
];

const PIECE_ROLES = [
  { code: 'wk', name: 'White King' },
  { code: 'wq', name: 'White Queen' },
  { code: 'wn', name: 'White Knight' },
  { code: 'wr', name: 'White Rook' },
  { code: 'bk', name: 'Black King' },
  { code: 'bq', name: 'Black Queen' },
  { code: 'bn', name: 'Black Knight' },
  { code: 'br', name: 'Black Rook' }
];

export const ProfileView: React.FC<ProfileViewProps> = ({ onBack }) => {
  const { user, profile, updateCachedProfile } = useAuth();
  
  // States
  const [selectedAvatarStyle, setSelectedAvatarStyle] = useState('neon');
  const [friendCount, setFriendCount] = useState(0);
  const [recentMatches, setRecentMatches] = useState<any[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [opponentProfiles, setOpponentProfiles] = useState<Record<string, UserProfile>>({});
  
  // Photo modal states
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [customPhotoUrl, setCustomPhotoUrl] = useState('');
  const [photoError, setPhotoError] = useState('');
  
  // Username states
  const [isNameModalOpen, setIsNameModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameError, setNameError] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Fetch Friend Count
  useEffect(() => {
    if (!user) return;
    const fetchFriends = async () => {
      try {
        const q = query(
          collection(db, 'users', user.uid, 'friends'),
          where('status', '==', 'accepted')
        );
        const snap = await getDocs(q);
        setFriendCount(snap.size);
      } catch (err) {
        console.warn("Failed to fetch friends count:", err);
      }
    };
    fetchFriends();
  }, [user]);

  // Fetch Match History
  useEffect(() => {
    if (!user) return;
    const fetchMatches = async () => {
      setLoadingMatches(true);
      try {
        const q = query(
          collection(db, 'matches'),
          where('players', 'array-contains', user.uid),
          orderBy('createdAt', 'desc'),
          limit(10)
        );
        const querySnap = await getDocs(q);
        const matches: any[] = [];
        const oppUids = new Set<string>();

        querySnap.forEach((docSnap) => {
          const m = docSnap.data();
          if (m.status === 'completed' || m.status === 'terminated') {
            matches.push({ id: docSnap.id, ...m });
            const oppUid = m.players.find((p: string) => p !== user.uid);
            if (oppUid) oppUids.add(oppUid);
          }
        });

        setRecentMatches(matches);

        // Fetch opponent usernames & photos
        const oppsFetched: Record<string, UserProfile> = {};
        for (const oId of Array.from(oppUids)) {
          try {
            const snap = await getDoc(doc(db, 'users', oId));
            if (snap.exists()) {
              oppsFetched[oId] = snap.data() as UserProfile;
            }
          } catch (e) {}
        }
        setOpponentProfiles(oppsFetched);
      } catch (err) {
        console.warn("Failed to fetch match history:", err);
      } finally {
        setLoadingMatches(false);
      }
    };
    fetchMatches();
  }, [user]);

  if (!user || !profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] bg-transparent text-slate-400">
        <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        <p className="mt-3 text-xs">Loading profile...</p>
      </div>
    );
  }

  // Handle Photo Save
  const handleSavePhoto = async (photoUrl: string) => {
    if (!photoUrl.trim()) return;
    try {
      await updateCachedProfile({ photoURL: photoUrl.trim() });
      setIsPhotoModalOpen(false);
      setCustomPhotoUrl('');
      setPhotoError('');
    } catch (e: any) {
      setPhotoError(e.message || 'Failed to update profile photo.');
    }
  };

  // Handle Username Save
  const handleSaveUsername = async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setNameError('Username cannot be empty');
      return;
    }
    if (trimmed.length < 3 || trimmed.length > 20) {
      setNameError('Username must be between 3 and 20 characters');
      return;
    }

    const alphaNumericRegex = /^[a-zA-Z0-9]+$/;
    if (!alphaNumericRegex.test(trimmed)) {
      setNameError('Username can only contain alphanumeric letters and numbers');
      return;
    }

    setSavingName(true);
    setNameError('');

    try {
      // Cooldown validation: 1 month (30 days)
      const lastChanged = profile.lastUsernameChangedAt;
      const cooldownMs = 30 * 24 * 60 * 60 * 1000;
      if (lastChanged && (Date.now() - lastChanged < cooldownMs)) {
        setNameError('You can only change your username once a month.');
        setSavingName(false);
        return;
      }

      // Unique check
      const q = query(collection(db, 'users'), where('displayName', '==', trimmed));
      const snap = await getDocs(q);
      let taken = false;
      snap.forEach((docSnap) => {
        if (docSnap.id !== user.uid) taken = true;
      });

      if (taken) {
        setNameError('Username is already taken by another player');
        setSavingName(false);
        return;
      }

      await updateCachedProfile({
        displayName: trimmed,
        lastUsernameChangedAt: Date.now()
      });

      setIsNameModalOpen(false);
    } catch (e: any) {
      setNameError(e.message || 'Failed to update username');
    } finally {
      setSavingName(false);
    }
  };

  const hasNameCooldown = (() => {
    const lastChanged = profile.lastUsernameChangedAt;
    const cooldownMs = 30 * 24 * 60 * 60 * 1000;
    return lastChanged && (Date.now() - lastChanged < cooldownMs);
  })();

  const nextChangeDate = profile.lastUsernameChangedAt 
    ? new Date(profile.lastUsernameChangedAt + 30 * 24 * 60 * 60 * 1000) 
    : null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8 text-left animate-fade-in">
      
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

      {/* Profile Header */}
      <div className="bg-zinc-900 border border-zinc-800 p-6 sm:p-8 rounded-2xl relative shadow-xl">
        <div className="flex flex-col sm:flex-row items-center gap-6 relative z-10">
          
          {/* Avatar Photo Selector */}
          <div className="relative group shrink-0">
            <img
              src={profile.photoURL}
              alt={profile.displayName}
              className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover border border-zinc-800 shadow-xl"
            />
            <button
              onClick={() => {
                setCustomPhotoUrl('');
                setPhotoError('');
                setIsPhotoModalOpen(true);
              }}
              className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer border border-white/10"
              title="Edit Profile Photo"
            >
              <Camera className="w-6 h-6 text-white" />
            </button>
          </div>

          {/* Profile details */}
          <div className="flex-grow space-y-3 text-center sm:text-left">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                <h2 className="text-2xl font-extrabold text-white">{profile.displayName}</h2>
                <button
                  onClick={() => {
                    setNewName(profile.displayName);
                    setNameError('');
                    setIsNameModalOpen(true);
                  }}
                  className="p-1 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer border border-zinc-750"
                  title="Edit Username"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-1.5 text-xs text-slate-400 font-medium">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-violet-400" />
                  <span>Joined {new Date(profile.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}</span>
                </span>
                <span className="text-zinc-700 hidden sm:inline">•</span>
                <span className="flex items-center gap-1 text-slate-300">
                  <Users className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  <span className="font-semibold font-mono">{friendCount} Friend{friendCount !== 1 ? 's' : ''}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Stats and Match History Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        
        {/* Left column: Quick Stats Card */}
        <div className="md:col-span-1 bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider border-b border-zinc-850 pb-2.5">
            Battle Summary
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Wins</span>
              <span className="font-bold text-emerald-400 font-mono">{profile.wins || 0}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Losses</span>
              <span className="font-bold text-red-400 font-mono">{profile.losses || 0}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Draws</span>
              <span className="font-bold text-zinc-400 font-mono">{profile.draws || 0}</span>
            </div>
            <div className="flex items-center justify-between text-xs border-t border-zinc-850 pt-2 font-semibold">
              <span className="text-slate-300">Total Played</span>
              <span className="font-bold text-violet-400 font-mono">{profile.totalGamesPlayed || 0} Matches</span>
            </div>
          </div>
        </div>

        {/* Right column: Recent Games List */}
        <div className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4 text-left">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider border-b border-zinc-850 pb-2.5 flex items-center gap-2">
            <History className="w-4 h-4 text-violet-400" />
            <span>Previous Games</span>
          </h3>

          {loadingMatches ? (
            <div className="py-8 text-center text-xs text-slate-500">
              Loading recent match logs...
            </div>
          ) : recentMatches.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 italic">
              No completed matches found in history. Challenge a friend to play!
            </div>
          ) : (
            <div className="divide-y divide-zinc-850">
              {recentMatches.map((m) => {
                const oppUid = m.players.find((p: string) => p !== user.uid);
                const opponent = opponentProfiles[oppUid] || { displayName: 'Challenger', photoURL: '' };
                
                const isDraw = m.status === 'draw' || !m.winnerUid;
                const won = m.winnerUid === user.uid;

                return (
                  <div key={m.id} className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0">
                    <div className="flex items-center space-x-3 text-left">
                      {opponent.photoURL ? (
                        <img src={opponent.photoURL} alt={opponent.displayName} className="w-8 h-8 rounded-full object-cover border border-zinc-850" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-zinc-950 flex items-center justify-center text-zinc-500 text-xs">
                          <User className="w-4 h-4" />
                        </div>
                      )}
                      <div>
                        <span className="text-xs font-semibold text-white block">
                          vs {opponent.displayName}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          Rollmate Mode • {new Date(m.finishedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      {isDraw ? (
                        <span className="text-[10px] bg-zinc-800 text-zinc-400 font-semibold px-2 py-0.5 rounded uppercase">Draw</span>
                      ) : won ? (
                        <span className="text-[10px] bg-emerald-950/40 text-emerald-400 font-semibold px-2 py-0.5 rounded border border-emerald-500/10 uppercase">Victory</span>
                      ) : (
                        <span className="text-[10px] bg-red-950/40 text-red-400 font-semibold px-2 py-0.5 rounded border border-red-500/10 uppercase">Defeat</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {/* 1. Photo selector Pop Up Modal */}
      {isPhotoModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 z-50 animate-fade-in">
          <div className="bg-zinc-900 border border-zinc-800 max-w-md w-full rounded-2xl shadow-2xl p-6 relative space-y-6 text-left">
            <button
              onClick={() => setIsPhotoModalOpen(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <h3 className="text-lg font-bold text-white">Update Profile Photo</h3>
              <p className="text-xs text-slate-500">Choose from pre-set avatars or paste a custom image URL.</p>
            </div>

            {/* Custom Photo URL Form */}
            <div className="space-y-3">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Custom Image URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Paste direct URL (https://...)"
                  value={customPhotoUrl}
                  onChange={(e) => setCustomPhotoUrl(e.target.value)}
                  className="flex-grow bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-violet-500"
                />
                <button
                  onClick={() => handleSavePhoto(customPhotoUrl)}
                  className="bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors cursor-pointer"
                >
                  Save
                </button>
              </div>
              {photoError && <p className="text-xs text-red-400">{photoError}</p>}
            </div>

            {/* Gallery Upload Option */}
            <div className="space-y-3 pt-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Upload from Gallery / Files</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.size > 700 * 1024) {
                      setPhotoError("Image size exceeds 700KB. Please choose a smaller image.");
                      return;
                    }
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      if (typeof reader.result === 'string') {
                        handleSavePhoto(reader.result);
                      }
                    };
                    reader.readAsDataURL(file);
                  }
                }}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 file:mr-4 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-[11px] file:font-semibold file:bg-zinc-800 file:text-slate-200 hover:file:bg-zinc-700 cursor-pointer"
              />
            </div>

            {/* Chess Avatar Select Grid */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Select Chess Avatar</label>
                <select
                  value={selectedAvatarStyle}
                  onChange={(e) => setSelectedAvatarStyle(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded-md text-[10px] text-slate-300 px-2 py-1 focus:outline-none focus:border-violet-500 font-semibold"
                >
                  {PIECE_STYLES.map((st) => (
                    <option key={st.id} value={st.id}>{st.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-4 gap-3 bg-zinc-950/40 p-4 rounded-xl border border-zinc-850">
                {PIECE_ROLES.map((role) => {
                  const url = `/pieces/${selectedAvatarStyle}/${role.code}.png`;
                  return (
                    <button
                      key={role.code}
                      onClick={() => handleSavePhoto(url)}
                      className="p-1 bg-zinc-950 border border-zinc-800 rounded-xl hover:border-violet-500 hover:bg-zinc-900 transition-all flex items-center justify-center aspect-square shadow cursor-pointer group"
                      title={role.name}
                    >
                      <img src={url} alt={role.name} className="w-10 h-10 object-contain group-hover:scale-110 transition-transform" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Username change Pop Up Modal */}
      {isNameModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 z-50 animate-fade-in">
          <div className="bg-zinc-900 border border-zinc-800 max-w-sm w-full rounded-2xl shadow-2xl p-6 relative space-y-6 text-left">
            <button
              onClick={() => setIsNameModalOpen(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <User className="w-5 h-5 text-violet-400" />
                <span>Change Username</span>
              </h3>
              <p className="text-xs text-slate-500">
                Edit your display name. You can only change your username once a month.
              </p>
            </div>

            {hasNameCooldown && nextChangeDate ? (
              <div className="bg-amber-950/20 border border-amber-500/10 rounded-xl p-4 space-y-2">
                <div className="flex items-center space-x-2 text-amber-400 font-semibold text-xs">
                  <Lock className="w-4 h-4 animate-pulse" />
                  <span>Username Locked</span>
                </div>
                <p className="text-xs text-slate-300">
                  You updated your username recently. The change cooldown limits edits to once every 30 days.
                </p>
                <p className="text-[10px] text-slate-500">
                  Available again on: {nextChangeDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
                <button
                  onClick={() => setIsNameModalOpen(false)}
                  className="w-full mt-2 bg-zinc-800 hover:bg-zinc-700 text-slate-200 text-xs font-semibold py-2.5 rounded-lg cursor-pointer transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">New Username</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      setNameError('');
                    }}
                    placeholder="Enter unique username..."
                    maxLength={20}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500"
                  />
                  {nameError && <p className="text-[11px] text-red-400 font-semibold">{nameError}</p>}
                </div>

                <div className="flex items-center space-x-2 pt-2">
                  <button
                    onClick={() => setIsNameModalOpen(false)}
                    className="flex-1 bg-zinc-850 hover:bg-zinc-800 text-slate-300 border border-zinc-800 py-2.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveUsername}
                    disabled={savingName || !newName.trim()}
                    className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white py-2.5 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 transition-all"
                  >
                    {savingName ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};
