import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { Play, Settings, Video, Bird, Users, Briefcase, Zap, Terminal, FileVideo, Image as ImageIcon, Loader2, CheckCircle, Pencil, FolderOpen, X, Copy, Plus, Check } from 'lucide-react';

const API = 'http://127.0.0.1:15001';
const DRAFT_SESSION_KEY = '__draft__';
const VOICE_OPTIONS = ['Jasper', 'Luna', 'Milo', 'Ava', 'Emma'];
const SCRIPT_LANGUAGE_OPTIONS = [
  { value: 'english', label: 'English' },
  { value: 'vietnamese', label: 'Vietnamese' },
] as const;
const LANGUAGE_VOICE_MAP: Record<string, string[]> = {
  vietnamese: ['Jasper', 'Milo', 'Luna'],
  english: ['Luna', 'Ava', 'Emma'],
};
const GENERATION_STEPS = [
  { id: 'script', label: 'Script Setup', icon: '📝' },
  { id: 'images', label: 'Generate Images', icon: '🖼️' },
  { id: 'tts', label: 'Generate Audio', icon: '🎵' },
  { id: 'subtitles', label: 'Generate Subtitles', icon: '📄' },
  { id: 'video_generated', label: 'Compose Video', icon: '🎬' },
  { id: 'ready_for_review', label: 'Ready for Review', icon: '✅' },
  { id: 'published', label: 'Published', icon: '🚀' },
] as const;
const REGENERATE_STEP_OPTIONS = GENERATION_STEPS.filter((step) => step.id !== 'published');

type ActiveTab = 'youtube' | 'twitter' | 'affiliate' | 'outreach' | 'settings';
type ReloadMode = 'auto' | '5s' | '15s' | '30s' | 'off';

interface SystemStatus {
  first_time_running?: boolean;
  options?: unknown[];
  youtube_options?: unknown[];
  twitter_options?: unknown[];
}

interface GalleryItem {
  name: string;
  url: string;
  type: 'video' | 'image';
  created_at?: number;
}

interface SessionSummary {
  session_id: string;
  name?: string;
  stage?: string;
}

interface SessionData extends SessionSummary {
  subject?: string;
  script?: string;
  script_prompt?: string;
  script_output?: string;
  tts_text?: string;
  subtitle_preview?: string;
  voice_used?: string;
  english_cc_bottom?: boolean;
  topic_prompt?: string;
  topic_output?: string;
  metadata_title_prompt?: string;
  metadata_description_prompt?: string;
  image_prompt_request?: string;
  image_prompt_raw_response?: string;
  image_prompts?: string[];
}

interface YouTubeAccount {
  id: string;
  nickname: string;
  niche: string;
}

interface LogEntry {
  ts: string;
  level: string;
  message: string;
}

interface SessionItemProps {
  session: SessionSummary;
  isActive: boolean;
  onClick: () => void;
  onRename: (name: string) => Promise<void>;
}

interface NavItemProps {
  icon: ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
  color: 'cyan' | 'blue' | 'purple' | 'green';
}

interface PremiumCardProps {
  children: ReactNode;
  className?: string;
}

interface NeonButtonProps {
  children: ReactNode;
  onClick: () => void;
  isLoading: boolean;
  icon: ReactNode;
  disabled?: boolean;
}

const getSessionLabel = (session: SessionSummary): string => session.name || session.session_id.slice(0, 6);

