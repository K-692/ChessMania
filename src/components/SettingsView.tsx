import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Music, ArrowLeft, Eye, Check, Palette, HelpCircle, Send, X, AlertTriangle } from 'lucide-react';
import { getSoundSettings, updateSoundSettings } from '../utils/sound';
import { useAuth } from '../auth/AuthContext';
import { db } from '../firebase';
import { collection, addDoc, doc, getDoc } from 'firebase/firestore';

interface SettingsViewProps {
  onBack: () => void;
}

const BOARD_THEMES = [
  '8_BIT', 'BASES', 'BLUE', 'BROWN', 'BUBBLEGUM', 'BURLED_WOOD', 'DARK_WOOD', 'DASH', 'GLASS', 'GRAFFITI', 'GREEN', 'ICY_SEA', 'LIGHT', 'LOLZ', 'MARBLE', 'METAL', 'NEON', 'NEWSPAPER', 'ORANGE', 'OVERLAY', 'PARCHMENT', 'PURPLE', 'RED', 'SAND', 'SKY', 'STONE', 'TAN', 'TOURNAMENT', 'TRANSLUCENT', 'WALNUT'
];

const PIECE_THEMES = [
  '3D_CHESSKID', '3D_PLASTIC', '3D_STAUNTON', '3D_WOOD', '8_BIT', 'ALPHA', 'BASES', 'BLINDFOLD', 'BOOK', 'BUBBLEGUM', 'CASES', 'CLASSIC', 'CLUB', 'CONDAL', 'DASH', 'GAME_ROOM', 'GLASS', 'GOTHIC', 'GRAFFITI', 'ICY_SEA', 'LIGHT', 'LOLZ', 'MARBLE', 'MAYA', 'METAL', 'MODERN', 'NATURE', 'NEO', 'NEO_WOOD', 'NEON', 'NEWSPAPER', 'OCEAN', 'SKY', 'SPACE', 'TIGERS', 'TOURNAMENT', 'VINTAGE', 'WOOD'
];

