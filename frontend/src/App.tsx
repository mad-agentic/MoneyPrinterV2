import { useState, useEffect, useRef } from 'react';
import { Play, Settings, Video, Bird, Users, Briefcase, Zap, Terminal, FileVideo, Image as ImageIcon, Loader2, CheckCircle, Pencil, FolderOpen, X, Copy, Plus, Check } from 'lucide-react';

const API = 'http://127.0.0.1:15001';

export default function App() {
  const [activeTab, setActiveTab] = useState('youtube');
  const [status, setStatus] = useState<any>(null);
  const [gallery, setGallery] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>(''); // '' = all
  const [creatingSession, setCreatingSession] = useState(false);
  const [logs, setLogs] = useState<{ ts: string; level: string; message: string }[]>([
    { ts: new Date().toLocaleTimeString('en-GB'), level: 'info', message: '⚡ System initialization complete.' },
    { ts: new Date().toLocaleTimeString('en-GB'), level: 'info', message: '🔗 Connecting to Uvicorn Backend on 127.0.0.1:15001...' },
  ]);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const consoleRef = useRef<HTMLDivElement>(null);

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
    fetch(`${API}/system/status`).then(r => r.json()).then(setStatus).catch(console.error);

    // SSE live log stream
    const es = new EventSource(`${API}/system/logs/stream`);
    es.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data);
        if (entry.level === 'ping') return;
        setLogs(prev => [...prev.slice(-199), entry]);
      } catch { }
    };
    es.onerror = () => setLogs(prev => [...prev, { ts: new Date().toLocaleTimeString('en-GB'), level: 'warning', message: '⚠️ Log stream disconnected. Retrying...' }]);

    return () => { es.close(); };
  }, []); // eslint-disable-line

  // Keep gallery/sessions in sync and respect current filter mode (All vs selected session).
  useEffect(() => {
    const tick = () => {
      const galleryUrl = activeSessionId
        ? `${API}/system/gallery?session_id=${activeSessionId}`
        : `${API}/system/gallery`;
      fetch(galleryUrl).then(r => r.json()).then(setGallery).catch(console.error);
      fetch(`${API}/system/sessions`).then(r => r.json()).then(setSessions).catch(console.error);
    };

    tick();
    const interval = setInterval(tick, 1500);
    return () => clearInterval(interval);
  }, [activeSessionId]);

  const handleRenameSession = async (sessionId: string, newName: string) => {
    const res = await fetch(`${API}/system/sessions/${sessionId}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) throw new Error('Rename failed');
    setSessions(prev => prev.map(s => s.session_id === sessionId ? { ...s, name: newName } : s));
  };

  const handleCreateSession = async () => {
    if (creatingSession) return;
    setCreatingSession(true);
    try {
      const defaultName = `Session ${sessions.length + 1}`;
      const res = await fetch(`${API}/system/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: defaultName }),
      });
      if (!res.ok) throw new Error('Create session failed');
      const created = await res.json();
      setSessions(prev => [created, ...prev]);
      setActiveSessionId(created.session_id);
    } catch {
      setLogs(prev => [...prev.slice(-199), {
        ts: new Date().toLocaleTimeString('en-GB'),
        level: 'error',
        message: '❌ Unable to create new session.',
      }]);
    } finally {
      setCreatingSession(false);
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
                  onClick={handleCreateSession}
                  disabled={creatingSession}
                  className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-cyan-500/30 text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-60"
                  title="Add new session"
                >
                  <Plus className="w-3 h-3" />
                  {creatingSession ? 'Adding...' : 'Add'}
                </button>
              </div>
              <button
                onClick={handleCreateSession}
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

              {sessions.map((s: any) => (
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
          <div className={`flex items-center justify-center lg:justify-start lg:px-3 py-2 rounded-xl bg-black/20 border ${status ? 'border-cyan-500/20' : 'border-red-500/20'} backdrop-blur-md`}>
            <div className="relative flex h-3 w-3">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${status ? 'bg-cyan-400' : 'bg-red-400'}`}></span>
              <span className={`relative inline-flex rounded-full h-3 w-3 ${status ? 'bg-cyan-500' : 'bg-red-500'}`}></span>
            </div>
            <span className="ml-3 text-xs font-semibold text-slate-300 hidden lg:block uppercase tracking-wider">
              {status ? 'API Connected' : 'No Connection'}
            </span>
          </div>
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
            {activeTab === 'youtube' && <YouTubeWorkspace activeSessionId={activeSessionId} />}
            {activeTab !== 'youtube' && (
               <PremiumCard className="flex flex-col items-center justify-center py-20 text-center border-dashed border-slate-700/50">
                 <Settings className="w-16 h-16 text-slate-600 mb-4 animate-[spin_10s_linear_infinite]" />
                 <h3 className="text-xl font-bold text-slate-300 mb-2">Module is calibrating</h3>
                 <p className="text-slate-500">The {activeTab} workspace is being upgraded to the Pro-Max architecture.</p>
               </PremiumCard>
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
                  {sessions.map((s: any) => (
                    <option key={s.session_id} value={s.session_id}>
                      {s.name || s.session_id.slice(0, 6)}
                    </option>
                  ))}
                </select>
              </div>
              {gallery.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-[10px] font-bold">{gallery.length}</span>
              )}
              {activeSession && (
                <span className="ml-auto text-[10px] text-slate-500 hidden lg:block truncate max-w-[100px]" title={activeSession.name}>
                  📁 {activeSession.name}
                </span>
              )}
            </div>
            
            {gallery.length > 0 ? (
              <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-3">
                {/* Featured latest */}
                <div className="w-full max-w-[180px] mx-auto aspect-[9/16] bg-black rounded-2xl overflow-hidden shadow-2xl border border-white/10 relative shrink-0">
                  {gallery[0].type === 'video' ? (
                    <video src={`${API}${gallery[0].url}`} autoPlay loop muted className="w-full h-full object-cover" />
                  ) : (
                    <img src={`${API}${gallery[0].url}`} className="w-full h-full object-cover" alt={gallery[0].name} />
                  )}
                  <div className="absolute bottom-0 left-0 w-full px-2 py-1.5 bg-gradient-to-t from-black/90 to-transparent">
                    <p className="text-white text-[10px] font-semibold truncate">{gallery[0].name}</p>
                    <p className="text-cyan-400 text-[9px] flex items-center gap-0.5"><CheckCircle className="w-2.5 h-2.5" /> Latest</p>
                  </div>
                </div>
                {/* Thumbnail grid */}
                {gallery.length > 1 && (
                  <div className="grid grid-cols-4 gap-1 pb-2">
                    {gallery.slice(1, 17).map((item: any) => (
                      <div key={item.url} className="aspect-square rounded-lg overflow-hidden border border-white/5 hover:border-cyan-500/40 transition-all cursor-pointer" title={item.name}>
                        {item.type === 'video'
                          ? <video src={`${API}${item.url}`} muted className="w-full h-full object-cover" />
                          : <img src={`${API}${item.url}`} className="w-full h-full object-cover hover:scale-105 transition-transform" alt="" />
                        }
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center">
                <div className="w-36 h-48 bg-slate-900/80 rounded-2xl flex items-center justify-center shadow-lg border border-slate-700 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent z-10"></div>
                  <ImageIcon className="w-10 h-10 text-slate-600" />
                  <span className="absolute bottom-3 left-0 w-full text-center text-[10px] font-semibold text-slate-400 z-20">Awaiting Render...</span>
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
    </div>
  );
}

// ── Session Item in Sidebar ─────────────────────────────────────────────────

function SessionItem({ session, isActive, onClick, onRename }: { session: any; isActive: boolean; onClick: () => void; onRename: (n: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(session.name || session.session_id.slice(0, 6));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const cancelEdit = () => {
    setValue(session.name || session.session_id.slice(0, 6));
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
      setValue(session.name || session.session_id.slice(0, 6));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => {
    if (!editing) {
      setValue(session.name || session.session_id.slice(0, 6));
    }
  }, [session.name, session.session_id, editing]);

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
          <span className="hidden lg:block truncate flex-1">{session.name || session.session_id.slice(0, 6)}</span>
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

function NavItem({ icon, label, isActive, onClick, color }: any) {
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

function PremiumCard({ children, className = '' }: any) {
  return (
    <div className={`bg-slate-900/40 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden shadow-2xl transition-all duration-300 hover:border-white/20 hover:bg-slate-900/60 ${className}`}>
      {children}
    </div>
  );
}

function NeonButton({ children, onClick, isLoading, icon }: any) {
  return (
    <button onClick={onClick} disabled={isLoading}
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

// ── YouTube Workspace ───────────────────────────────────────────────────────

function YouTubeWorkspace({ activeSessionId }: { activeSessionId: string }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingSessionData, setLoadingSessionData] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [customSubject, setCustomSubject] = useState('');
  const [customScript, setCustomScript] = useState('');
  const [toastMsg, setToastMsg] = useState('');

  useEffect(() => {
    fetch(`${API}/accounts/youtube`).then(r => r.json()).then(setAccounts).catch(console.error);
  }, []);

  // When user clicks a session in sidebar, restore subject/script into the form.
  useEffect(() => {
    if (!activeSessionId) {
      setLoadingSessionData(false);
      return;
    }

    setLoadingSessionData(true);
    fetch(`${API}/system/sessions/${activeSessionId}`)
      .then(r => r.json())
      .then(data => {
        setCustomSubject(data?.subject ?? '');
        setCustomScript(data?.script ?? '');
      })
      .catch(console.error)
      .finally(() => setLoadingSessionData(false));
  }, [activeSessionId]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  };

  const handleGenerate = (id: string) => {
    setLoading(true);
    fetch(`${API}/youtube/${id}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: customSubject, script: customScript, resume_session_id: activeSessionId }),
    })
      .then(r => r.json())
      .then(data => {
        setSessionId(data.session_id ?? '');
        showToast(`✅ ${data.message} (Session: ${data.session_id?.slice(0,8)}…)`);
      })
      .catch(() => showToast('❌ Failed to start generation.'))
      .finally(() => setLoading(false));
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
        <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2"><Settings className="w-5 h-5 text-cyan-400" /> Video Content Configuration</h3>
        {activeSessionId && (
          <p className="text-xs text-cyan-400 mb-4">
            {loadingSessionData ? 'Loading prompt from selected session...' : 'Prompt loaded from selected session. You can edit before generating.'}
          </p>
        )}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Custom Subject <span className="text-xs text-slate-500">(Optional – auto-generated if empty)</span></label>
            <input type="text" value={customSubject} onChange={e => setCustomSubject(e.target.value)}
              placeholder="e.g. 5 hidden secrets about the Pyramids..."
              className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all font-medium"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Exact Script <span className="text-xs text-slate-500">(Optional – overrides AI generation)</span></label>
            <textarea value={customScript} onChange={e => setCustomScript(e.target.value)}
              placeholder="Write your perfect viral script here..."
              rows={4}
              className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all font-medium resize-none custom-scrollbar"
            />
          </div>
        </div>
      </PremiumCard>

      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-white">Select Target Channel</h3>
        <span className="text-sm font-medium text-slate-500">{accounts.length} configurations found</span>
      </div>
      
      {accounts.length === 0 ? (
        <PremiumCard className="p-10 flex flex-col items-center justify-center text-center border-dashed border-slate-700/50">
          <Video className="w-12 h-12 text-slate-600 mb-4" />
          <p className="text-lg text-slate-400 font-medium">No YouTube channels detected.</p>
          <p className="text-sm text-slate-500 mt-1">Configure accounts in config.json</p>
        </PremiumCard>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {accounts.map((acc: any) => (
            <PremiumCard key={acc.id} className="p-6 group cursor-pointer border-transparent hover:border-cyan-500/50">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h4 className="text-lg font-bold text-white mb-1 group-hover:text-cyan-400 transition-colors">{acc.nickname}</h4>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-cyan-400/10 text-cyan-400 border border-cyan-400/20">{acc.niche}</span>
                </div>
              </div>
              <NeonButton onClick={(e: any) => { e.stopPropagation(); handleGenerate(acc.id); }} isLoading={loading} icon={<Play className="w-5 h-5" />}>
                Generate Short
              </NeonButton>
            </PremiumCard>
          ))}
        </div>
      )}
    </div>
  );
}