const mapStageToProgressStep = (stage: string): string => {
  const normalized = String(stage || '').trim().toLowerCase();
  if (!normalized) return '';

  const stageMap: Record<string, string> = {
    init: 'script',
    subject_set: 'script',
    topic: 'script',
    script_set: 'script',
    script: 'script',
    metadata: 'images',
    prompts: 'images',
    images: 'images',
    tts: 'tts',
    subtitles: 'subtitles',
    video_generated: 'video_generated',
    ready_for_review: 'ready_for_review',
    publish_failed: 'ready_for_review',
    published: 'published',
    failed: 'video_generated',
  };

  return stageMap[normalized] || normalized;
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('youtube');
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [selectedGalleryImages, setSelectedGalleryImages] = useState<string[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaError, setMediaError] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string>(''); // '' = all
  const [creatingSession, setCreatingSession] = useState(false);
  const [showCreateSessionModal, setShowCreateSessionModal] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([
    { ts: new Date().toLocaleTimeString('en-GB'), level: 'info', message: '⚡ System initialization complete.' },
    { ts: new Date().toLocaleTimeString('en-GB'), level: 'info', message: '🔗 Connecting to Uvicorn Backend on 127.0.0.1:15001...' },
  ]);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [autoReloadMode, setAutoReloadMode] = useState<ReloadMode>('5s');
  const consoleRef = useRef<HTMLDivElement>(null);
  const mediaBootstrappedRef = useRef(false);
    const resolveReloadIntervalMs = (mode: ReloadMode): number => {
      if (mode === 'auto') return 3000;
      if (mode === '5s') return 5000;
      if (mode === '15s') return 15000;
      if (mode === '30s') return 30000;
      return 0;
    };

    const reloadIntervalMs = resolveReloadIntervalMs(autoReloadMode);

  const newSessionInputRef = useRef<HTMLInputElement>(null);
  const createSessionInFlightRef = useRef(false);

  const copyLogsToClipboard = async () => {
    const logText = logs.map((log) => `${log.ts} [${log.level}] ${log.message}`).join('\n');
    if (!logText.trim()) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(logText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = logText;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 1600);
    } catch {
      setLogs(prev => [...prev.slice(-199), {
        ts: new Date().toLocaleTimeString('en-GB'),
        level: 'warning',
        message: '⚠️ Unable to copy logs. Please check browser clipboard permissions.',
      }]);
    }
  };

  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (showCreateSessionModal) {
      setTimeout(() => newSessionInputRef.current?.focus(), 0);
    }
  }, [showCreateSessionModal]);

  useEffect(() => {
    fetch(`${API}/system/status`)
      .then((r) => {
        if (!r.ok) {
          throw new Error(`Status request failed (${r.status})`);
        }
        return r.json();
      })
      .then((data: SystemStatus) => {
        setStatus(data);
        setStatusError('');
      })
      .catch((err) => {
        setStatus(null);
        setStatusError(getErrorMessage(err, 'Cannot reach backend status endpoint.'));
      })
      .finally(() => setStatusLoading(false));

    // SSE live log stream
    const es = new EventSource(`${API}/system/logs/stream`);
    es.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data) as LogEntry;
        if (entry.level === 'ping') return;
        setLogs(prev => [...prev.slice(-199), entry]);
      } catch {
        return;
      }
    };
    es.onerror = () => setLogs(prev => [...prev, { ts: new Date().toLocaleTimeString('en-GB'), level: 'warning', message: '⚠️ Log stream disconnected. Retrying...' }]);

    return () => { es.close(); };
  }, []);

  // Keep gallery/sessions in sync and respect current filter mode (All vs selected session).
  useEffect(() => {
    mediaBootstrappedRef.current = false;

    const tick = () => {
      if (!mediaBootstrappedRef.current) {
        setMediaLoading(true);
        setMediaError('');
      }

      const galleryUrl = activeSessionId
        ? `${API}/system/gallery?session_id=${activeSessionId}`
        : `${API}/system/gallery`;
      Promise.all([
        fetch(galleryUrl).then((r) => {
          if (!r.ok) throw new Error(`Gallery request failed (${r.status})`);
          return r.json() as Promise<GalleryItem[]>;
        }),
        fetch(`${API}/system/sessions`).then((r) => {
          if (!r.ok) throw new Error(`Sessions request failed (${r.status})`);
          return r.json() as Promise<SessionSummary[]>;
        }),
      ])
        .then(([galleryData, sessionsData]) => {
          setGallery(galleryData || []);
          setSessions(sessionsData || []);
          setMediaError('');
          mediaBootstrappedRef.current = true;
        })
        .catch((err) => {
          setMediaError(getErrorMessage(err, 'Unable to load media and sessions.'));
        })
        .finally(() => {
          setMediaLoading(false);
        });
    };

    tick();
    if (reloadIntervalMs <= 0) return;
    const interval = setInterval(tick, reloadIntervalMs);
    return () => clearInterval(interval);
  }, [activeSessionId, reloadIntervalMs]);

  useEffect(() => {
    setSelectedGalleryImages((prev) => prev.filter((url) => gallery.some((item) => item.url === url && item.type === 'image')));
  }, [gallery]);

  const handleRenameSession = async (sessionId: string, newName: string) => {
    const res = await fetch(`${API}/system/sessions/${sessionId}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) throw new Error('Rename failed');
    setSessions(prev => prev.map(s => s.session_id === sessionId ? { ...s, name: newName } : s));
  };

  const handleOpenCreateSessionModal = () => {
    if (creatingSession) return;
    setNewSessionName('');
    setShowCreateSessionModal(true);
  };

  const handleCloseCreateSessionModal = () => {
    if (creatingSession) return;
    setShowCreateSessionModal(false);
    setNewSessionName('');
  };

  const handleCreateSession = async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName || creatingSession || createSessionInFlightRef.current) return;

    createSessionInFlightRef.current = true;
    setCreatingSession(true);
    try {
      const res = await fetch(`${API}/system/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      });
      if (!res.ok) throw new Error('Create session failed');
      const created = await res.json();
      setSessions(prev => [created, ...prev]);
      setActiveSessionId(created.session_id);
      setShowCreateSessionModal(false);
      setNewSessionName('');
    } catch {
      setLogs(prev => [...prev.slice(-199), {
        ts: new Date().toLocaleTimeString('en-GB'),
        level: 'error',
        message: '❌ Unable to create new session.',
      }]);
    } finally {
      setCreatingSession(false);
      createSessionInFlightRef.current = false;
    }
  };

  const activeSession = sessions.find(s => s.session_id === activeSessionId);

  return (
    <div className="flex h-screen bg-[#020617] text-slate-300 overflow-hidden font-sans selection:bg-cyan-500/30">
      
      {/* 1. SIDEBAR */}
      <aside className="w-20 lg:w-64 flex flex-col border-r border-white/5 bg-slate-900/20 backdrop-blur-xl shrink-0 z-20">
        <div className="h-20 flex items-center justify-center lg:justify-start lg:px-6 border-b border-white/5">
          <div className="relative group">
            <div className="absolute -inset-2 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full blur opacity-40 group-hover:opacity-75 transition duration-500"></div>
            <Zap className="relative text-white w-8 h-8 drop-shadow-lg" />
          </div>
          <span className="ml-3 text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent hidden lg:block tracking-tight">
            MP Hub<span className="text-cyan-400 text-xs ml-1 font-black align-top">V2</span>
          </span>
        </div>
        
        <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto custom-scrollbar">
          <NavItem icon={<Video />} label="YouTube Shorts" isActive={activeTab === 'youtube'} onClick={() => setActiveTab('youtube')} color="cyan" />
          <NavItem icon={<Bird />} label="Twitter Bot" isActive={activeTab === 'twitter'} onClick={() => setActiveTab('twitter')} color="blue" />
          <NavItem icon={<Briefcase />} label="Affiliate CRM" isActive={activeTab === 'affiliate'} onClick={() => setActiveTab('affiliate')} color="purple" />
          <NavItem icon={<Users />} label="Outreach AI" isActive={activeTab === 'outreach'} onClick={() => setActiveTab('outreach')} color="green" />

          {/* ── SESSION SELECTOR ── */}
          <div className="mt-4 pt-4 border-t border-white/5">
              <div className="px-3 mb-2 hidden lg:flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-widest text-slate-600 font-bold">
                  <FolderOpen className="inline w-3 h-3 mr-1" />Sessions
                </p>
                <button
                  onClick={handleOpenCreateSessionModal}
                  disabled={creatingSession}
                  className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-cyan-500/30 text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-60"
                  title="Add new session"
                >
                  <Plus className="w-3 h-3" />
                  {creatingSession ? 'Adding...' : 'Add'}
                </button>
              </div>
              <button
                onClick={handleOpenCreateSessionModal}
                disabled={creatingSession}
                className="lg:hidden w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 mb-1 disabled:opacity-60"
              >
                <Plus className="w-3.5 h-3.5" />
                {creatingSession ? 'Adding...' : 'New Session'}
              </button>
              {/* "All" option */}
              <button
                onClick={() => setActiveSessionId('')}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all mb-1
                  ${activeSessionId === '' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
              >
                <span className="hidden lg:block">All Sessions</span>
                <span className="lg:hidden text-[10px]">ALL</span>
              </button>

              {sessions.map((s) => (
                <SessionItem
                  key={s.session_id}
                  session={s}
                  isActive={activeSessionId === s.session_id}
                  onClick={() => setActiveSessionId(s.session_id)}
                  onRename={(name) => handleRenameSession(s.session_id, name)}
                />
              ))}
          </div>
        </nav>

        <div className="p-4 border-t border-white/5">
          <button
            onClick={() => setActiveTab('settings')}
            className={`w-full mb-2 flex items-center justify-center lg:justify-start lg:px-3 py-2 rounded-xl border transition-all ${
              activeTab === 'settings'
                ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                : 'border-white/10 text-slate-300 hover:bg-white/5'
            }`}
            title="Open global settings"
          >
            <Settings className="w-4 h-4" />
            <span className="ml-2 text-xs font-semibold hidden lg:block uppercase tracking-wider">Settings</span>
          </button>
          <div className={`flex items-center justify-center lg:justify-start lg:px-3 py-2 rounded-xl bg-black/20 border ${statusLoading ? 'border-amber-500/20' : status ? 'border-cyan-500/20' : 'border-red-500/20'} backdrop-blur-md`}>
            <div className="relative flex h-3 w-3">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusLoading ? 'bg-amber-400' : status ? 'bg-cyan-400' : 'bg-red-400'}`}></span>
              <span className={`relative inline-flex rounded-full h-3 w-3 ${statusLoading ? 'bg-amber-500' : status ? 'bg-cyan-500' : 'bg-red-500'}`}></span>
            </div>
            <span className="ml-3 text-xs font-semibold text-slate-300 hidden lg:block uppercase tracking-wider">
              {statusLoading ? 'Connecting...' : status ? 'API Connected' : 'No Connection'}
            </span>
          </div>
          {statusError && (
            <p className="mt-2 text-[10px] text-red-300 hidden lg:block">{statusError}</p>
          )}
        </div>
      </aside>

      {/* 2. MAIN WORKSPACE */}
      <main className="flex-1 flex flex-col lg:flex-row h-full overflow-hidden relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-gradient-to-tr from-cyan-500/10 to-purple-500/10 rounded-full blur-[120px] pointer-events-none"></div>

        {/* LEFT PANE */}
        <section className="flex-[4] h-full overflow-y-auto p-6 lg:p-10 border-r border-white/5 relative z-10 custom-scrollbar">
          <header className="mb-8">
            <h2 className="text-3xl font-extrabold text-white capitalize tracking-tight flex items-center gap-3">
              {activeTab.replace('-', ' ')} <span className="px-3 py-1 bg-white/10 text-sm font-medium rounded-full text-slate-300">Workspace</span>
            </h2>
            {activeSession && (
              <p className="text-slate-400 mt-1 text-sm flex items-center gap-1">
                <FolderOpen className="w-3.5 h-3.5 text-cyan-500" />
                Session: <span className="text-cyan-400 font-semibold ml-1">{activeSession.name}</span>
                <span className="text-slate-600 ml-1">• {activeSession.stage}</span>
              </p>
            )}
            <p className="text-slate-400 mt-2 text-lg">Configure your automated generation pipelines easily.</p>
          </header>

          <div className="animate-fade-in-up">
            {activeTab === 'youtube' && (
              <YouTubeWorkspace
                activeSessionId={activeSessionId}
                reloadIntervalMs={reloadIntervalMs}
                selectedGalleryImages={selectedGalleryImages}
                clearSelectedGalleryImages={() => setSelectedGalleryImages([])}
              />
            )}
            {activeTab === 'settings' && <ConfigWorkspace />}
            {activeTab !== 'youtube' && activeTab !== 'settings' && (
              <div className="space-y-4">
                <PremiumCard className="p-6 border-cyan-500/20">
                  <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2"><Settings className="w-4 h-4 text-cyan-400" /> Platform Config</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Connection</p>
                      <p className="text-slate-300">Prepare account/API links for {activeTab}.</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Push Mode</p>
                      <p className="text-slate-300">Auto push or manual review before publish.</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Publish Config</p>
                      <p className="text-slate-300">Fields like title, audience, visibility and tags.</p>
                    </div>
                  </div>
                </PremiumCard>

                <PremiumCard className="flex flex-col items-center justify-center py-16 text-center border-dashed border-slate-700/50">
                  <Settings className="w-16 h-16 text-slate-600 mb-4 animate-[spin_10s_linear_infinite]" />
                  <h3 className="text-xl font-bold text-slate-300 mb-2">Module is calibrating</h3>
                  <p className="text-slate-500">The {activeTab} workspace is being upgraded to include full config and execution flow.</p>
                </PremiumCard>
              </div>
            )}
          </div>
        </section>

        {/* RIGHT PANE */}
        <section className="flex-[3] h-full flex flex-col bg-black/40 backdrop-blur-2xl relative z-10">
          
          {/* Media Engine */}
          <div className="flex-[4] p-5 border-b border-white/5 flex flex-col relative overflow-hidden">
            <div className="flex items-center gap-2 mb-3">
              <FileVideo className="w-4 h-4 text-purple-400" />
              <h3 className="font-bold text-slate-200 uppercase tracking-widest text-xs">Media Engine</h3>
              <div className="ml-2">
                <select
                  value={activeSessionId}
                  onChange={(e) => setActiveSessionId(e.target.value)}
                  className="bg-slate-900/70 border border-white/10 text-slate-300 text-[11px] rounded-lg px-2 py-1 focus:outline-none focus:border-cyan-500/40"
                  title="Filter media by session"
                >
                  <option value="">All</option>
                  {sessions.map((s) => (
                    <option key={s.session_id} value={s.session_id}>
                      {getSessionLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ml-1">
                <select
                  value={autoReloadMode}
                  onChange={(e) => setAutoReloadMode(e.target.value as 'auto' | '5s' | '15s' | '30s' | 'off')}
                  className="bg-slate-900/70 border border-white/10 text-slate-300 text-[11px] rounded-lg px-2 py-1 focus:outline-none focus:border-cyan-500/40"
                  title="Auto reload interval"
                >
                  <option value="auto">Auto</option>
                  <option value="5s">5s</option>
                  <option value="15s">15s</option>
                  <option value="30s">30s</option>
                  <option value="off">Off</option>
                </select>
              </div>
              {gallery.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-[10px] font-bold">{gallery.length}</span>
              )}
              {selectedGalleryImages.length > 0 && (
                <button
                  onClick={() => setSelectedGalleryImages([])}
                  className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold"
                  title="Clear selected custom images"
                >
                  Selected {selectedGalleryImages.length}
                </button>
              )}
              {activeSession && (
                <span className="ml-auto text-[10px] text-slate-500 hidden lg:block truncate max-w-[100px]" title={activeSession.name}>
                  📁 {activeSession.name}
                </span>
              )}
            </div>

            {mediaLoading && (
              <div className="mb-3 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading gallery and sessions...
              </div>
            )}

            {mediaError && (
              <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {mediaError}
              </div>
            )}
            
            {gallery.length > 0 ? (
              <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-3">
                {/* Featured latest */}
                <div className="w-full max-w-[180px] mx-auto aspect-[9/16] bg-black rounded-2xl overflow-hidden shadow-2xl border border-white/10 relative shrink-0">
                  <button
                    type="button"
                    disabled={gallery[0].type !== 'image'}
                    onClick={() => {
                      if (gallery[0].type !== 'image') return;
                      setSelectedGalleryImages((prev) =>
                        prev.includes(gallery[0].url) ? prev.filter((u) => u !== gallery[0].url) : [...prev, gallery[0].url]
                      );
                    }}
                    className={`w-full h-full ${gallery[0].type === 'image' ? 'cursor-pointer' : 'cursor-default'}`}
                    title={gallery[0].type === 'image' ? 'Toggle this image for custom step' : 'Video preview'}
                  >
                    {gallery[0].type === 'video' ? (
                      <video src={`${API}${gallery[0].url}`} autoPlay loop muted className="w-full h-full object-cover" />
                    ) : (
                      <img src={`${API}${gallery[0].url}`} className="w-full h-full object-cover" alt={gallery[0].name} />
                    )}
                  </button>
                  {gallery[0].type === 'image' && selectedGalleryImages.includes(gallery[0].url) && (
                    <div className="absolute top-2 right-2 rounded-full bg-emerald-500/90 text-white p-1">
                      <Check className="w-3 h-3" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 w-full px-2 py-1.5 bg-gradient-to-t from-black/90 to-transparent">
                    <p className="text-white text-[10px] font-semibold truncate">{gallery[0].name}</p>
                    <p className="text-cyan-400 text-[9px] flex items-center gap-0.5"><CheckCircle className="w-2.5 h-2.5" /> Latest</p>
                  </div>
                </div>
                {/* Thumbnail grid */}
                {gallery.length > 1 && (
                  <div className="grid grid-cols-4 gap-1 pb-2">
                    {gallery.slice(1, 17).map((item) => (
                      <button
                        type="button"
                        key={item.url}
                        onClick={() => {
                          if (item.type !== 'image') return;
                          setSelectedGalleryImages((prev) =>
                            prev.includes(item.url) ? prev.filter((u) => u !== item.url) : [...prev, item.url]
                          );
                        }}
                        className={`aspect-square rounded-lg overflow-hidden border transition-all ${
                          item.type === 'image' && selectedGalleryImages.includes(item.url)
                            ? 'border-emerald-400/80 ring-1 ring-emerald-300/60'
                            : 'border-white/5 hover:border-cyan-500/40'
                        } ${item.type === 'image' ? 'cursor-pointer' : 'cursor-default'}`}
                        title={item.type === 'image' ? `${item.name} (click to select)` : item.name}
                      >
                        {item.type === 'video'
                          ? <video src={`${API}${item.url}`} muted className="w-full h-full object-cover" />
                          : <img src={`${API}${item.url}`} className="w-full h-full object-cover hover:scale-105 transition-transform" alt="" />
                        }
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center">
                <div className="w-36 h-48 bg-slate-900/80 rounded-2xl flex items-center justify-center shadow-lg border border-slate-700 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent z-10"></div>
                  <ImageIcon className="w-10 h-10 text-slate-600" />
                  <span className="absolute bottom-3 left-0 w-full text-center text-[10px] font-semibold text-slate-400 z-20">
                    {mediaLoading ? 'Syncing Media...' : mediaError ? 'Load Error' : 'Awaiting Render...'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Live Console */}
          <div className="h-64 p-5 flex flex-col font-mono text-sm">
            <div className="flex items-center justify-between mb-3">
               <div className="flex items-center gap-2">
                 <Terminal className="w-4 h-4 text-cyan-400" />
                 <h3 className="font-bold text-slate-200 uppercase tracking-widest text-xs">Live Console</h3>
                 <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
               </div>
               <div className="flex items-center gap-2">
                  <button
                    onClick={copyLogsToClipboard}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition-colors text-[10px] font-semibold uppercase tracking-wide"
                    title="Copy current logs"
                  >
                    <Copy className="w-3 h-3" />
                    {copiedLogs ? 'Copied' : 'Copy Log'}
                  </button>
                  <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-700"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-700"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-700 hover:bg-red-400 cursor-pointer"></div>
                  </div>
               </div>
            </div>
            <div ref={consoleRef} className="flex-1 bg-black/60 rounded-xl p-3 border border-white/5 overflow-y-auto custom-scrollbar shadow-inner">
              {logs.map((log, i) => (
                <div key={i} className={`flex gap-2 mb-1 text-[11px] leading-relaxed ${
                  log.level === 'error' ? 'text-red-400' :
                  log.level === 'success' ? 'text-green-400' :
                  log.level === 'warning' ? 'text-yellow-400' : 'text-slate-400'
                }`}>
                  <span className="text-slate-600 shrink-0">{log.ts}</span>
                  <span className="text-cyan-700 shrink-0">[{log.level}]</span>
                  <span className="break-all">{log.message}</span>
                </div>
              ))}
              <div className="flex gap-2"><span className="text-cyan-500 animate-pulse text-xs">_</span></div>
            </div>
          </div>
        </section>
      </main>

      {showCreateSessionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={handleCloseCreateSessionModal}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-base font-bold text-white">Create New Session</h3>
                <p className="text-xs text-slate-400 mt-1">Enter session name. Folder will follow this name.</p>
              </div>
              <button
                onClick={handleCloseCreateSessionModal}
                disabled={creatingSession}
                className="text-slate-500 hover:text-slate-300 disabled:opacity-60"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <input
              ref={newSessionInputRef}
              value={newSessionName}
              onChange={(e) => setNewSessionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newSessionName.trim()) {
                  void handleCreateSession(newSessionName);
                }
                if (e.key === 'Escape') {
                  handleCloseCreateSessionModal();
                }
              }}
              placeholder="e.g. morning-focus-shorts"
              className="w-full bg-slate-950/80 border border-slate-700/60 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all"
            />

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={handleCloseCreateSessionModal}
                disabled={creatingSession}
                className="px-3 py-2 text-xs rounded-lg border border-white/10 text-slate-300 hover:bg-white/5 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCreateSession(newSessionName)}
                disabled={creatingSession || !newSessionName.trim()}
                className="inline-flex items-center gap-2 px-3 py-2 text-xs rounded-lg border border-cyan-500/30 text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-60"
              >
                <Check className="w-3.5 h-3.5" />
                {creatingSession ? 'Creating...' : 'Create Session'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Session Item in Sidebar ─────────────────────────────────────────────────

function SessionItem({ session, isActive, onClick, onRename }: SessionItemProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(getSessionLabel(session));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const cancelEdit = () => {
    setValue(getSessionLabel(session));
    setEditing(false);
  };

  const commit = async () => {
    const nextName = value.trim();
    if (!nextName || nextName === session.name) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      await onRename(nextName);
      setEditing(false);
    } catch {
      setValue(getSessionLabel(session));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => {
    if (!editing) {
      setValue(getSessionLabel(session));
    }
  }, [session, editing]);

  return (
    <div
      onClick={onClick}
      className={`group flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all mb-1 cursor-pointer
        ${isActive ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/30' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
    >
      {editing ? (
        <>
          <input
            ref={inputRef}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void commit(); if (e.key === 'Escape') cancelEdit(); }}
            onClick={e => e.stopPropagation()}
            className="hidden lg:block bg-transparent border-b border-indigo-400 outline-none text-indigo-300 w-full"
          />
          <button
            onClick={e => { e.stopPropagation(); void commit(); }}
            disabled={saving}
            className="hidden lg:block text-emerald-400 hover:text-emerald-300 disabled:opacity-60"
            title="Save session name"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); cancelEdit(); }}
            disabled={saving}
            className="hidden lg:block text-slate-500 hover:text-slate-300 disabled:opacity-60"
            title="Cancel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </>
      ) : (
        <>
          <span className="hidden lg:block truncate flex-1">{getSessionLabel(session)}</span>
          <span className="hidden lg:inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] uppercase tracking-wide bg-white/5 border border-white/10 text-slate-400">
            {session.stage || 'init'}
          </span>
        </>
      )}
      <span className="lg:hidden text-[9px] font-bold">{(session.name || 's?').slice(0, 3)}</span>
      <button
        onClick={e => { e.stopPropagation(); setEditing(true); }}
        className="hidden lg:block ml-auto opacity-0 group-hover:opacity-100 hover:text-cyan-400 transition-all"
      >
        <Pencil className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Reusable Components ─────────────────────────────────────────────────────