export const SettingsView: React.FC<SettingsViewProps> = ({ onBack }) => {
  const [settings, setSettings] = useState(getSoundSettings());
  const { user } = useAuth();
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<boolean | null>(null);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    // Sync external changes (e.g. if muted from landing page)
    const interval = setInterval(() => {
      setSettings(getSoundSettings());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const musicVolume = parseFloat(e.target.value);
    const newMuted = musicVolume === 0 ? true : settings.muted;
    const updated = { musicVolume, muted: newMuted };
    setSettings(prev => ({ ...prev, ...updated }));
    updateSoundSettings(updated);
  };

  const handleToggleEffects = () => {
    const effectsEnabled = !settings.effectsEnabled;
    setSettings(prev => ({ ...prev, effectsEnabled }));
    updateSoundSettings({ effectsEnabled });
  };

  const handleToggleMute = () => {
    const muted = !settings.muted;
    setSettings(prev => ({ ...prev, muted }));
    updateSoundSettings({ muted });
  };

  const handleToggleLegalMoves = () => {
    const showLegalMoves = !settings.showLegalMoves;
    setSettings(prev => ({ ...prev, showLegalMoves }));
    updateSoundSettings({ showLegalMoves });
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-8 text-left animate-fade-in">
      <div className="flex items-center space-x-4">
        <button
          onClick={onBack}
          className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-all border border-white/5 cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-3xl font-extrabold tracking-wide text-white">
            Game Settings
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Customize audio preferences and game experience
          </p>
        </div>
      </div>

      <div className="glass rounded-2xl border border-white/10 divide-y divide-white/5 overflow-hidden shadow-2xl">
        {/* Row 1: Theme Music Volume Setting */}
        <div className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:bg-white/[0.01] transition-colors">
          <div className="flex items-center space-x-4">
            <div className="p-2.5 bg-violet-500/10 rounded-xl border border-violet-500/20 text-violet-400 shrink-0">
              <Music className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-200">Theme Music</h4>
              <p className="text-xs text-slate-500">Looping cinematic background soundtrack</p>
            </div>
          </div>

          <div className="flex items-center space-x-4 w-full md:w-auto md:justify-end">
            <div className="flex items-center space-x-3 w-full md:w-48">
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={settings.musicVolume}
                onChange={handleVolumeChange}
                className="w-full accent-violet-500 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-xs text-slate-400 font-mono w-8 text-right shrink-0">
                {Math.round(settings.musicVolume * 100)}%
              </span>
            </div>
            <button
              onClick={handleToggleMute}
              className={`p-2.5 rounded-xl border transition-all cursor-pointer shrink-0 ${
                settings.muted
                  ? 'border-red-500/30 bg-red-500/10 text-red-400'
                  : 'border-white/5 bg-slate-900/60 text-slate-400 hover:text-white hover:bg-white/5'
              }`}
              title={settings.muted ? "Unmute All" : "Mute All"}
            >
              {settings.muted ? <VolumeX className="w-4.5 h-4.5" /> : <Volume2 className="w-4.5 h-4.5" />}
            </button>
          </div>
        </div>

        {/* Row 2: Sound Effects Checkbox Setting */}
        <div className="p-6 flex items-center justify-between gap-6 hover:bg-white/[0.01] transition-colors">
          <div className="flex items-center space-x-4">
            <div className="p-2.5 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400 shrink-0">
              <Volume2 className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-200">Sound Effects</h4>
              <p className="text-xs text-slate-500">Board moves, captures, check warnings, and click feedback</p>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={settings.effectsEnabled}
              onChange={handleToggleEffects}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600 peer-checked:after:bg-white peer-checked:after:border-white"></div>
          </label>
        </div>

        {/* Row 3: Show Legal Moves Toggle Setting */}
        <div className="p-6 flex items-center justify-between gap-6 hover:bg-white/[0.01] transition-colors">
          <div className="flex items-center space-x-4">
            <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400 shrink-0">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-200">Legal Moves Hint</h4>
              <p className="text-xs text-slate-500">Show available legal moves as dots on the board when selecting a piece</p>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={!!settings.showLegalMoves}
              onChange={handleToggleLegalMoves}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600 peer-checked:after:bg-white peer-checked:after:border-white"></div>
          </label>
        </div>

        {/* Row 4: Board Theme Selection */}
        <div className="p-6 space-y-4 hover:bg-white/[0.01] transition-colors">
          <div className="flex items-center space-x-4">
            <div className="p-2.5 bg-pink-500/10 rounded-xl border border-pink-500/20 text-pink-400 shrink-0">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-200">Board Theme</h4>
              <p className="text-xs text-slate-500">Customize the background design of the chessboard</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-2 max-h-[300px] overflow-y-auto pr-2 scrollbar-thin">
            {BOARD_THEMES.map((theme) => {
              const key = theme.toLowerCase();
              const isActive = settings.boardTheme === key;
              return (
                <button
                  key={key}
                  onClick={() => {
                    updateSoundSettings({ boardTheme: key });
                    setSettings(s => ({ ...s, boardTheme: key }));
                  }}
                  className={`flex flex-col items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer text-center relative overflow-hidden ${
                    isActive
                      ? 'border-violet-500 bg-violet-500/15 text-white font-bold ring-2 ring-violet-500/55'
                      : 'border-white/5 bg-slate-900/40 hover:bg-slate-900/60 text-slate-300'
                  }`}
                >
                  {/* Board background preview */}
                  <div 
                    className="w-full aspect-square rounded-lg border border-white/10 shrink-0 select-none shadow-md mb-2 bg-cover bg-center"
                    style={{ backgroundImage: `url('/boards/${key}.png')` }}
                  />
                  <span className="text-[10px] font-bold text-slate-200 flex items-center justify-center gap-1.5 w-full truncate">
                    <span>{theme.replace('_', ' ')}</span>
                    {isActive && <Check className="w-3.5 h-3.5 text-violet-400 shrink-0" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 5: Chess Piece Style Selection */}
        <div className="p-6 space-y-4 hover:bg-white/[0.01] transition-colors border-t border-white/5">
          <div className="flex items-center space-x-4">
            <div className="p-2.5 bg-violet-500/10 rounded-xl border border-violet-500/20 text-violet-400 shrink-0 flex items-center justify-center">
              <img src={`/pieces/${settings.pieceTheme || 'classic'}/wn.png`} alt="Knight" className="w-5 h-5 object-contain" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-200">Chess Piece Style</h4>
              <p className="text-xs text-slate-500">Customize the design style of the chess pieces</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-2 max-h-[300px] overflow-y-auto pr-2 scrollbar-thin">
            {PIECE_THEMES.map((theme) => {
              const key = theme.toLowerCase();
              const isActive = (settings.pieceTheme || 'classic') === key;
              return (
                <button
                  key={key}
                  onClick={() => {
                    updateSoundSettings({ pieceTheme: key });
                    setSettings(s => ({ ...s, pieceTheme: key }));
                  }}
                  className={`flex flex-col items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer text-center relative overflow-hidden ${
                    isActive
                      ? 'border-violet-500 bg-violet-500/15 text-white font-bold ring-2 ring-violet-500/55'
                      : 'border-white/5 bg-slate-900/40 hover:bg-slate-900/60 text-slate-300'
                  }`}
                >
                  {/* Knight Piece design preview */}
                  <div className="w-full aspect-square rounded-lg bg-slate-950/40 border border-white/5 flex items-center justify-center p-2 mb-2">
                    <img 
                      src={`/pieces/${key}/wn.png`} 
                      alt="White Knight" 
                      className="w-full h-full object-contain filter drop-shadow-[0px_2px_4px_rgba(0,0,0,0.5)]" 
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/pieces/classic/wn.png';
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-slate-200 flex items-center justify-center gap-1.5 w-full truncate">
                    <span>{theme.replace(/_/g, ' ')}</span>
                    {isActive && <Check className="w-3.5 h-3.5 text-violet-400 shrink-0" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Support Section */}
        <div className="p-6 space-y-4 hover:bg-white/[0.01] transition-colors border-t border-white/5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-4">
              <div className="p-2.5 bg-amber-500/10 rounded-xl border border-amber-500/20 text-amber-400 shrink-0">
                <HelpCircle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-200">Facing any issue? Report us.</h4>
                <p className="text-xs text-slate-500">Need help or want to report a bug? Send us a ticket.</p>
              </div>
            </div>
            <button
              onClick={() => {
                setQueryText('');
                setSubmitSuccess(null);
                setSubmitError('');
                setIsReportModalOpen(true);
              }}
              className="px-4 py-2 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white rounded-xl text-xs font-bold transition-all shadow-lg border border-amber-500/25 cursor-pointer self-start sm:self-auto"
            >
              Report an Issue
            </button>
          </div>
        </div>
      </div>

      {/* Report Issue Pop Up Modal */}
      {isReportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="glass max-w-lg w-full rounded-2xl border border-white/10 p-6 shadow-2xl relative space-y-6 text-left animate-fade-in">
            <button
              onClick={() => setIsReportModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-2">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-amber-400" />
                <span>Report an Issue / Query</span>
              </h3>
              <p className="text-xs text-slate-400">
                Describe the problem or query you are experiencing. Our support team will review this.
              </p>
            </div>

            {submitSuccess ? (
              <div className="bg-emerald-950/20 border border-emerald-500/10 rounded-xl p-4 text-center space-y-3">
                <p className="text-sm font-semibold text-emerald-400">Query Submitted Successfully!</p>
                <p className="text-xs text-slate-300">
                  Thank you for reporting. Your query has been logged securely under your account. We will review it shortly.
                </p>
                <button
                  onClick={() => setIsReportModalOpen(false)}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold py-2.5 rounded-lg transition-all cursor-pointer"
                >
                  Close
                </button>
              </div>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!queryText.trim()) return;
                  if (!user) {
                    setSubmitError('You must be signed in to submit queries.');
                    return;
                  }

                  setIsSubmitting(true);
                  setSubmitError('');
                  try {
                    // 1. Add support query log
                    await addDoc(collection(db, 'supportQueries'), {
                      uid: user.uid,
                      email: user.email || 'unknown@gmail.com',
                      query: queryText.trim(),
                      createdAt: Date.now()
                    });

                    // 2. Fetch admin email from /config/support
                    let adminEmail = 'developer@checkmate.com'; // fallback placeholder
                    try {
                      const configDoc = await getDoc(doc(db, 'config', 'support'));
                      if (configDoc.exists() && configDoc.data().adminEmail) {
                        adminEmail = configDoc.data().adminEmail;
                      }
                    } catch (configErr) {
                      console.warn("Could not read support config document:", configErr);
                    }

                    // 3. Write mail triggers to /mail
                    const mailCol = collection(db, 'mail');
                    
                    // User notification
                    await addDoc(mailCol, {
                      to: user.email || 'unknown@gmail.com',
                      message: {
                        subject: '[Check & Mate Support] Ticket Submitted Successfully',
                        html: `
                          <div style="font-family: sans-serif; padding: 20px; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                            <h2 style="color: #6d28d9; margin-bottom: 20px;">Support Ticket Received</h2>
                            <p>Hello ${user.displayName || 'Player'},</p>
                            <p>Thank you for reaching out. We have logged your query and our team will get back to you shortly.</p>
                            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
                            <p><strong>Your Submitted Ticket:</strong></p>
                            <div style="background-color: #f8fafc; padding: 15px; border-left: 4px solid #6d28d9; font-style: italic; margin-bottom: 20px; white-space: pre-wrap;">
                              ${queryText.trim()}
                            </div>
                            <p style="font-size: 12px; color: #64748b;">This is an automated confirmation of receipt. Please do not reply directly to this mail.</p>
                          </div>
                        `
                      }
                    });

                    // Admin notification
                    await addDoc(mailCol, {
                      to: adminEmail,
                      message: {
                        subject: `[Check & Mate Admin] Support Query from ${user.displayName || 'Player'}`,
                        html: `
                          <div style="font-family: sans-serif; padding: 20px; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                            <h2 style="color: #ea580c; margin-bottom: 20px;">New Support Ticket Received</h2>
                            <p><strong>Player Details:</strong></p>
                            <ul style="list-style: none; padding-left: 0;">
                              <li><strong>Name:</strong> ${user.displayName || 'N/A'}</li>
                              <li><strong>Email:</strong> ${user.email || 'N/A'}</li>
                              <li><strong>UID:</strong> ${user.uid}</li>
                            </ul>
                            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
                            <p><strong>Query:</strong></p>
                            <div style="background-color: #f8fafc; padding: 15px; border-left: 4px solid #ea580c; font-style: italic; margin-bottom: 20px; white-space: pre-wrap;">
                              ${queryText.trim()}
                            </div>
                          </div>
                        `
                      }
                    });

                    setSubmitSuccess(true);
                  } catch (err: any) {
                    console.error('Error saving support query:', err);
                    setSubmitError(err.message || 'Failed to submit query. Please try again.');
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                    Submitter Email
                  </label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={user?.email || 'Not logged in'}
                    className="w-full bg-slate-900/60 border border-white/5 rounded-xl px-4 py-3 text-sm text-slate-400 font-mono outline-none"
                  />
                  <p className="text-[10px] text-slate-500">
                    Query will be registered under your Google Account email.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                    Describe your issue / query
                  </label>
                  <textarea
                    value={queryText}
                    onChange={(e) => setQueryText(e.target.value)}
                    required
                    placeholder="Provide details about the issue you are facing..."
                    rows={5}
                    maxLength={1000}
                    className="w-full bg-slate-900/60 border border-white/10 focus:border-amber-500/50 rounded-xl px-4 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-amber-500/50 transition-all font-sans resize-none"
                  />
                  <div className="text-[10px] text-slate-500 flex justify-between">
                    <span>Max 1000 characters</span>
                    <span>{queryText.length}/1000</span>
                  </div>
                </div>

                {submitError && (
                  <div className="flex items-center gap-2 bg-red-950/20 border border-red-500/10 rounded-xl p-3 text-xs text-red-400">
                    <AlertTriangle className="w-4 h-4 shrink-0 animate-pulse" />
                    <span>{submitError}</span>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsReportModalOpen(false)}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold py-3 rounded-xl transition-all border border-white/5 cursor-pointer text-center"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !queryText.trim()}
                    className="flex-1 flex items-center justify-center space-x-2 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 disabled:opacity-50 text-white text-xs font-semibold py-3 rounded-xl transition-all border border-amber-500/20 cursor-pointer shadow-lg shadow-amber-500/10"
                  >
                    {isSubmitting ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Submit Ticket</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
