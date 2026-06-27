import { useState, useEffect, useCallback } from 'react';
import './index.css';

declare global {
  interface Window {
    acquireVsCodeApi: () => any;
  }
}

const vscode = typeof window.acquireVsCodeApi === 'function'
  ? window.acquireVsCodeApi()
  : { postMessage: (msg: any) => console.log('[dev]', msg) };

// ─── Types ────────────────────────────────────────────────────────────────────

type Region = 'editor' | 'sidebar' | 'terminal' | 'activitybar' | 'statusbar' | 'titlebar';

const ALL_REGIONS: Region[] = ['editor', 'sidebar', 'terminal', 'activitybar', 'statusbar', 'titlebar'];

interface RegionState {
  enabled: boolean;
  opacity: number;   // 0–100
  blur: number;      // 0–50
  webviewUri: string | null;  // lightweight vscode-webview:// URI (not base64)
  imageName: string | null;
  isVideo: boolean;
}

type AppState = Record<Region, RegionState>;

const DEFAULT: RegionState = {
  enabled: false, opacity: 60, blur: 10, webviewUri: null, imageName: null, isVideo: false,
};

const INITIAL_STATE: AppState = {
  editor:      { ...DEFAULT, enabled: true,  blur: 15 },
  sidebar:     { ...DEFAULT },
  terminal:    { ...DEFAULT, blur: 15 },
  activitybar: { ...DEFAULT, blur: 5  },
  statusbar:   { ...DEFAULT, blur: 0  },
  titlebar:    { ...DEFAULT, blur: 0  },
};

// ─── Region metadata ──────────────────────────────────────────────────────────

interface TabMeta {
  id: Region;
  label: string;
  desc: string;
  icon: React.ReactNode;
  previewType: 'editor' | 'sidebar' | 'terminal' | 'bar';
}

const TABS: TabMeta[] = [
  {
    id: 'editor', label: 'Editor', desc: 'Main code editing canvas',
    previewType: 'editor',
    icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>,
  },
  {
    id: 'sidebar', label: 'Explorer', desc: 'Explorer, Outline & Timeline',
    previewType: 'sidebar',
    icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>,
  },
  {
    id: 'terminal', label: 'Terminal', desc: 'Terminal, Output & Debug',
    previewType: 'terminal',
    icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>,
  },
  {
    id: 'activitybar', label: 'Activity Bar', desc: 'Left icon strip',
    previewType: 'bar',
    icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16"/></svg>,
  },
  {
    id: 'statusbar', label: 'Status Bar', desc: 'Bottom info strip',
    previewType: 'bar',
    icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"/></svg>,
  },
  {
    id: 'titlebar', label: 'Title Bar', desc: 'Top title / menu bar',
    previewType: 'bar',
    icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5h16v3H4V5zm0 5h16v2H4v-2zm0 5h10v2H4v-2z"/></svg>,
  },
];

// ─── Primitives ───────────────────────────────────────────────────────────────

function Checkmark() {
  return (
    <svg className="absolute w-[14px] h-[14px] text-vscode-checkbox-fg pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  );
}

// VS Code native-style checkbox (square, sharp, focus outline)
function Checkbox({
  checked, onChange, label, description
}: { checked: boolean; onChange: () => void; label?: string; description?: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <div className="relative flex items-center justify-center flex-shrink-0 mt-[2px]">
        <input
          type="checkbox"
          className="appearance-none w-4 h-4 rounded-[2px] border border-vscode-border bg-vscode-checkbox-bg cursor-pointer focus:outline focus:outline-1 focus:outline-vscode-focus focus:outline-offset-1"
          checked={checked}
          onChange={onChange}
        />
        {checked && <Checkmark />}
      </div>
      {(label || description) && (
        <div className="flex flex-col">
          {label && <span className="text-[13px] text-vscode-fg leading-tight">{label}</span>}
          {description && <span className="text-[12px] text-vscode-secondary-fg mt-[2px] leading-snug">{description}</span>}
        </div>
      )}
    </label>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] uppercase tracking-wider font-semibold text-vscode-secondary-fg mb-3">
      {children}
    </h3>
  );
}