function NavItem({ icon, label, isActive, onClick, color }: NavItemProps) {
  const colorMap: Record<string, string> = {
    cyan: 'text-cyan-400 bg-cyan-400/10 border-cyan-500/30',
    blue: 'text-blue-400 bg-blue-400/10 border-blue-500/30',
    purple: 'text-purple-400 bg-purple-400/10 border-purple-500/30',
    green: 'text-green-400 bg-green-400/10 border-green-500/30',
  };
  const activeStyle = isActive ? colorMap[color] : 'text-slate-500 border-transparent hover:bg-white/5 hover:text-slate-300';
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 p-3 lg:p-4 rounded-2xl border transition-all duration-300 group ${activeStyle}`}>
      <div className={`shrink-0 ${isActive ? '' : 'text-slate-500 group-hover:text-slate-300'}`}>{icon}</div>
      <span className="hidden lg:block font-semibold tracking-wide">{label}</span>
    </button>
  );
}

function PremiumCard({ children, className = '' }: PremiumCardProps) {
  return (
    <div className={`bg-slate-900/40 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden shadow-2xl transition-all duration-300 hover:border-white/20 hover:bg-slate-900/60 ${className}`}>
      {children}
    </div>
  );
}

function NeonButton({ children, onClick, isLoading, icon, disabled = false }: NeonButtonProps) {
  return (
    <button onClick={onClick} disabled={isLoading || disabled}
      className="relative group w-full flex items-center justify-center gap-2 py-4 px-6 rounded-2xl font-bold text-white bg-slate-800 border-2 border-slate-700 overflow-hidden transition-all hover:border-cyan-500 focus:outline-none focus:ring-4 focus:ring-cyan-500/20 disabled:opacity-70 disabled:cursor-not-allowed"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-cyan-600 to-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
      <span className="relative z-10 flex items-center gap-2">
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : icon}
        {children}
      </span>
    </button>
  );
}

function ConfigWorkspace() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [cfg, setCfg] = useState({
    verbose: false,
    headless: false,
    threads: 2,
    is_for_kids: false,
    stt_provider: 'local_whisper',
    whisper_model: 'base',
    whisper_device: 'auto',
    whisper_compute_type: 'int8',
    whisper_vad_filter: false,
    whisper_beam_size: 1,
    tts_voice: 'Jasper',
    tts_strict_mode: false,
    video_encode_preset: 'veryfast',
    video_encode_crf: 24,
    script_sentence_length: 4,
    font: 'bold_font.ttf',
  });

  const fetchConfig = async () => {
    setLoading(true);
    setSaveMsg('');
    try {
      const res = await fetch(`${API}/system/config`);
      if (!res.ok) throw new Error('Failed to load config');
      const data = await res.json();
      setCfg(prev => ({ ...prev, ...data }));
    } catch {
      setSaveMsg('❌ Failed to load config.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchConfig();
  }, []);

  const saveConfig = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const payload = {
        values: {
          verbose: !!cfg.verbose,
          headless: !!cfg.headless,
          threads: Number(cfg.threads) || 2,
          is_for_kids: !!cfg.is_for_kids,
          stt_provider: String(cfg.stt_provider || 'local_whisper'),
          whisper_model: String(cfg.whisper_model || 'base'),
          whisper_device: String(cfg.whisper_device || 'auto'),
          whisper_compute_type: String(cfg.whisper_compute_type || 'int8'),
          whisper_vad_filter: !!cfg.whisper_vad_filter,
          whisper_beam_size: Math.max(1, Number(cfg.whisper_beam_size) || 1),
          tts_voice: String(cfg.tts_voice || 'Jasper'),
          tts_strict_mode: !!cfg.tts_strict_mode,
          video_encode_preset: String(cfg.video_encode_preset || 'veryfast'),
          video_encode_crf: Math.min(35, Math.max(18, Number(cfg.video_encode_crf) || 24)),
          script_sentence_length: Math.max(1, Number(cfg.script_sentence_length) || 4),
          font: String(cfg.font || 'bold_font.ttf'),
        },
      };

      const res = await fetch(`${API}/system/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to save config');
      const data = await res.json();
      setCfg(prev => ({ ...prev, ...(data?.config || {}) }));
      setSaveMsg('✅ Config saved. New runs will use updated settings.');
    } catch {
      setSaveMsg('❌ Save failed. Please check backend API.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <PremiumCard className="p-8 border-cyan-500/20">
        <div className="flex items-center gap-2 text-slate-300">
          <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
          Loading config...
        </div>
      </PremiumCard>
    );
  }

  return (
    <div className="space-y-4">
      <PremiumCard className="p-6 border-cyan-500/20">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Settings className="w-4 h-4 text-cyan-400" /> Runtime Settings
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void fetchConfig()}
              className="px-3 py-1.5 text-xs rounded-lg border border-white/10 text-slate-300 hover:bg-white/5"
            >
              Reload
            </button>
            <button
              onClick={() => void saveConfig()}
              disabled={saving}
              className="px-3 py-1.5 text-xs rounded-lg border border-cyan-500/30 text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-60 inline-flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {saveMsg && <p className="text-xs mb-3 text-slate-300">{saveMsg}</p>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <label className="rounded-xl border border-white/10 bg-slate-900/50 p-3 flex items-center justify-between">
            <span title="Show more detailed backend logs in console output.">Verbose logs</span>
            <input type="checkbox" checked={!!cfg.verbose} onChange={e => setCfg(prev => ({ ...prev, verbose: e.target.checked }))} />
          </label>

          <label className="rounded-xl border border-white/10 bg-slate-900/50 p-3 flex items-center justify-between">
            <span title="Run browser automation without opening Firefox window.">Headless browser</span>
            <input type="checkbox" checked={!!cfg.headless} onChange={e => setCfg(prev => ({ ...prev, headless: e.target.checked }))} />
          </label>

          <label className="rounded-xl border border-white/10 bg-slate-900/50 p-3 flex items-center justify-between">
            <span title="Fail the run if any TTS chunk still fails after fallback.">TTS strict mode</span>
            <input type="checkbox" checked={!!cfg.tts_strict_mode} onChange={e => setCfg(prev => ({ ...prev, tts_strict_mode: e.target.checked }))} />
          </label>

          <label className="rounded-xl border border-white/10 bg-slate-900/50 p-3 flex items-center justify-between">
            <span title="Default upload audience flag for YouTube uploads.">Default is for kids</span>
            <input type="checkbox" checked={!!cfg.is_for_kids} onChange={e => setCfg(prev => ({ ...prev, is_for_kids: e.target.checked }))} />
          </label>

          <label className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1" title="FFmpeg worker threads. More threads can be faster on strong CPUs.">Threads</p>
            <input type="number" min={1} max={16} value={cfg.threads} onChange={e => setCfg(prev => ({ ...prev, threads: Number(e.target.value) }))} className="w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-3 py-2" title="Recommended: 2-8 depending on CPU." />
          </label>

          <label className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1" title="Default voice used for text-to-speech.">TTS voice</p>
            <select value={cfg.tts_voice} onChange={e => setCfg(prev => ({ ...prev, tts_voice: e.target.value }))} className="w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-3 py-2" title="Applies to new generation runs.">
              <option value="Jasper">Jasper</option>
              <option value="Luna">Luna</option>
              <option value="Milo">Milo</option>
              <option value="Ava">Ava</option>
              <option value="Emma">Emma</option>
            </select>
          </label>

          <label className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1" title="Speech-to-text engine for subtitle generation.">STT provider</p>
            <select value={cfg.stt_provider} onChange={e => setCfg(prev => ({ ...prev, stt_provider: e.target.value }))} className="w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-3 py-2" title="local_whisper is local and free; assemblyai is cloud-based.">
              <option value="local_whisper">local_whisper</option>
              <option value="third_party_assemblyai">third_party_assemblyai</option>
            </select>
          </label>

          <label className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1" title="Model size tradeoff: tiny/base faster, medium more accurate.">Whisper model</p>
            <select value={cfg.whisper_model} onChange={e => setCfg(prev => ({ ...prev, whisper_model: e.target.value }))} className="w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-3 py-2" title="For speed, prefer tiny or base.">
              <option value="tiny">tiny</option>
              <option value="base">base</option>
              <option value="small">small</option>
              <option value="medium">medium</option>
            </select>
          </label>

          <label className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1" title="Inference device. Use cpu if CUDA is unstable.">Whisper device</p>
            <select value={cfg.whisper_device} onChange={e => setCfg(prev => ({ ...prev, whisper_device: e.target.value }))} className="w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-3 py-2" title="auto tries GPU first, then falls back when needed.">
              <option value="auto">auto</option>
              <option value="cpu">cpu</option>
              <option value="cuda">cuda</option>
            </select>
          </label>

          <label className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1" title="Numeric precision for Whisper. int8 is usually fastest on CPU.">Whisper compute type</p>
            <select value={cfg.whisper_compute_type} onChange={e => setCfg(prev => ({ ...prev, whisper_compute_type: e.target.value }))} className="w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-3 py-2" title="Use int8 for speed-first setup.">
              <option value="int8">int8</option>
              <option value="int16">int16</option>
              <option value="float16">float16</option>
              <option value="float32">float32</option>
            </select>
          </label>

          <label className="rounded-xl border border-white/10 bg-slate-900/50 p-3 flex items-center justify-between">
            <span title="Voice activity detection cleans silence/noise but can slow down transcription.">Whisper VAD filter</span>
            <input type="checkbox" checked={!!cfg.whisper_vad_filter} onChange={e => setCfg(prev => ({ ...prev, whisper_vad_filter: e.target.checked }))} />
          </label>

          <label className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1" title="Beam size controls subtitle search depth. Higher = better quality but slower.">Whisper beam size</p>
            <input type="number" min={1} max={5} value={cfg.whisper_beam_size} onChange={e => setCfg(prev => ({ ...prev, whisper_beam_size: Number(e.target.value) }))} className="w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-3 py-2" title="Recommended for speed: 1. For quality: 2-3." />
          </label>

          <label className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1" title="x264 speed profile. Faster presets reduce render time with some quality/size tradeoff.">Video preset</p>
            <select value={cfg.video_encode_preset} onChange={e => setCfg(prev => ({ ...prev, video_encode_preset: e.target.value }))} className="w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-3 py-2" title="Speed order: ultrafast -> superfast -> veryfast -> faster -> fast -> medium.">
              <option value="ultrafast">ultrafast</option>
              <option value="superfast">superfast</option>
              <option value="veryfast">veryfast</option>
              <option value="faster">faster</option>
              <option value="fast">fast</option>
              <option value="medium">medium</option>
            </select>
          </label>

          <label className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1" title="CRF controls quality/compression. Lower = better quality, larger file, slower encode.">Video CRF (18-35)</p>
            <input type="number" min={18} max={35} value={cfg.video_encode_crf} onChange={e => setCfg(prev => ({ ...prev, video_encode_crf: Number(e.target.value) }))} className="w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-3 py-2" title="Typical: 20-24. For faster/smaller output, use 24-28." />
          </label>

          <label className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1" title="Target number of sentences per generated script block.">Script sentence length</p>
            <input type="number" min={1} max={20} value={cfg.script_sentence_length} onChange={e => setCfg(prev => ({ ...prev, script_sentence_length: Number(e.target.value) }))} className="w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-3 py-2" />
          </label>

          <label className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1" title="Font filename in fonts folder used by subtitle renderer.">Subtitle font file</p>
            <input type="text" value={cfg.font} onChange={e => setCfg(prev => ({ ...prev, font: e.target.value }))} className="w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-3 py-2" title="Example: bold_font.ttf" />
          </label>
        </div>
      </PremiumCard>
    </div>
  );
}

// ── YouTube Workspace ───────────────────────────────────────────────────────

function YouTubeWorkspace({
  activeSessionId,
  reloadIntervalMs,
  selectedGalleryImages,
  clearSelectedGalleryImages,
}: {
  activeSessionId: string;
  reloadIntervalMs: number;
  selectedGalleryImages: string[];
  clearSelectedGalleryImages: () => void;
}) {
  const [accounts, setAccounts] = useState<YouTubeAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [loading, setLoading] = useState(false);
  const [generatingAudioText, setGeneratingAudioText] = useState(false);
  const [generatingCcPreview, setGeneratingCcPreview] = useState(false);
  const [pushingNow, setPushingNow] = useState(false);
  const [loadingSessionData, setLoadingSessionData] = useState(false);
  const [activeSessionStage, setActiveSessionStage] = useState('');
  const [sessionId, setSessionId] = useState<string>('');
  const [customSubject, setCustomSubject] = useState('');
  const [customScript, setCustomScript] = useState('');
  const [publishMode, setPublishMode] = useState<'auto' | 'manual_review'>('manual_review');
  const [autoPushSocial, setAutoPushSocial] = useState(true);
  const [isForKids, setIsForKids] = useState(false);
  const [titleOverride, setTitleOverride] = useState('');
  const [descriptionOverride, setDescriptionOverride] = useState('');
  const [tagsOverride, setTagsOverride] = useState('');
  const [ttsVoice, setTtsVoice] = useState('Luna');
  const [scriptLanguage, setScriptLanguage] = useState('english');
  const [audioTextPreview, setAudioTextPreview] = useState('');
  const [ccPreview, setCcPreview] = useState('');
  const [promptTrace, setPromptTrace] = useState('');
  const [sessionVoiceUsed, setSessionVoiceUsed] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [showAudioTextGroup, setShowAudioTextGroup] = useState(true);
  const [showGenerationProgress, setShowGenerationProgress] = useState(true);
  const [showPublishOptions, setShowPublishOptions] = useState(true);
  const [stepRunMode, setStepRunMode] = useState<'auto' | 'custom'>('auto');
  const [customStartStep, setCustomStartStep] = useState('tts');
  const [applyingCustomImages, setApplyingCustomImages] = useState(false);
  const [customSubjectDirtySessionKey, setCustomSubjectDirtySessionKey] = useState('');
  const [customScriptDirtySessionKey, setCustomScriptDirtySessionKey] = useState('');
  const [selectedRegenerateStep, setSelectedRegenerateStep] = useState('script');
  const [selectedRegenerateStepDirtySessionKey, setSelectedRegenerateStepDirtySessionKey] = useState('');
  const [progressFloorStep, setProgressFloorStep] = useState('');
  const [progressFloorSessionKey, setProgressFloorSessionKey] = useState('');
  const [followProgressEnabled, setFollowProgressEnabled] = useState(true);
  const [englishCcBottom, setEnglishCcBottom] = useState(false);
  const [englishCcBottomDirtySessionKey, setEnglishCcBottomDirtySessionKey] = useState('');
  const [sessionSyncError, setSessionSyncError] = useState('');

  const getRecommendedVoices = (language: string): string[] => {
    return LANGUAGE_VOICE_MAP[language] || VOICE_OPTIONS;
  };

  const getTopVoiceForLanguage = (language: string): string => {
    return getRecommendedVoices(language)[0];
  };

  const currentExtraScript = String(customScript || audioTextPreview || '');
  const normalizedAudioText = currentExtraScript.replace(/\s+/g, ' ').trim();
  const effectiveSessionId = activeSessionId || sessionId;
  const currentSessionKey = effectiveSessionId || DRAFT_SESSION_KEY;
  const preferredAccountId = selectedAccountId || accounts[0]?.id || '';
  const mappedActiveSessionStep = mapStageToProgressStep(activeSessionStage);
  const progressFloorActive = progressFloorSessionKey === currentSessionKey ? progressFloorStep : '';
  const effectiveProgressStep = (() => {
    const mappedIndex = GENERATION_STEPS.findIndex((step) => step.id === mappedActiveSessionStep);
    const floorIndex = GENERATION_STEPS.findIndex((step) => step.id === progressFloorActive);
    if (floorIndex !== -1 && mappedIndex !== -1 && mappedIndex < floorIndex) {
      return progressFloorActive;
    }
    if (floorIndex !== -1 && mappedIndex === -1) {
      return progressFloorActive;
    }
    return mappedActiveSessionStep;
  })();

  const generationWarnings = useMemo(() => {
    const warnings: string[] = [];

    if (!preferredAccountId) {
      warnings.push('Chưa có YouTube account. Hãy chọn hoặc thêm account trước.');
    }

    if (!customSubject.trim()) {
      warnings.push('Custom Subject đang trống. Hãy nhập chủ đề trước khi Generate.');
    }

    if (!normalizedAudioText) {
      warnings.push('Audio Text đang trống. Hãy Auto Generate hoặc nhập Extra Script trước khi Generate.');
    } else if (normalizedAudioText.length < 30) {
      warnings.push('Audio Text quá ngắn (< 30 ký tự), dễ gây subtitle/audio lỗi.');
    }

    if (!VOICE_OPTIONS.includes(ttsVoice)) {
      warnings.push('Voice không hợp lệ. Hãy chọn lại voice trong danh sách.');
    }

    if (!SCRIPT_LANGUAGE_OPTIONS.some((lang) => lang.value === scriptLanguage)) {
      warnings.push('Audio Language không hợp lệ.');
    }

    if (loadingSessionData) {
      warnings.push('Session vẫn đang sync. Vui lòng đợi load xong rồi Generate.');
    }

    return warnings;
  }, [
    customSubject,
    normalizedAudioText,
    ttsVoice,
    scriptLanguage,
    loadingSessionData,
    preferredAccountId,
  ]);

  const isGenerateBlocked = generationWarnings.length > 0 || loading || generatingAudioText || generatingCcPreview;

  const regenerateWarnings = useMemo(() => {
    const warnings = [...generationWarnings];

    if (!effectiveSessionId) {
      warnings.push('Chưa có active session để Re-Generate.');
    }

    if (activeSessionStage === 'published') {
      warnings.push('Session đã published, không thể Re-Generate trực tiếp.');
    }

    return warnings;
  }, [generationWarnings, effectiveSessionId, activeSessionStage]);

  const isRegenerateBlocked = regenerateWarnings.length > 0 || loading || generatingAudioText || generatingCcPreview;

  const buildPromptTrace = (data?: SessionData): string => {
    if (!data) return '';

    const lines: string[] = [];
    const append = (title: string, value: unknown) => {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text) return;
      lines.push(`[${title}]`);
      lines.push(text);
      lines.push('');
    };

    append('TOPIC PROMPT', data.topic_prompt);
    append('TOPIC OUTPUT', data.topic_output);
    append('SCRIPT PROMPT', data.script_prompt);
    append('SCRIPT OUTPUT', data.script_output || data.script);
    append('METADATA TITLE PROMPT', data.metadata_title_prompt);
    append('METADATA DESCRIPTION PROMPT', data.metadata_description_prompt);
    append('IMAGE PROMPT REQUEST', data.image_prompt_request);
    append('IMAGE PROMPT RAW RESPONSE', data.image_prompt_raw_response);

    if (Array.isArray(data.image_prompts) && data.image_prompts.length > 0) {
      lines.push('[IMAGE PROMPTS]');
      data.image_prompts.forEach((p: string, i: number) => lines.push(`${i + 1}. ${p}`));
      lines.push('');
    }

    return lines.join('\n').trim();
  };

  useEffect(() => {
    fetch(`${API}/accounts/youtube`)
      .then((r) => {
        if (!r.ok) {
          throw new Error(`Accounts request failed (${r.status})`);
        }
        return r.json();
      })
      .then((data: YouTubeAccount[]) => {
        setAccounts(data || []);
        setAccountsError('');
        if ((data || []).length > 0) {
          setSelectedAccountId((prev) => prev || data[0].id);
        }
      })
      .catch((err) => {
        setAccounts([]);
        setAccountsError(getErrorMessage(err, 'Unable to load YouTube accounts.'));
      })
      .finally(() => setAccountsLoading(false));
  }, []);

  // When user clicks a session in sidebar, restore subject/script into the form
  // and keep it refreshed so newly generated fields auto-appear.
  useEffect(() => {
    if (!effectiveSessionId) {
      const resetTimer = window.setTimeout(() => {
        setLoadingSessionData(false);
        setSessionSyncError('');
        setActiveSessionStage('');
        setAudioTextPreview('');
        setCcPreview('');
        setPromptTrace('');
        setSessionVoiceUsed('');
        setSelectedRegenerateStep('script');
        setSelectedRegenerateStepDirtySessionKey('');
        setCustomSubjectDirtySessionKey('');
        setCustomScriptDirtySessionKey('');
        setProgressFloorStep('');
        setProgressFloorSessionKey('');
        setFollowProgressEnabled(true);
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }

    const syncSession = () => {
      setLoadingSessionData(true);
      setSessionSyncError('');
      fetch(`${API}/system/sessions/${effectiveSessionId}`)
        .then((r) => {
          if (!r.ok) {
            throw new Error(`Session sync failed (${r.status})`);
          }
          return r.json();
        })
        .then((data: SessionData) => {
          const mappedStage = mapStageToProgressStep(data?.stage ?? '');
          const mappedStageIndex = GENERATION_STEPS.findIndex((step) => step.id === mappedStage);
          const floorIndex = GENERATION_STEPS.findIndex((step) => step.id === progressFloorActive);
          const resolvedStage = floorIndex !== -1 && (mappedStageIndex === -1 || mappedStageIndex < floorIndex)
            ? progressFloorActive
            : mappedStage;
          const hasStageInOptions = REGENERATE_STEP_OPTIONS.some((step) => step.id === mappedStage);
          setSessionId(data?.session_id ?? effectiveSessionId);
          if (customSubjectDirtySessionKey !== currentSessionKey) {
            setCustomSubject(data?.subject ?? '');
          }
          if (customScriptDirtySessionKey !== currentSessionKey) {
            setCustomScript(data?.script ?? '');
          }
          setActiveSessionStage(data?.stage ?? '');
          setAudioTextPreview(data?.tts_text ?? data?.script ?? '');
          setCcPreview(data?.subtitle_preview ?? '');
          setPromptTrace(buildPromptTrace(data));
          setSessionVoiceUsed(data?.voice_used ?? '');
          if (progressFloorActive && resolvedStage === mappedStage) {
            setProgressFloorStep('');
            setProgressFloorSessionKey('');
          }
          if (REGENERATE_STEP_OPTIONS.some((step) => step.id === resolvedStage) && followProgressEnabled) {
            setSelectedRegenerateStep(resolvedStage);
          } else if (hasStageInOptions && followProgressEnabled) {
            setSelectedRegenerateStep(mappedStage);
          }
          if (englishCcBottomDirtySessionKey !== currentSessionKey && typeof data?.english_cc_bottom === 'boolean') {
            setEnglishCcBottom(data.english_cc_bottom);
          }
        })
        .catch((err) => {
          setSessionSyncError(getErrorMessage(err, 'Unable to sync selected session.'));
        })
        .finally(() => setLoadingSessionData(false));
    };

    syncSession();
    if (reloadIntervalMs <= 0) return;
    const interval = setInterval(syncSession, reloadIntervalMs);
    return () => clearInterval(interval);
  }, [
    effectiveSessionId,
    englishCcBottomDirtySessionKey,
    customSubjectDirtySessionKey,
    customScriptDirtySessionKey,
    progressFloorActive,
    selectedRegenerateStepDirtySessionKey,
    followProgressEnabled,
    currentSessionKey,
    reloadIntervalMs,
  ]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  };

  const applySelectedImagesToSession = async (): Promise<boolean> => {
    if (!effectiveSessionId) {
      showToast('❌ Please select/create a session first before using custom images.');
      return false;
    }

    if (selectedGalleryImages.length === 0) {
      return true;
    }

    setApplyingCustomImages(true);
    try {
      const res = await fetch(`${API}/youtube/sessions/${effectiveSessionId}/custom-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_urls: selectedGalleryImages }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || 'Failed to apply custom images');
      }
      showToast(`✅ Applied ${data?.image_count ?? selectedGalleryImages.length} custom image(s) to this session.`);
      return true;
    } catch (err) {
      showToast(`❌ ${(err as Error)?.message || 'Failed to apply custom images.'}`);
      return false;
    } finally {
      setApplyingCustomImages(false);
    }
  };

  const handleRunCustomStep = async () => {
    if (!effectiveSessionId) {
      showToast('❌ Please choose an active session for Custom Step mode.');
      return;
    }

    let startStep = customStartStep;

    if (selectedGalleryImages.length > 0 && (startStep === 'script' || startStep === 'images')) {
      startStep = 'tts';
      showToast('ℹ️ Custom images selected: auto-switching start step to Generate Audio.');
    }

    const applied = await applySelectedImagesToSession();
    if (!applied) {
      return;
    }

    setSelectedRegenerateStep(startStep);
    setSelectedRegenerateStepDirtySessionKey(currentSessionKey);
    setFollowProgressEnabled(false);
    setProgressFloorStep(startStep);
    setProgressFloorSessionKey(currentSessionKey);

    handleRegenerateFromStep(startStep);
  };

  const getStepStatus = (stepId: string): 'pending' | 'in-progress' | 'completed' => {
    const stepIndex = GENERATION_STEPS.findIndex(s => s.id === stepId);
    const currentStepIndex = GENERATION_STEPS.findIndex(s => s.id === effectiveProgressStep);
    
    if (currentStepIndex === -1) return 'pending';
    if (stepIndex < currentStepIndex) return 'completed';
    if (stepIndex === currentStepIndex) return 'in-progress';
    return 'pending';
  };

  const handleRegenerateFromStep = (stepId: string) => {
    if (regenerateWarnings.length > 0) {
      showToast(`❌ ${regenerateWarnings[0]}`);
      return;
    }

    const accountId = preferredAccountId;
    if (!accountId) {
      showToast('❌ No YouTube account selected.');
      return;
    }

    if (!effectiveSessionId) {
      showToast('❌ No active session to regenerate from.');
      return;
    }

    setLoading(true);
    fetch(`${API}/youtube/${accountId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: customSubject,
        script: normalizedAudioText,
        resume_session_id: effectiveSessionId,
        regenerate_from_step: stepId,  // Start from this step
        publish_mode: publishMode,
        auto_push_social: autoPushSocial,
        is_for_kids: isForKids,
        title_override: titleOverride,
        description_override: descriptionOverride,
        tags_override: tagsOverride,
        tts_voice: ttsVoice,
        script_language: scriptLanguage,
        english_cc_bottom: englishCcBottom,
      }),
    })
      .then(() => {
        setActiveSessionStage(stepId);
        setSelectedRegenerateStep(stepId);
        setProgressFloorStep(stepId);
        setProgressFloorSessionKey(currentSessionKey);
        showToast(`✅ Re-generation started from ${GENERATION_STEPS.find(s => s.id === stepId)?.label || stepId}`);
      })
      .catch(() => showToast('❌ Failed to start regeneration.'))
      .finally(() => setLoading(false));
  };

  const handleGenerate = () => {
    if (generationWarnings.length > 0) {
      showToast(`❌ ${generationWarnings[0]}`);
      return;
    }

    const accountId = preferredAccountId;
    if (!accountId) {
      showToast('❌ No YouTube account selected.');
      return;
    }

    setLoading(true);
    fetch(`${API}/youtube/${accountId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: customSubject,
        script: normalizedAudioText,
        resume_session_id: effectiveSessionId,
        publish_mode: publishMode,
        auto_push_social: autoPushSocial,
        is_for_kids: isForKids,
        title_override: titleOverride,
        description_override: descriptionOverride,
        tags_override: tagsOverride,
        tts_voice: ttsVoice,
        script_language: scriptLanguage,
        english_cc_bottom: englishCcBottom,
      }),
    })
      .then(r => r.json())
      .then(data => {
        setSessionId(data.session_id ?? '');
        setActiveSessionStage('script');
        setSelectedRegenerateStep('script');
        setAudioTextPreview(customScript || data?.script || '');
        showToast(`✅ ${data.message} (Session: ${data.session_id?.slice(0,8)}…)`);
      })
      .catch(() => showToast('❌ Failed to start generation.'))
      .finally(() => setLoading(false));
  };

  const handleAutoGenerateAudioText = () => {
    const accountId = preferredAccountId;
    if (!accountId) {
      showToast('❌ No YouTube account selected.');
      return;
    }

    if (!customSubject.trim()) {
      showToast('❌ Please enter a subject before auto-generating audio text.');
      return;
    }

    setGeneratingAudioText(true);
    fetch(`${API}/youtube/${accountId}/generate-audio-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: customSubject,
        script_language: scriptLanguage,
        resume_session_id: effectiveSessionId,
      }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          throw new Error(data?.detail || 'Failed to generate audio text');
        }
        setCustomScript(data?.script || '');
        setAudioTextPreview(data?.script || '');
        setPromptTrace(data?.prompt_trace || '');
        showToast('✅ Audio text generated. Review and edit before Generate Short.');
      })
      .catch((err) => showToast(`❌ ${err?.message || 'Failed to generate audio text.'}`))
      .finally(() => setGeneratingAudioText(false));
  };

  const handleRegenerateCcPreview = () => {
    const accountId = preferredAccountId;
    if (!accountId) {
      showToast('❌ No YouTube account selected.');
      return;
    }

    if (!normalizedAudioText) {
      showToast('❌ Audio Text đang trống. Hãy nhập hoặc auto-generate trước khi re-gen CC preview.');
      return;
    }

    setGeneratingCcPreview(true);
    fetch(`${API}/youtube/${accountId}/generate-cc-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: customSubject,
        script: normalizedAudioText,
        script_language: scriptLanguage,
        resume_session_id: effectiveSessionId,
        tts_voice: ttsVoice,
        english_cc_bottom: englishCcBottom,
      }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          throw new Error(data?.detail || 'Failed to regenerate CC preview');
        }
        setSessionId(data?.session_id ?? '');
        setActiveSessionStage(data?.stage ?? activeSessionStage);
        setAudioTextPreview(data?.tts_text ?? normalizedAudioText);
        setCcPreview(data?.subtitle_preview ?? '');
        setSessionVoiceUsed(data?.voice_used ?? '');
        showToast('✅ CC preview regenerated from current Audio Text.');
      })
      .catch((err) => showToast(`❌ ${err?.message || 'Failed to regenerate CC preview.'}`))
      .finally(() => setGeneratingCcPreview(false));
  };

  const handlePushNow = () => {
    if (!effectiveSessionId || pushingNow) return;

    setPushingNow(true);
    fetch(`${API}/youtube/sessions/${effectiveSessionId}/push-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_push_social: autoPushSocial }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          throw new Error(data?.detail || 'Push Now failed');
        }
        setActiveSessionStage('published');
        showToast('✅ Push Now complete. Uploaded/pushed successfully.');
      })
      .catch((err) => showToast(`❌ ${err?.message || 'Push Now failed.'}`))
      .finally(() => setPushingNow(false));
  };

  return (
    <div className="space-y-6 relative">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm px-4 py-3 rounded-2xl bg-slate-800/90 backdrop-blur border border-white/10 shadow-2xl text-sm text-white flex items-center gap-3 animate-fade-in-up">
          <span className="flex-1">{toastMsg}</span>
          <button onClick={() => setToastMsg('')}><X className="w-4 h-4 text-slate-400 hover:text-white" /></button>
        </div>
      )}

      {sessionId && (
        <div className="text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-3 py-2 flex items-center gap-2">
          <FolderOpen className="w-3 h-3" />
          Active Session: <code className="font-mono ml-1">{sessionId.slice(0, 8)}…</code>
        </div>
      )}
      
      <PremiumCard className="p-6 border-cyan-500/20">
        <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2"><Settings className="w-5 h-5 text-cyan-400" /> Video Content & Publish Config</h3>
        {effectiveSessionId && (
          <p className="text-xs text-cyan-400 mb-4">
            {loadingSessionData ? 'Loading prompt from selected session...' : 'Prompt loaded from selected session. You can edit before generating.'}
          </p>
        )}

        {sessionSyncError && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {sessionSyncError}
          </div>
        )}

        {effectiveSessionId && (
          <div className="mb-4 rounded-xl border border-white/10 bg-slate-900/40 px-3 py-2 flex items-center justify-between gap-3">
            <div className="text-xs text-slate-300 space-y-1">
              <p>Current session stage: <span className="text-cyan-400 font-semibold">{activeSessionStage || 'unknown'}</span></p>
              <p>Voice used: <span className="text-cyan-300 font-semibold">{sessionVoiceUsed || 'N/A (run TTS first)'}</span></p>
            </div>
            {activeSessionStage === 'ready_for_review' && (
              <button
                onClick={handlePushNow}
                disabled={pushingNow}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-emerald-500/30 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-60"
              >
                {pushingNow ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {pushingNow ? 'Pushing...' : 'Push Now'}
              </button>
            )}
          </div>
        )}

        {effectiveSessionId && (
          <div className="mb-6 rounded-xl border border-white/10 bg-slate-900/50 p-4">
            <button
              type="button"
              onClick={() => setShowGenerationProgress((v) => !v)}
              className="w-full flex items-center justify-between text-left"
            >
              <p className="text-sm font-semibold text-slate-200">📊 Generation Progress</p>
              <span className="text-xs text-cyan-300">{showGenerationProgress ? '▾ Hide' : '▸ Show'}</span>
            </button>

            {showGenerationProgress && (
              <div className="mt-3">
                <div className="mb-3 rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-slate-400">Step Mode</span>
                  <select
                    value={stepRunMode}
                    onChange={(e) => setStepRunMode(e.target.value as 'auto' | 'custom')}
                    className="px-2.5 py-1.5 rounded-md bg-slate-900/90 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/40"
                  >
                    <option value="auto">Auto Step</option>
                    <option value="custom">Custom Step</option>
                  </select>
                  {stepRunMode === 'custom' && (
                    <>
                      <select
                        value={customStartStep}
                        onChange={(e) => setCustomStartStep(e.target.value)}
                        className="px-2.5 py-1.5 rounded-md bg-slate-900/90 border border-white/10 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/40"
                      >
                        {REGENERATE_STEP_OPTIONS.map((step) => (
                          <option key={`custom-${step.id}`} value={step.id}>
                            {step.icon} {step.label}
                          </option>
                        ))}
                      </select>
                      <span className="text-[11px] text-slate-400">
                        Selected images: <span className="text-emerald-300 font-semibold">{selectedGalleryImages.length}</span>
                      </span>
                      <button
                        onClick={clearSelectedGalleryImages}
                        disabled={selectedGalleryImages.length === 0}
                        className="text-[10px] px-2 py-1 rounded-md border border-emerald-500/30 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        Clear Image Selection
                      </button>
                    </>
                  )}
                </div>

                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3">
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <select
                      value={selectedRegenerateStep}
                      onChange={(e) => {
                        setSelectedRegenerateStep(e.target.value);
                        setSelectedRegenerateStepDirtySessionKey(currentSessionKey);
                        setFollowProgressEnabled(false);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-800/80 border border-white/10 text-sm text-slate-100 focus:outline-none focus:border-cyan-500/40"
                    >
                      {REGENERATE_STEP_OPTIONS.map((step) => (
                        <option key={step.id} value={step.id}>
                          {step.icon} {step.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        setFollowProgressEnabled(true);
                        setSelectedRegenerateStepDirtySessionKey('');
                        if (REGENERATE_STEP_OPTIONS.some((step) => step.id === effectiveProgressStep)) {
                          setSelectedRegenerateStep(effectiveProgressStep);
                        }
                      }}
                      className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                        followProgressEnabled
                          ? 'border-cyan-400/40 text-cyan-200 bg-cyan-500/20'
                          : 'border-cyan-500/30 text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20'
                      }`}
                      title="Auto-follow backend stage progress"
                    >
                      Follow Progress
                    </button>
                    <button
                      onClick={() => handleRegenerateFromStep(selectedRegenerateStep)}
                      disabled={isRegenerateBlocked || followProgressEnabled || stepRunMode === 'custom'}
                      className="text-xs px-3 py-1.5 rounded-md border border-amber-500/30 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 transition-colors disabled:opacity-60"
                    >
                      {stepRunMode === 'custom'
                        ? 'Use Custom Step Run'
                        : followProgressEnabled
                          ? 'Follow mode active'
                          : loading
                            ? 'Starting...'
                            : 'Re-Generate Selected Step'}
                    </button>
                    {stepRunMode === 'custom' && (
                      <button
                        onClick={() => { void handleRunCustomStep(); }}
                        disabled={isRegenerateBlocked || applyingCustomImages || loadingSessionData}
                        className="text-xs px-3 py-1.5 rounded-md border border-cyan-500/30 text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors disabled:opacity-60"
                      >
                        {applyingCustomImages ? 'Applying Images...' : loading ? 'Starting...' : 'Run Custom Step'}
                      </button>
                    )}
                  </div>
                </div>
                {regenerateWarnings.length > 0 && (
                  <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                    <p className="text-xs text-amber-300 font-semibold mb-1">⚠️ Please fix before Re-Generate:</p>
                    <ul className="text-xs text-amber-200 space-y-0.5">
                      {regenerateWarnings.map((w, i) => (
                        <li key={`${i}-${w}`}>• {w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="space-y-2">
                  {GENERATION_STEPS.map((step) => {
                    const status = getStepStatus(step.id);
                    return (
                      <div key={step.id} className="flex items-center gap-3">
                        <div className="flex items-center gap-2 flex-1">
                          <span className="text-lg">{step.icon}</span>
                          <span className={`text-sm ${
                            status === 'completed' ? 'text-emerald-400' :
                            status === 'in-progress' ? 'text-cyan-400 font-semibold' :
                            'text-slate-500'
                          }`}>
                            {step.label}
                          </span>
                          {status === 'completed' && <Check className="w-4 h-4 text-emerald-400" />}
                          {status === 'in-progress' && <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="rounded-xl border border-white/10 bg-slate-900/50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Connection Info</p>
            {accountsLoading && (
              <p className="text-xs text-cyan-300 mb-2 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading YouTube accounts...
              </p>
            )}
            {accountsError && (
              <p className="text-xs text-red-300 mb-2">{accountsError}</p>
            )}
            <p className="text-sm text-slate-300">YouTube accounts: <span className="text-cyan-400 font-semibold">{accounts.length}</span></p>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              disabled={accountsLoading || accounts.length === 0}
              className="mt-2 w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/50"
            >
              {accounts.length === 0 && <option value="">No account available</option>}
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>{acc.nickname} ({acc.niche})</option>
              ))}
            </select>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-900/50 p-3 space-y-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Publish Mode</p>
              <select
                value={publishMode}
                onChange={(e) => setPublishMode(e.target.value as 'auto' | 'manual_review')}
                className="w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/50"
              >
                <option value="auto">Auto publish when generation done</option>
                <option value="manual_review">Generate only, review before pushing</option>
              </select>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Voice</p>
              <select
                value={ttsVoice}
                onChange={(e) => setTtsVoice(e.target.value)}
                className="w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/50"
              >
                {VOICE_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-slate-900/50 p-4">
            <button
              type="button"
              onClick={() => setShowAudioTextGroup((v) => !v)}
              className="w-full flex items-center justify-between text-left"
            >
              <p className="text-sm text-slate-200 font-semibold">Audio Text Group</p>
              <span className="text-xs text-cyan-300">{showAudioTextGroup ? '▾ Hide' : '▸ Show'}</span>
            </button>

            {showAudioTextGroup && (
              <div className="mt-3 space-y-4">
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                  <p className="text-xs uppercase tracking-wide text-cyan-300 mb-2">Step 1 · Define Topic</p>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Custom Subject <span className="text-xs text-slate-500">(Required)</span></label>
                  <input
                    type="text"
                    value={customSubject}
                    onChange={e => {
                      setCustomSubject(e.target.value);
                      setCustomSubjectDirtySessionKey(currentSessionKey);
                    }}
                    placeholder="e.g. 5 hidden secrets about the Pyramids..."
                    className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all font-medium"
                  />
                  <p className="mt-2 text-xs text-slate-400">Đây là chủ đề gốc để tạo script/video.</p>
                </div>

                <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-purple-300">Step 2 · Build Extra Script</p>
                      <label className="block text-sm font-medium text-slate-300">Extra Script (Audio Text) <span className="text-xs text-slate-500">(Auto generate rồi chỉnh tay)</span></label>
                    </div>
                    <button
                      onClick={handleAutoGenerateAudioText}
                      disabled={generatingAudioText || !customSubject.trim()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition-colors text-[10px] font-semibold uppercase tracking-wide disabled:opacity-60"
                    >
                      {generatingAudioText ? <Loader2 className="w-3 h-3 animate-spin" /> : <Settings className="w-3 h-3" />}
                      {generatingAudioText ? 'Generating...' : 'Auto Build Extra Script'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1">Extra Script (TTS Input)</label>
                      <textarea value={customScript} onChange={e => {
                        setCustomScript(e.target.value);
                        setCustomScriptDirtySessionKey(currentSessionKey);
                      }}
                        placeholder="Press Auto Build Extra Script, then review/edit Extra Script here..."
                        rows={6}
                        className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all font-medium resize-none custom-scrollbar"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1">Audio Text (Normalized)</label>
                      <textarea
                        value={normalizedAudioText || 'No normalized audio text yet.'}
                        readOnly
                        rows={6}
                        className="w-full bg-slate-950/70 border border-slate-700/50 rounded-xl px-4 py-3 text-slate-200 resize-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-amber-300">Step 3 · Generate CC Preview</p>
                      <label className="block text-sm font-medium text-slate-300">Subtitle Preview <span className="text-xs text-slate-500">(Auto gen rồi re-gen nếu chưa hợp lý)</span></label>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleRegenerateCcPreview}
                        disabled={generatingCcPreview || !normalizedAudioText}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition-colors text-[10px] font-semibold uppercase tracking-wide disabled:opacity-60"
                      >
                        {generatingCcPreview ? <Loader2 className="w-3 h-3 animate-spin" /> : <Settings className="w-3 h-3" />}
                        {generatingCcPreview ? 'Generating...' : 'Auto Gen CC'}
                      </button>
                      <button
                        onClick={handleRegenerateCcPreview}
                        disabled={generatingCcPreview || !normalizedAudioText}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors text-[10px] font-semibold uppercase tracking-wide disabled:opacity-60"
                      >
                        {generatingCcPreview ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pencil className="w-3 h-3" />}
                        {generatingCcPreview ? 'Generating...' : 'Re-Gen CC'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={ccPreview || 'No subtitle generated yet for this session. Click Auto Gen CC to create preview.'}
                    readOnly
                    rows={4}
                    className="w-full bg-slate-950/70 border border-slate-700/50 rounded-xl px-4 py-3 text-slate-200 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Prompt Trace (Saved in Session)</label>
                  <textarea
                    value={promptTrace || 'No prompt trace saved yet. Generate Audio Text/Generate Short to capture prompts and outputs.'}
                    readOnly
                    rows={8}
                    className="w-full bg-slate-950/70 border border-slate-700/50 rounded-xl px-4 py-3 text-slate-200 resize-y"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/50 p-3">
          <p className="text-sm text-slate-200 font-semibold mb-2">Audio Language</p>
          <select
            value={scriptLanguage}
            onChange={(e) => {
              const nextLanguage = e.target.value;
              const recommendedVoice = (LANGUAGE_VOICE_MAP[nextLanguage] || VOICE_OPTIONS)[0];
              setScriptLanguage(nextLanguage);
              setTtsVoice(recommendedVoice);
            }}
            className="w-full max-w-xs bg-slate-950/80 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/50"
          >
            {SCRIPT_LANGUAGE_OPTIONS.map((lang) => (
              <option key={lang.value} value={lang.value}>{lang.label}</option>
            ))}
          </select>
          <p className="text-xs text-slate-500 mt-2">
            Supported languages: {SCRIPT_LANGUAGE_OPTIONS.map((l) => l.label).join(', ')}.
          </p>
          <p className="text-xs text-cyan-400 mt-2 font-semibold">
            ✨ Recommended voices for {SCRIPT_LANGUAGE_OPTIONS.find(l => l.value === scriptLanguage)?.label}: {getRecommendedVoices(scriptLanguage).join(', ')}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Voice auto-switches to <span className="text-cyan-300 font-semibold">{getTopVoiceForLanguage(scriptLanguage)}</span> when you change language.
          </p>

          <label className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-700/40 bg-slate-950/50 px-3 py-2 cursor-pointer">
            <input
              type="checkbox"
              checked={englishCcBottom}
              onChange={(e) => {
                setEnglishCcBottom(e.target.checked);
                setEnglishCcBottomDirtySessionKey(currentSessionKey);
              }}
              className="h-4 w-4 accent-cyan-500"
            />
            <span className="text-xs text-slate-200 font-semibold">Show English CC at bottom</span>
          </label>
          <p className="text-xs text-slate-500 mt-1">
            When enabled, subtitles are translated to English and rendered at the bottom of the video.
          </p>
        </div>

        <div className="mt-4 space-y-3 border border-white/10 bg-slate-900/50 rounded-xl p-4">
          <button
            type="button"
            onClick={() => setShowPublishOptions((v) => !v)}
            className="w-full flex items-center justify-between text-left"
          >
            <p className="text-sm text-slate-200 font-semibold">Publish & Metadata Options</p>
            <span className="text-xs text-cyan-300">{showPublishOptions ? '▾ Hide' : '▸ Show'}</span>
          </button>

          {showPublishOptions && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
                <label className="rounded-lg border border-slate-700/40 bg-slate-950/50 px-3 py-2 flex items-center justify-between cursor-pointer">
                  <div>
                    <p className="text-sm text-slate-200 font-semibold">Auto push to social</p>
                    <p className="text-xs text-slate-500">Cross-post right after YouTube upload</p>
                  </div>
                  <input type="checkbox" checked={autoPushSocial} onChange={(e) => setAutoPushSocial(e.target.checked)} className="h-4 w-4 accent-cyan-500" />
                </label>

                <label className="rounded-lg border border-slate-700/40 bg-slate-950/50 px-3 py-2 flex items-center justify-between cursor-pointer">
                  <div>
                    <p className="text-sm text-slate-200 font-semibold">is_for_kids</p>
                    <p className="text-xs text-slate-500">Override kids audience option for this run</p>
                  </div>
                  <input type="checkbox" checked={isForKids} onChange={(e) => setIsForKids(e.target.checked)} className="h-4 w-4 accent-cyan-500" />
                </label>
              </div>

              <input
                type="text"
                value={titleOverride}
                onChange={(e) => setTitleOverride(e.target.value)}
                placeholder="Title override (optional)"
                className="w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
              />
              <textarea
                value={descriptionOverride}
                onChange={(e) => setDescriptionOverride(e.target.value)}
                placeholder="Description override (optional)"
                rows={3}
                className="w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 resize-none"
              />
              <input
                type="text"
                value={tagsOverride}
                onChange={(e) => setTagsOverride(e.target.value)}
                placeholder="Tags override (optional, comma separated)"
                className="w-full bg-slate-950/80 border border-slate-700/60 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
              />
            </>
          )}
        </div>

        <div className="mt-5">
          {generationWarnings.length > 0 && (
            <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <p className="text-xs text-amber-300 font-semibold mb-1">⚠️ Please fix before Generate:</p>
              <ul className="text-xs text-amber-200 space-y-0.5">
                {generationWarnings.map((w, i) => (
                  <li key={`${i}-${w}`}>• {w}</li>
                ))}
              </ul>
            </div>
          )}

          <NeonButton onClick={handleGenerate} isLoading={loading} disabled={isGenerateBlocked} icon={<Play className="w-5 h-5" />}>
            Generate Short
          </NeonButton>
          {accounts.length === 0 && (
            <p className="text-xs text-slate-500 mt-2">No YouTube account detected. Please configure in config.json.</p>
          )}
        </div>
      </PremiumCard>
    </div>
  );
}