// VS Code native button
function Button({ children, onClick, secondary, disabled, className = '' }: { children: React.ReactNode, onClick: () => void, secondary?: boolean, disabled?: boolean, className?: string }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`px-3 py-1.5 text-[13px] rounded-[2px] font-medium transition-colors focus:outline focus:outline-1 focus:outline-vscode-focus focus:outline-offset-1 flex items-center justify-center gap-1.5 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${secondary ? 'bg-vscode-button-secondary-bg hover:bg-vscode-button-secondary-hover text-vscode-button-secondary-fg' : 'bg-vscode-button-bg hover:bg-vscode-button-hover text-vscode-button-fg'} ${className}`}
    >
      {children}
    </button>
  );
}

// ─── Slider ───────────────────────────────────────────────────────────────────

function Slider({
  label, value, min, max, unit, disabled, onChange, description
}: {
  label: string; value: number; min: number; max: number;
  unit: string; disabled: boolean;
  onChange: (v: number) => void; description?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={`flex flex-col gap-1.5 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <div className="flex flex-col">
         <span className="text-[13px] text-vscode-fg leading-tight">{label} <span className="font-mono text-[11px] text-vscode-accent ml-1">{value}{unit}</span></span>
         {description && <span className="text-[12px] text-vscode-secondary-fg mt-[2px] leading-snug">{description}</span>}
      </div>
      <div className="relative h-5 flex items-center max-w-[200px] mt-1">
        {/* VS Code Native range track uses the border color and focus styles */}
        <div className="absolute inset-x-0 h-1 bg-vscode-input-bg border border-vscode-border rounded-sm"/>
        <div
          className="absolute left-0 h-1 rounded-sm pointer-events-none bg-vscode-focus"
          style={{ width: `${pct}%`, transition: 'width 30ms' }}
        />
        <input
          type="range" min={min} max={max} value={value}
          onChange={e => onChange(parseInt(e.target.value))}
          className="absolute inset-x-0 appearance-none bg-transparent cursor-pointer h-5 focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-vscode-focus focus-visible:outline-offset-1 slider-thumb-vscode"
        />
      </div>
      <style>{`
        .slider-thumb-vscode::-webkit-slider-thumb {
          appearance: none;
          width: 12px;
          height: 12px;
          background: var(--vscode-button-background, #0e639c);
          border-radius: 50%;
          cursor: pointer;
        }
        .slider-thumb-vscode:hover::-webkit-slider-thumb {
          background: var(--vscode-button-hoverBackground, #1177bb);
        }
      `}</style>
    </div>
  );
}

// ─── Live Preview ─────────────────────────────────────────────────────────────

/** Background layer shared by all preview types */
function BgLayer({ webviewUri, isVideo, opacity, blur, enabled }: {
  webviewUri: string | null; isVideo: boolean; opacity: number; blur: number; enabled: boolean;
}) {
  if (!webviewUri) return null;

  const outerStyle: React.CSSProperties = {
    opacity: enabled ? opacity / 100 : 0,
    transition: 'opacity 60ms',
  };

  const mediaStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0, right: 0, bottom: 0, left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    pointerEvents: 'none',
    filter: blur > 0 ? `blur(${(blur * 0.35).toFixed(1)}px)` : 'none',
    transform: blur > 0 ? 'scale(1.06)' : 'none',
    transition: 'filter 60ms',
  };

  if (isVideo) {
    return (
      <div className="absolute inset-0 overflow-hidden" style={outerStyle}>
        <video src={webviewUri} autoPlay loop muted playsInline style={mediaStyle} />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden" style={outerStyle}>
      <img
        src={webviewUri}
        alt="Preview Background"
        style={mediaStyle}
      />
    </div>
  );
}

function LivePreview({ meta, rs, onUploadClick }: {
  meta: TabMeta; rs: RegionState; onUploadClick: () => void;
}) {
  const bg = <BgLayer webviewUri={rs.webviewUri} isVideo={rs.isVideo} opacity={rs.opacity} blur={rs.blur} enabled={rs.enabled}/>;

  // Render dummy code/terminal tokens for mockups. 
  // We explicitly keep hardcoded mockup colors here because they represent code syntax highlighting, not VS Code structural UI.
  // ── Editor ────────────────────────────────────────────────────────────────
  if (meta.previewType === 'editor') {
    return (
      <div className="relative h-40 rounded-[2px] overflow-hidden border border-vscode-border bg-vscode-bg shadow-sm" onClick={!rs.webviewUri ? onUploadClick : undefined} style={{ cursor: !rs.webviewUri ? 'pointer' : 'default' }}>
        {bg}
        <div className="absolute inset-0 p-4 pointer-events-none">
          {[
            [{c:'#C678DD',w:34},{c:'',w:6},{c:'#61AFEF',w:60},{c:'#ABB2BF',w:8}],
            [{c:'',w:18},{c:'#E06C75',w:44},{c:'#ABB2BF',w:10},{c:'#98C379',w:68}],
            [{c:'',w:18},{c:'#C678DD',w:30},{c:'',w:6},{c:'#E06C75',w:38}],
            [{c:'#ABB2BF',w:8}],
            [],
            [{c:'#5C6370',w:100}],
          ].map((toks,i) => (
            <div key={i} className="flex items-center gap-1.5 mb-2">
              <span className="text-[10px] text-vscode-secondary-fg/50 w-4 text-right flex-shrink-0 mr-2">{i+1}</span>
              {toks.map((t,j) => t.c
                ? <div key={j} className="h-2.5 rounded-[1px]" style={{width:t.w,backgroundColor:t.c,opacity:0.9}}/>
                : <div key={j} style={{width:t.w}}/>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Sidebar ───────────────────────────────────────────────────────────────
  if (meta.previewType === 'sidebar') {
    return (
      <div className="relative h-40 rounded-[2px] overflow-hidden border border-vscode-border bg-vscode-sidebar shadow-sm" onClick={!rs.webviewUri ? onUploadClick : undefined} style={{ cursor: !rs.webviewUri ? 'pointer' : 'default' }}>
        {bg}
        <div className="absolute inset-0 p-3 pointer-events-none overflow-hidden">
          {[
            {indent:0, label:'▶ EXPLORER',      bold:true},
            {indent:0, label:'▶ OPEN EDITORS',  bold:false},
            {indent:0, label:'▼ CODESKIN',      bold:true},
            {indent:12,label:'📁 src',           bold:false},
            {indent:24,label:'📄 App.tsx',       bold:false},
            {indent:24,label:'📄 index.css',     bold:false},
            {indent:0, label:'▶ OUTLINE',        bold:false},
          ].map((row,i) => (
            <div key={i} className="flex items-center mb-1" style={{paddingLeft:row.indent}}>
              <div className="h-2 rounded-[1px]"
                style={{width:row.label.length*4.5, backgroundColor:row.bold?'var(--vscode-foreground)':'var(--vscode-descriptionForeground)', opacity:row.bold?0.8:0.5}}/>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Terminal ──────────────────────────────────────────────────────────────
  if (meta.previewType === 'terminal') {
    return (
      <div className="relative h-40 rounded-[2px] overflow-hidden border border-vscode-border bg-vscode-panel shadow-sm" onClick={!rs.webviewUri ? onUploadClick : undefined} style={{ cursor: !rs.webviewUri ? 'pointer' : 'default' }}>
        {bg}
        <div className="absolute inset-0 p-4 pointer-events-none">
          {[
            {prompt:true, text:'npm run build:webview', c:'#4EC9B0'},
            {prompt:false,text:'> webview@0.0.0 build',c:'#ABB2BF'},
            {prompt:false,text:'✓ built in 755ms',     c:'#98C379'},
            {prompt:false,text:'',                     c:'#ABB2BF'},
            {prompt:true, text:'',                     c:'#4EC9B0'},
          ].map((line,i) => (
            <div key={i} className="flex items-center gap-1.5 mb-2">
              {line.prompt && <span className="text-[11px]" style={{color:'var(--vscode-terminal-ansiBrightBlue, #4ea1df)'}}>$</span>}
              {line.text && <div className="h-2 rounded-[1px]" style={{width:line.text.length*4.5,backgroundColor:line.c,opacity:0.8}}/>}
              {line.prompt && !line.text && <div className="w-2 h-3.5 bg-vscode-fg opacity-70 animate-pulse"/>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Bar preview (activitybar / statusbar / titlebar) ──────────────────────
  const isActivity = meta.id === 'activitybar';
  const isStatus   = meta.id === 'statusbar';
  const isTitlebar = meta.id === 'titlebar';

  return (
    <div className="relative h-40 rounded-[2px] overflow-hidden border border-vscode-border bg-vscode-bg flex flex-col shadow-sm" onClick={!rs.webviewUri ? onUploadClick : undefined} style={{ cursor: !rs.webviewUri ? 'pointer' : 'default' }}>
      {/* Title bar row */}
      <div className="relative flex items-center px-3 gap-2 flex-shrink-0 border-b border-vscode-border" style={{height:28, backgroundColor:'var(--vscode-titleBar-activeBackground)'}}>
        {isTitlebar && bg}
        <div className="flex gap-1.5 z-10">
          {['#FF5F56','#FFBD2E','#27C93F'].map(c=><div key={c} className="w-2.5 h-2.5 rounded-full" style={{backgroundColor:c}}/>)}
        </div>
        <div className="flex-1 h-2 bg-vscode-fg/20 rounded-[1px] z-10" style={{maxWidth:120}}/>
      </div>

      {/* Middle row */}
      <div className="flex flex-1 min-h-0">
        {/* Activity bar */}
        <div className="relative w-10 flex flex-col items-center py-2 gap-3 flex-shrink-0 border-r border-vscode-border" style={{backgroundColor:'var(--vscode-activityBar-background)'}}>
          {isActivity && bg}
          {[...Array(4)].map((_,i)=><div key={i} className="w-5 h-5 rounded-[2px] bg-vscode-fg/30 z-10"/>)}
        </div>
        {/* Sidebar strip */}
        <div className="w-16 flex-shrink-0 border-r border-vscode-border" style={{backgroundColor:'var(--vscode-sideBar-background)'}}/>
        {/* Editor area */}
        <div className="flex-1 p-3" style={{backgroundColor:'var(--vscode-editor-background)'}}>
          {[70,88,55].map((w,i)=>(
            <div key={i} className="h-2 rounded-[1px] mb-2" style={{width:`${w}%`,backgroundColor:'var(--vscode-foreground)',opacity:0.15}}/>
          ))}
        </div>
      </div>

      {/* Status bar */}
      <div className="relative flex items-center px-3 gap-3 flex-shrink-0 border-t border-vscode-border" style={{height:22, backgroundColor: 'var(--vscode-statusBar-background)'}}>
        {isStatus && bg}
        {[48,28,38].map((w,i)=>(
          <div key={i} className="h-2 rounded-[1px] z-10" style={{width:w, backgroundColor:'var(--vscode-statusBar-foreground, white)', opacity:0.7}}/>
        ))}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab]     = useState<Region>('editor');
  const [state, setState]             = useState<AppState>(INITIAL_STATE);
  const [sameImageAll, setSameImageAll] = useState(false);
  const [autoSync, setAutoSync]       = useState(true);

  const meta    = TABS.find(t => t.id === activeTab)!;
  const region  = state[activeTab];

  // ── Notify host that webview is ready ───────────────────────────────────────
  useEffect(() => {
    vscode.postMessage({ command: 'READY' });
  }, []);

  // ── Sync from extension host ──────────────────────────────────────────────
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const msg = ev.data;
      if (msg.type === 'STATE_UPDATE' && msg.state) {
        setState(prev => {
          const next = { ...prev };
          (Object.keys(msg.state) as Region[]).forEach(r => {
            if (next[r]) next[r] = { ...prev[r], ...msg.state[r] };
          });
          return next;
        });
      } else if (msg.type === 'IMAGE_UPLOADED') {
        const update = {
          webviewUri: msg.webviewUri as string,
          isVideo:    msg.isVideo as boolean,
          imageName:  msg.imageName as string,
          enabled:    true,
        };
        setState(prev => {
          const next = { ...prev };
          if (sameImageAll) {
            ALL_REGIONS.forEach(r => {
              next[r] = { ...prev[r], ...update };
            });
            ALL_REGIONS.forEach(r => {
              if (r !== msg.region) {
                vscode.postMessage({ command: 'COPY_IMAGE', fromRegion: msg.region, toRegion: r });
              }
            });
          } else {
            next[msg.region as Region] = { ...prev[msg.region as Region], ...update };
          }
          return next;
        });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [sameImageAll]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const sendMsg = useCallback((msg: object) => vscode.postMessage(msg), []);

  const patch = useCallback((tab: Region, p: Partial<RegionState>) => {
    setState(prev => ({ ...prev, [tab]: { ...prev[tab], ...p } }));
  }, []);

  const handleToggle = () => {
    const v = !region.enabled;
    patch(activeTab, { enabled: v });
    sendMsg({ command: 'TOGGLE_REGION', region: activeTab, enabled: v });
  };

  const handleOpacity = (value: number) => {
    patch(activeTab, { opacity: value });
    sendMsg({ command: 'OPACITY_CHANGE', region: activeTab, value });
  };

  const handleBlur = (value: number) => {
    patch(activeTab, { blur: value });
    sendMsg({ command: 'BLUR_CHANGE', region: activeTab, value });
  };

  const handleClear = () => {
    patch(activeTab, { webviewUri: null, imageName: null, enabled: false });
    sendMsg({ command: 'CLEAR_IMAGE', region: activeTab });
  };

  const handleCopyToAll = () => {
    if (!region.webviewUri) return;
    const uri  = region.webviewUri;
    const name = region.imageName;
    const isVid = region.isVideo;
    setState(prev => {
      const next = { ...prev };
      ALL_REGIONS.forEach(r => {
        if (r !== activeTab) {
          next[r] = { ...prev[r], webviewUri: uri, imageName: name, isVideo: isVid, enabled: true };
        }
      });
      return next;
    });
    ALL_REGIONS.forEach(r => {
      if (r !== activeTab) {
        sendMsg({ command: 'COPY_IMAGE', fromRegion: activeTab, toRegion: r });
      }
    });
  };

  const handleAutoSyncToggle = () => {
    const next = !autoSync;
    setAutoSync(next);
    sendMsg({ command: 'SET_AUTO_SYNC', enabled: next });
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6 font-sans text-vscode-fg select-none flex gap-8">
      
      {/* ── Sidebar (Navigation) ── */}
      <div className="w-48 flex-shrink-0 border-r border-vscode-border pr-2 flex flex-col gap-1">
        <h2 className="text-[13px] uppercase tracking-wide font-semibold text-vscode-fg mb-3 px-2">CodeSkin Regions</h2>
        {TABS.map(tab => {
          const s = state[tab.id];
          const active = activeTab === tab.id;
          const hasImg = !!s.webviewUri;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center justify-between px-2 py-1.5 rounded-[2px] text-[13px] transition-colors cursor-pointer text-left w-full focus:outline focus:outline-1 focus:outline-vscode-focus focus:outline-offset-1 ${
                active ? 'bg-vscode-button-secondary-bg text-vscode-button-secondary-fg font-medium' : 'hover:bg-vscode-input-bg text-vscode-fg'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="opacity-80">{tab.icon}</span>
                {tab.label}
              </div>
              {hasImg && (
                <span className={`w-1.5 h-1.5 rounded-full ${s.enabled ? 'bg-vscode-success' : 'bg-vscode-secondary-fg'}`} title={s.enabled ? "Active" : "Paused"} />
              )}
            </button>
          );
        })}

        <div className="mt-8 pt-4 border-t border-vscode-border px-2">
           <h2 className="text-[13px] uppercase tracking-wide font-semibold text-vscode-fg mb-3">Global Settings</h2>
           <Checkbox
              checked={sameImageAll}
              onChange={() => setSameImageAll(v => !v)}
              label="Sync Region Uploads"
              description="Uploading an image applies it to all regions automatically."
           />
           <div className="h-4"></div>
           <Checkbox
              checked={autoSync}
              onChange={handleAutoSyncToggle}
              label="Auto-extract Theme"
              description="Generate a matching VS Code color theme on upload."
           />
        </div>
      </div>

      {/* ── Main Content Area ── */}
      <div className="flex-1 flex flex-col max-w-2xl">
        
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-normal text-vscode-fg mb-1">{meta.label} Settings</h1>
          <p className="text-[13px] text-vscode-secondary-fg">{meta.desc}</p>
        </div>

        {/* Enable Checkbox */}
        <div className="mb-8 border-b border-vscode-border pb-6">
          <Checkbox 
             checked={region.enabled} 
             onChange={handleToggle} 
             label={`Enable Custom Background for ${meta.label}`}
             description={`Turn this on to show your uploaded image or video behind the ${meta.label.toLowerCase()}.`}
          />
        </div>

        <SectionLabel>Wallpaper Source</SectionLabel>
        
        <div className="mb-8">
          <LivePreview
            meta={meta}
            rs={region}
            onUploadClick={() => sendMsg({ command: 'PICK_FILE', region: activeTab, autoSync })}
          />
          
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {region.webviewUri ? (
                 <>
                   <Button onClick={() => sendMsg({ command: 'PICK_FILE', region: activeTab, autoSync })}>
                     Change File...
                   </Button>
                   <Button onClick={handleClear} secondary>
                     Remove
                   </Button>
                 </>
              ) : (
                 <Button onClick={() => sendMsg({ command: 'PICK_FILE', region: activeTab, autoSync })}>
                   Choose File...
                 </Button>
              )}
            </div>

            {region.imageName && (
              <p className="text-[12px] text-vscode-secondary-fg font-mono max-w-[200px] truncate" title={region.imageName}>
                {region.isVideo ? '🎬' : '📎'} {region.imageName}
              </p>
            )}
          </div>
        </div>

        <SectionLabel>Appearance Adjustments</SectionLabel>
        <div className="flex flex-col gap-6 mb-8 border-b border-vscode-border pb-8">
           <Slider
             label="Opacity" value={region.opacity} min={0} max={100} unit="%"
             disabled={!region.enabled} onChange={handleOpacity}
             description="Adjust how visible the image is against the editor background."
           />
           <Slider
             label="Blur Radius" value={region.blur} min={0} max={50} unit="px"
             disabled={!region.enabled} onChange={handleBlur}
             description="Soften the image to improve text legibility."
           />
        </div>

        <SectionLabel>Actions</SectionLabel>
        <div className="flex flex-col items-start gap-3">
           <Button 
             disabled={!region.webviewUri} 
             onClick={() => {
               sendMsg({ command: 'APPLY_NOW', region: activeTab });
             }}
             className="w-full justify-center bg-vscode-accent text-white hover:bg-vscode-accent/90 py-2 text-[14px]"
           >
             <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
             </svg>
             Apply Background to VS Code
           </Button>

           <Button 
             secondary 
             disabled={!region.webviewUri} 
             onClick={handleCopyToAll}
             className="w-full justify-center"
           >
             <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
             </svg>
             Apply current wallpaper to all other regions
           </Button>

           <Button 
             secondary 
             disabled={!region.webviewUri || region.isVideo} 
             onClick={() => sendMsg({ command: 'EXTRACT_COLORS', region: activeTab })}
             className="w-full justify-center"
           >
             <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"/>
             </svg>
             {region.isVideo ? 'Color extraction disabled for video' : 'Extract matching VS Code Theme from wallpaper'}
           </Button>
        </div>

      </div>
    </div>
  );
}
