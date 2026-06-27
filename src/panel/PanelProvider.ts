import * as vscode  from 'vscode';
import * as fs      from 'fs';
import * as path    from 'path';
import * as crypto  from 'crypto';
import { CssManager, type InstallResult } from '../css/CssManager';
import { ColorExtractor }  from '../color/ColorExtractor';

// ─── JS runtime version ──────────────────────────────────────────────────────
//
// Increment this whenever the generated codeskin.js changes in a way that
// affects hot-reload behaviour. extension.ts reads the on-disk JS on every
// activation and forces a repair + reload prompt when this token is missing.
// Using a string token (not a number) so it can never collide accidentally.

const CODESKIN_JS_VERSION = 'codeskin-v2-tick-poll';

// ─── Domain types ────────────────────────────────────────────────────────────

type Region = 'editor' | 'sidebar' | 'terminal' | 'activitybar' | 'statusbar' | 'titlebar';

const ALL_REGIONS: readonly Region[] = [
    'editor', 'sidebar', 'terminal', 'activitybar', 'statusbar', 'titlebar',
];

interface RegionState {
    enabled:   boolean;
    opacity:   number;        // 0–100
    blur:      number;        // 0–50 px
    imagePath: string | null;
    imageName: string | null;
    isVideo:   boolean;
}

type AppState = Record<Region, RegionState>;

// ─── Region configuration table ──────────────────────────────────────────────
//
// Single source of truth for selectors + behaviour flags.
// Stored in insertion order so iteration is deterministic (O(n), n=6).

interface RegionConfig {
    readonly id:                Region;
    readonly selector:          string;
    readonly parentSelector?:   string;
    readonly fallbackSelector?: string;
    /** false for titlebar/sidebar — menus overflow those containers */
    readonly allowOverflowClip: boolean;
    /** Immutable CSS lines for transparency overrides (pre-computed at module load) */
    readonly transparencyLines: readonly string[];
}

const REGION_CONFIGS: readonly RegionConfig[] = [
    // ── Editor ───────────────────────────────────────────────────────────────
    // Target `.part.editor` (the full editor part) not the inner monaco node.
    // The inner .overflow-guard has overflow:hidden which clips the ::before.
    // We then make every monaco internal layer transparent so the ::before shows.
    {
        id: 'editor',
        selector: '.part.editor > .content',
        parentSelector: '.part.editor',
        allowOverflowClip: true,
        transparencyLines: [
            // Monaco editor background layers — ALL must be transparent
            `.monaco-editor                              { background: transparent !important; }`,
            `.monaco-editor-background                   { background: transparent !important; }`,
            `.monaco-editor .margin                      { background: transparent !important; }`,
            `.monaco-editor .margin-view-overlays        { background: transparent !important; }`,
            `.monaco-editor .lines-content               { background: transparent !important; }`,
            `.monaco-editor .view-overlays               { background: transparent !important; }`,
            `.monaco-editor .overflow-guard              { background: transparent !important; }`,
            `.monaco-editor .scroll-decoration           { background: transparent !important; }`,
            // VS Code 1.88+ sticky scroll widget
            `.monaco-editor .sticky-widget               { background: transparent !important; }`,
            `.editor-container                           { background: transparent !important; }`,
            `.editor-group-container                     { background: transparent !important; }`,
            `.editor-group-container .editor-group       { background: transparent !important; }`,
            // Empty editor placeholder
            `.editor-group-container.empty               { background: transparent !important; }`,
            `.tabs-and-actions-container                 { background: transparent !important; }`,
            `.tab-list                                   { background: transparent !important; }`,
            // Split view wrappers — each pane in a split layout is a .split-view-view
            `.part.editor .split-view-view               { background: transparent !important; }`,
            `.part.editor .editor-group-drop-overlay     { background: transparent !important; }`,
        ],
    },

    // ── Sidebar (Explorer) ────────────────────────────────────────────────────
    // allowOverflowClip: true is SAFE here — VS Code's context menus (right-click
    // on files) are rendered by ContextMenuService as `.context-view` elements
    // appended directly to `.monaco-workbench`, NOT as children of .part.sidebar.
    // So overflow:hidden does not clip them, and z-index:-1 on ::before works
    // the same way it does for the editor.
    {
        id: 'sidebar',
        selector: '.part.sidebar > .content',
        parentSelector: '.part.sidebar',
        allowOverflowClip: true,
        transparencyLines: [
            `.part.sidebar                                { background: transparent !important; }`,
            `.sidebar .composite.viewlet                  { background: transparent !important; }`,
            `.sidebar .split-view-view                    { background: transparent !important; }`,
            `.sidebar .pane-body                          { background: transparent !important; }`,
            `.sidebar .pane-header                        { background: transparent !important; }`,
            `.sidebar .monaco-list                        { background: transparent !important; }`,
            `.sidebar .monaco-list-rows                   { background: transparent !important; }`,
            `.sidebar .monaco-scrollable-element          { background: transparent !important; }`,
            `.sidebar .tree-explorer-viewlet-tree-view    { background: transparent !important; }`,
            // VS Code 1.90+ — composite section headers & welcome view
            `.sidebar .composite.title                    { background: transparent !important; }`,
            `.sidebar .views-welcome-container            { background: transparent !important; }`,
            // Embedded activity bar placeholder (VS Code 1.90+ with sidebar activity bar)
            `.sidebar .activitybar-placeholder            { background: transparent !important; }`,
        ],
    },

    // ── Terminal (bottom panel) ───────────────────────────────────────────────
    // .part.panel covers Output, Terminal, Debug Console, Problems.
    // The xterm canvas is transparent-by-default IF the container bg is gone.
    {
        id: 'terminal',
        selector: '.part.panel > .content',
        parentSelector: '.part.panel',
        allowOverflowClip: true,
        transparencyLines: [
            `.part.panel                                  { background: transparent !important; }`,
            `.part.panel .content                         { background: transparent !important; }`,
            `.panel .composite.panel                      { background: transparent !important; }`,
            `.terminal-outer-container                    { background: transparent !important; }`,
            `.terminal-wrapper                            { background: transparent !important; }`,
            `.xterm                                       { background: transparent !important; }`,
            `.xterm-viewport                              { background: transparent !important; }`,
            `.xterm-screen                                { background: transparent !important; }`,
            `.xterm-scroll-area                           { background: transparent !important; }`,
            // Panel action bar / title / header areas
            `.panel .panel-switcher-container             { background: transparent !important; }`,
            `.panel .title                                { background: transparent !important; }`,
            `.panel .panel-header                         { background: transparent !important; }`,
            `.panel .split-view-view                      { background: transparent !important; }`,
        ],
    },

    // ── Activity Bar ─────────────────────────────────────────────────────────
    // VS Code 1.90+ moved the activity bar into the sidebar in some configs.
    // We cover ALL known class names across VS Code versions.
    {
        id: 'activitybar',
        selector: '.part.activitybar',
        fallbackSelector: '.activitybar.left',
        allowOverflowClip: true,
        transparencyLines: [
            // VS Code 1.90+ primary selector
            `.part.activitybar                              { background: transparent !important; }`,
            `.part.activitybar > .content                   { background: transparent !important; }`,
            `.part.activitybar .composite-bar               { background: transparent !important; }`,
            `.part.activitybar .composite-bar-container     { background: transparent !important; }`,
            `.part.activitybar .composite-bar-action-item   { background: transparent !important; }`,
            `.part.activitybar .action-item                 { background: transparent !important; }`,
            `.part.activitybar .actions-container           { background: transparent !important; }`,
            `.part.activitybar .monaco-action-bar           { background: transparent !important; }`,
            `.part.activitybar .global-activity             { background: transparent !important; }`,
            `.part.activitybar .global-activity-actions     { background: transparent !important; }`,
            `.part.activitybar .activity-bar-badge-content  { background: transparent !important; }`,
            // Legacy class names (VS Code < 1.90)
            `.activitybar.left                              { background: transparent !important; }`,
            `.activitybar.left > .content                   { background: transparent !important; }`,
            `.activitybar.left .composite-bar               { background: transparent !important; }`,
            `.activitybar.left .composite-bar-container     { background: transparent !important; }`,
            `.activitybar.left .actions-container           { background: transparent !important; }`,
        ],
    },

    // ── Status Bar ────────────────────────────────────────────────────────────
    {
        id: 'statusbar',
        selector: '.part.statusbar',
        allowOverflowClip: true,
        transparencyLines: [
            `.part.statusbar                                { background: transparent !important; }`,
            `.statusbar-item                                { background: transparent !important; }`,
            // VS Code 1.85+: items with explicit background-color set by theme
            `.statusbar-item.has-background-color           { background: transparent !important; }`,
            `.part.statusbar .status-bar-info               { background: transparent !important; }`,
        ],
    },

    // ── Title Bar ─────────────────────────────────────────────────────────────
    // allowOverflowClip: false — menubar dropdowns ARE children of .part.titlebar
    // (File/Edit/View menus), so overflow:hidden would clip them.
    // Instead we use z-index:0 on ::before (not -1) and elevate .titlebar-container
    // to z-index:1 so it always sits above the wallpaper layer.
    // VS Code's own menu dropdown z-indices are in the thousands, so they remain
    // fully above z-index:1 within the titlebar's stacking context.
    {
        id: 'titlebar',
        selector: '.part.titlebar',
        allowOverflowClip: false,
        transparencyLines: [
            `.part.titlebar                                 { background: transparent !important; }`,
            // Elevate the content container above the z-index:0 ::before wallpaper layer.
            // position:relative creates a local stacking context so z-index:1 takes effect.
            `.part.titlebar > .titlebar-container           { position: relative !important; z-index: 1 !important; background: transparent !important; }`,
            // VS Code 1.85+ custom title bar sub-sections — all transparent
            `.part.titlebar .titlebar-left                  { background: transparent !important; }`,
            `.part.titlebar .titlebar-center                { background: transparent !important; }`,
            `.part.titlebar .titlebar-right                 { background: transparent !important; }`,
            `.part.titlebar .menubar                        { background: transparent !important; }`,
            `.part.titlebar .window-appicon                 { background: transparent !important; }`,
            `.part.titlebar .titlebar-drag-region           { background: transparent !important; }`,
        ],
    },
];

// Build a lookup Map<Region, RegionConfig> for O(1) access by id
// (used in cache-miss paths so we don't linear-scan REGION_CONFIGS).
const REGION_CONFIG_MAP = new Map<Region, RegionConfig>(
    REGION_CONFIGS.map(c => [c.id, c]),
);

// ─── Default / initial state ──────────────────────────────────────────────────

const BASE_DEFAULT: RegionState = {
    enabled: false, opacity: 60, blur: 0,
    imagePath: null, imageName: null, isVideo: false,
};

const INITIAL_STATE: AppState = {
    editor:      { ...BASE_DEFAULT, enabled: true, opacity: 80, blur: 2 },
    sidebar:     { ...BASE_DEFAULT, opacity: 50 },
    terminal:    { ...BASE_DEFAULT, opacity: 50 },
    activitybar: { ...BASE_DEFAULT, opacity: 80 },
    statusbar:   { ...BASE_DEFAULT, opacity: 80 },
    titlebar:    { ...BASE_DEFAULT, opacity: 80 },
};

// ─── Webview message types ─────────────────────────────────────────────────────

type WebviewMessage =
    | { command: 'READY' }
    | { command: 'PICK_FILE';      region: Region; autoSync: boolean }
    | { command: 'COPY_IMAGE';     fromRegion: Region; toRegion: Region }
    | { command: 'CLEAR_IMAGE';    region: Region }
    | { command: 'OPACITY_CHANGE'; region: Region; value: number }
    | { command: 'BLUR_CHANGE';    region: Region; value: number }
    | { command: 'TOGGLE_REGION';  region: Region; enabled: boolean }
    | { command: 'SET_AUTO_SYNC';  enabled: boolean }
    | { command: 'APPLY_NOW';      region: Region }
    | { command: 'EXTRACT_COLORS'; region: Region };

interface VideoConfig {
    selector: string;
    videoUrl: string;
    opacity:  string;  // pre-formatted "0.800"
    blur:     number;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number =>
    v < lo ? lo : v > hi ? hi : v;

const fsPathToVscodeUri = (fsPath: string): string => {
    let p = fsPath.replace(/\\/g, '/');
    if (!p.startsWith('/')) { p = '/' + p; }
    return `vscode-file://vscode-app${p}`;
};

/** FNV-1a 32-bit hash — fast, low collision, no crypto overhead. */
function fnv1a32(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
    }
    return h;
}

// ─── PanelProvider ────────────────────────────────────────────────────────────

/**
 * Manages the CodeSkin settings webview panel.
 *
 * Performance architecture
 * ────────────────────────
 *  1. **Per-region CSS cache** (`_cssCache: Map<Region,string>`)
 *     Each region's CSS block is generated only when that region's state
 *     changes.  Full CSS is assembled by joining cached blocks → O(1) per
 *     hot path vs. O(6) full regeneration on every slider tick.
 *
 *  2. **Content-hash gating** (`_fileHashes: Map<path,number>`)
 *     Before writing any file to disk we compute its FNV-1a hash.  If the
 *     hash matches the previous write we skip the I/O entirely.  This
 *     eliminates all redundant disk writes when the user releases a slider
 *     at the same position.
 *
 *  3. **Dirty-region tracking** (`_dirtyRegions: Set<Region>`)
 *     Only dirty (changed) regions regenerate their CSS block.  Clean
 *     regions read from the cache.
 *
 *  4. **Single videoConfig build per apply cycle**
 *     Previously built twice (once for JS embed, once for state JSON).
 *     Now built once, passed to both consumers.
 *
 *  5. **Debounce with captured last-known region**
 *     Slider changes reset the debounce timer and update the dirty set.
 *     The trailing-edge fire processes the final value, not an intermediate.
 *
 *  6. **Selective webview URI recompute**
 *     `_pushStateToWebview()` only calls `asWebviewUri` for regions whose
 *     imagePath changed since the last push.
 */
export class PanelProvider {
    public  static currentPanel: PanelProvider | undefined;

    private readonly _panel:       vscode.WebviewPanel;
    private readonly _context:     vscode.ExtensionContext;
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _cssManager:  CssManager;

    // ── Mutable state ─────────────────────────────────────────────────────────

    private _state:  AppState;
    private _installed = false;

    // ── Performance structures ────────────────────────────────────────────────

    /**
     * Per-region CSS block cache.
     * Key: Region   Value: the CSS text for that region (or '' when disabled)
     * Invalidated when that region's state changes.
     * Complexity: O(1) lookup, O(1) insert.
     */
    private readonly _cssCache = new Map<Region, string>();

    /**
     * Last FNV-1a hash of each file written to disk.
     * Skips the write when hash matches → eliminates redundant I/O.
     * Key: absolute file path   Value: FNV-1a hash of last written content.
     */
    private readonly _fileHashes = new Map<string, number>();

    /**
     * Regions with pending state changes not yet reflected in the CSS cache.
     * Populated by every mutation handler; cleared after `_applyNow` rebuilds
     * the affected blocks.
     */
    private readonly _dirtyRegions = new Set<Region>();

    /**
     * Last webview URI emitted per region.
     * Used to skip `asWebviewUri` calls when the imagePath has not changed.
     */
    private readonly _lastWebviewUri = new Map<Region, string | null>();

    /** Debounce handle for slider changes. */
    private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private static readonly DEBOUNCE_MS = 50;

    // ─────────────────────────────────────────────────────────────────────────

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this._panel      = panel;
        this._context    = context;
        this._cssManager = new CssManager(context);
        this._state      = this._loadPersistedState();

        // Prime the CSS cache for every region from persisted state so the
        // first _applyNow doesn't start cold.
        for (const r of ALL_REGIONS) {
            this._dirtyRegions.add(r);  // mark all dirty → cache will fill on first apply
        }

        this._panel.webview.html = this._buildHtml(this._panel.webview);
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            (msg: unknown) => this._handleMessage(msg as WebviewMessage),
            null,
            this._disposables,
        );

        // Seed _installed from disk so we don't re-prompt for reload when the
        // injection is already in place (avoids repeated "Reload Window" toasts
        // every time the user opens the CodeSkin panel after a reload).
        this._cssManager.isInstalled().then(already => {
            if (already) { this._installed = true; }
        }).catch(() => { /* non-fatal */ });
    }

    // ── Static factory ────────────────────────────────────────────────────────

    public static createOrShow(context: vscode.ExtensionContext): void {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Two;

        if (PanelProvider.currentPanel) {
            PanelProvider.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'codeskinPanel', 'CodeSkin',
            { viewColumn: column, preserveFocus: true },
            {
                enableScripts:           true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'webview', 'dist'),
                    // Must be file: scheme so asWebviewUri scheme comparison succeeds
                    vscode.Uri.file(context.globalStorageUri.fsPath),
                ],
            },
        );

        PanelProvider.currentPanel = new PanelProvider(panel, context);
    }

    /**
     * The version token embedded in every generated codeskin.js.
     * extension.ts reads the on-disk JS and checks for this token.
     * If missing (old JS version), it forces a repair + reload.
     */
    static get jsVersion(): string { return CODESKIN_JS_VERSION; }

    // ── State persistence ─────────────────────────────────────────────────────

    private _loadPersistedState(): AppState {
        const saved = this._context.globalState.get<Partial<AppState>>('codeskin.state');
        const state  = structuredClone(INITIAL_STATE);

        if (!saved) { return state; }

        for (const r of ALL_REGIONS) {
            const src = saved[r];
            if (!src) { continue; }
            state[r] = {
                enabled:   typeof src.enabled   === 'boolean' ? src.enabled                     : state[r].enabled,
                opacity:   typeof src.opacity   === 'number'  ? clamp(src.opacity,   0, 100)    : state[r].opacity,
                blur:      typeof src.blur      === 'number'  ? clamp(src.blur,       0,  50)   : state[r].blur,
                imagePath: typeof src.imagePath === 'string'  ? src.imagePath                   : null,
                imageName: typeof src.imageName === 'string'  ? src.imageName                   : null,
                isVideo:   typeof src.isVideo   === 'boolean' ? src.isVideo                     : false,
            };
        }

        return state;
    }

    /**
     * Persist state to VS Code global storage.
     * Uses `structuredClone` to snapshot state so concurrent mutations
     * during a long async path don't corrupt the stored value.
     */
    private async _persistState(): Promise<void> {
        await this._context.globalState.update(
            'codeskin.state',
            structuredClone(this._state),
        );
    }

    // ── Message handler ───────────────────────────────────────────────────────

    private async _handleMessage(message: WebviewMessage): Promise<void> {
        if ('region' in message && message.region && !ALL_REGIONS.includes(message.region)) {
            console.warn('[CodeSkin] Unknown region:', message);
            return;
        }

        switch (message.command) {
            case 'READY':
                this._pushStateToWebview();
                break;

            case 'PICK_FILE':
                await this._handlePickFile(message.region, message.autoSync);
                break;

            case 'COPY_IMAGE':
                await this._handleCopyImage(message.fromRegion, message.toRegion);
                break;

            case 'CLEAR_IMAGE':
                this._state[message.region].imagePath = null;
                this._state[message.region].imageName = null;
                this._state[message.region].enabled   = false;
                this._invalidateCache(message.region);
                await this._applyNow(message.region);
                break;

            case 'OPACITY_CHANGE':
                this._state[message.region].opacity = clamp(message.value, 0, 100);
                this._invalidateCache(message.region);
                this._scheduleDebounced(message.region);
                break;

            case 'BLUR_CHANGE':
                this._state[message.region].blur = clamp(message.value, 0, 50);
                this._invalidateCache(message.region);
                this._scheduleDebounced(message.region);
                break;

            case 'TOGGLE_REGION':
                this._state[message.region].enabled = message.enabled;
                this._invalidateCache(message.region);
                await this._applyNow(message.region);
                break;

            case 'SET_AUTO_SYNC':
                await this._context.globalState.update('codeskin.autoSync', message.enabled);
                break;

            case 'APPLY_NOW':
                await this._applyNow(message.region);
                vscode.window.showInformationMessage('CodeSkin: Background applied ✓');
                break;

            case 'EXTRACT_COLORS':
                await this._handleExtractColors(message.region);
                break;

            default:
                console.warn('[CodeSkin] Unhandled command:', (message as { command: string }).command);
        }
    }

    // ── Cache invalidation ────────────────────────────────────────────────────

    /**
     * Mark a region's CSS cache entry as stale.
     * O(1).  The actual rebuild is deferred until `_applyNow` runs.
     */
    private _invalidateCache(region: Region): void {
        this._dirtyRegions.add(region);
    }

    // ── Message sub-handlers ──────────────────────────────────────────────────

    private async _handlePickFile(region: Region, autoSync: boolean): Promise<void> {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel:     'Select Wallpaper',
            filters: { Images: ['png', 'jpg', 'jpeg', 'webp', 'gif'], Videos: ['mp4', 'webm'] },
        });

        if (!uris || uris.length === 0) { return; }

        const src   = uris[0];
        const ext   = path.extname(src.fsPath).toLowerCase().replace('.', '');
        const isVid = ext === 'mp4' || ext === 'webm';

        let savedPath: string;
        try {
            savedPath = await this._cssManager.saveImage(region, src.fsPath);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[CodeSkin] saveImage failed:', err);
            vscode.window.showErrorMessage(`CodeSkin: Could not save wallpaper — ${msg}`);
            return;
        }

        this._state[region] = {
            ...this._state[region],
            imagePath: savedPath,
            imageName: path.basename(src.fsPath),
            isVideo:   isVid,
            enabled:   true,
        };
        this._invalidateCache(region);

        // Notify webview for the preview pane immediately (non-blocking)
        const previewUri = this._panel.webview
            .asWebviewUri(vscode.Uri.file(savedPath))
            .toString() + `?t=${Date.now()}`;

        this._panel.webview.postMessage({
            type: 'IMAGE_UPLOADED', region,
            webviewUri: previewUri, isVideo: isVid,
            imageName: path.basename(src.fsPath),
        });

        // Color extraction and CSS apply can run concurrently
        const applyPromise = this._applyNow(region);
        if (autoSync) {
            const [, colorOk] = await Promise.all([
                applyPromise,
                ColorExtractor.extractAndApply(savedPath),
            ]);
            if (!colorOk) {
                vscode.window.showWarningMessage(
                    'CodeSkin: Color extraction failed — see Output panel.',
                );
            }
        } else {
            await applyPromise;
        }
    }

    private async _handleCopyImage(fromRegion: Region, toRegion: Region): Promise<void> {
        const src = this._state[fromRegion];
        this._state[toRegion] = {
            ...this._state[toRegion],
            imagePath: src.imagePath,
            imageName: src.imageName,
            isVideo:   src.isVideo,
            enabled:   true,
        };
        this._invalidateCache(toRegion);
        await this._applyNow(toRegion);
    }

    private async _handleExtractColors(region: Region): Promise<void> {
        const imgPath = this._state[region].imagePath;
        if (!imgPath) {
            vscode.window.showWarningMessage(
                `CodeSkin: No wallpaper for ${region}. Upload an image first.`,
            );
            return;
        }
        const ok = await ColorExtractor.extractAndApply(imgPath);
        if (ok) {
            vscode.window.showInformationMessage(
                'CodeSkin: Colors extracted ✓  Reload to see theme change.',
            );
        } else {
            vscode.window.showErrorMessage(
                'CodeSkin: Color extraction failed. Check the Output panel.',
            );
        }
    }

    // ── Apply pipeline ────────────────────────────────────────────────────────

    /**
     * Trailing-edge debounce for slider changes.
     *
     * The dirty-region set accumulates all affected regions during the quiet
     * period.  When the timer fires, a single `_applyNow` flush processes
     * every pending region in one CSS generation + one set of file writes.
     */
    private _scheduleDebounced(region: Region): void {
        // Region already in _dirtyRegions from _invalidateCache — no extra work here.
        if (this._debounceTimer !== null) { clearTimeout(this._debounceTimer); }
        this._debounceTimer = setTimeout(async () => {
            this._debounceTimer = null;
            await this._applyNow(region);
        }, PanelProvider.DEBOUNCE_MS);
    }

    /**
     * Core apply pipeline.
     *
     * Execution order:
     *  1. Rebuild CSS blocks only for dirty regions  → O(dirty) not O(6)
     *  2. Assemble full CSS from cache               → O(6) join
     *  3. Compute video configs once                 → O(6)
     *  4. Hash-gate each file write                  → skips unchanged files
     *  5. Patch workbench.html once per session
     *  6. Push updated state to webview
     *
     * All disk I/O runs in parallel via `Promise.all`.
     */
    private async _applyNow(region: Region): Promise<void> {
        // ── 1 & 2. Incremental CSS generation ────────────────────────────────
        // Only rebuild cache entries for regions that changed.
        for (const r of this._dirtyRegions) {
            this._cssCache.set(r, this._buildRegionCss(r));
        }
        this._dirtyRegions.clear();

        // Assemble full CSS from cache (always O(6) join)
        const css = '/* CodeSkin — generated, do not edit manually */\n\n' +
            ALL_REGIONS.map(r => this._cssCache.get(r) ?? '').join('\n');

        // ── 3. Build video config once ────────────────────────────────────────
        const videos = this._buildVideoConfigs();

        // ── 4 & 5. Parallel disk writes + persist (hash-gated) ───────────────
        // Embed the current VS Code version so extension.ts can detect updates.
        const stateObj = { css, videos, _vscodeVersion: vscode.version };
        const js       = this._generateJs(videos);

        await Promise.all([
            this._persistState(),
            this._writeIfChanged(this._cssManager.cssFilePath,   css),
            this._writeIfChanged(this._cssManager.jsFilePath,    js),
            this._writeIfChanged(this._cssManager.stateFilePath, JSON.stringify(stateObj)),
        ]);

        // ── 5b. Write a tick file to signal the injected script instantly ───────
        // The injected codeskin.js polls two files: the full state JSON (100ms)
        // and a tiny tick file (50ms). The tick file is just a counter number.
        // Because the tick is a single number (e.g. "42\n"), reading it is near-
        // instantaneous. When the tick changes, the JS immediately triggers a
        // full state fetch — giving effectively zero-lag updates for all regions
        // (Activity Bar, Status Bar, Editor, etc.) without VS Code API tricks.
        this._writeTick();

        // ── 6. Patch workbench.html exactly once per session ──────────────────────
        if (!this._installed) {
            const result = await this._cssManager.install();
            if (!result.ok) {
                this._showInstallError(result);
                return;
            }
            this._installed = true;

            const label  = region.charAt(0).toUpperCase() + region.slice(1);
            const action = await vscode.window.showInformationMessage(
                `CodeSkin: ${label} background applied. Reload window to activate.`,
                'Reload Window', 'Later',
            );
            if (action === 'Reload Window') {
                await vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
            return;
        }

        // ── 7. Sync UI ────────────────────────────────────────────────────────────
        this._pushStateToWebview();
    }

    /** Monotonically increasing tick counter persisted across reloads. */
    private _tick = 0;

    /**
     * Write a tiny tick file so the injected workbench script can detect
     * state changes without reading the full state JSON on every poll.
     *
     * The tick file is a single integer followed by a newline — ~3 bytes.
     * The injected JS polls it every 50ms (vs. 100ms for the full state).
     * When it detects a tick change it immediately fetches the full state.
     * This gives effectively instant UI updates with negligible I/O cost.
     */
    private _writeTick(): void {
        this._tick++;
        const tickPath = this._cssManager.tickFilePath;
        fs.promises.writeFile(tickPath, String(this._tick)).catch(() => { /* non-fatal */ });
    }

    // ── VS Code update repair ─────────────────────────────────────────────────

    /**
     * Called by `extension.ts` on activation when we detect that VS Code
     * auto-updated and wiped our `workbench.html` injection.
     *
     * Re-writes the CSS/JS/state files from persisted state and re-patches
     * workbench.html.  If no state exists (first run) does nothing.
     *
     * The user is shown a single notification with a Reload button.
     */
    async repairAfterVscodeUpdate(): Promise<void> {
        // Nothing to repair if no wallpaper has ever been configured
        const hasAnyImage = ALL_REGIONS.some(r => this._state[r].imagePath !== null);
        if (!hasAnyImage) { return; }

        console.log('[CodeSkin] VS Code update detected — re-applying styles…');

        // Rebuild and write the generated files from current in-memory state
        for (const r of ALL_REGIONS) { this._dirtyRegions.add(r); }

        for (const r of this._dirtyRegions) {
            this._cssCache.set(r, this._buildRegionCss(r));
        }
        this._dirtyRegions.clear();

        const css    = '/* CodeSkin — generated, do not edit manually */\n\n' +
            ALL_REGIONS.map(r => this._cssCache.get(r) ?? '').join('\n');
        const videos = this._buildVideoConfigs();
        const js     = this._generateJs(videos);

        await Promise.all([
            this._persistState(),
            this._cssManager.updateCss(css),
            this._cssManager.updateJs(js),
            this._cssManager.updateState({ css, videos }),
        ]);

        const result = await this._cssManager.install();
        if (!result.ok) {
            this._showInstallError(result);
            return;
        }
        this._installed = true;

        const action = await vscode.window.showInformationMessage(
            'CodeSkin: VS Code updated — backgrounds re-applied. Reload to activate.',
            'Reload Window',
            'Later',
        );
        if (action === 'Reload Window') {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    }

    /** Show a user-friendly error based on the typed InstallResult. */
    private _showInstallError(result: InstallResult & { ok: false }): void {
        if (result.reason === 'permission') {
            vscode.window.showErrorMessage(
                `CodeSkin: ${result.message}`,
                'OK',
            );
        } else {
            vscode.window.showErrorMessage(`CodeSkin: ${result.message}`);
        }
    }

    /**
     * Write `content` to `filePath` only when the FNV-1a hash of `content`
     * differs from the last write.
     *
     * This eliminates disk I/O when slider is released at the same value,
     * or when a no-op toggle fires.
     * Complexity: O(n) where n = content length (hash), O(1) comparison.
     */
    private async _writeIfChanged(filePath: string, content: string): Promise<void> {
        const hash = fnv1a32(content);
        if (this._fileHashes.get(filePath) === hash) {
            return; // content identical — skip I/O
        }
        this._fileHashes.set(filePath, hash);

        switch (filePath) {
            case this._cssManager.cssFilePath:
                await this._cssManager.updateCss(content);
                break;
            case this._cssManager.jsFilePath:
                await this._cssManager.updateJs(content);
                break;
            case this._cssManager.stateFilePath:
                await this._cssManager.updateState(JSON.parse(content));
                break;
        }
    }

    // ── CSS generation ────────────────────────────────────────────────────────

    /**
     * Build the CSS block for a single region.
     *
     * Layering model
     * ──────────────
     *  .part.editor  ← position:relative; background:transparent  ← KEY
     *    ::before    ← position:absolute; z-index:-1; background-image (wallpaper)
     *    > .content  ← normal flow, renders on top naturally
     *      .monaco-editor  ← background:transparent (all layers)
     *
     * Why this works:
     *  • `z-index:-1` on ::before puts it behind the parent's content but NOT
     *    behind the parent element itself — it stays inside the .part.xxx box.
     *  • Making the PARENT background transparent (not just children) is what
     *    reveals the ::before layer; without this step, the parent's own
     *    background-color paints over the ::before.
     *  • We do NOT use `isolation:isolate` — that creates a new stacking context
     *    which traps VS Code's dropdown menus (File/Edit/View/context menus) inside
     *    the part, making them render behind adjacent parts and become invisible.
     */
    private _buildRegionCss(id: Region): string {
        const s   = this._state[id];
        const cfg = REGION_CONFIG_MAP.get(id)!;

        if (!s.enabled || !s.imagePath) { return ''; }

        const opacity = clamp(s.opacity / 100, 0, 1).toFixed(3);
        const blurPx  = clamp(s.blur, 0, 50);
        const imgUrl  = fsPathToVscodeUri(s.imagePath);

        // The ::before goes on the PARENT (full part container), not the child.
        // For regions without parentSelector the selector IS the parent.
        const parent      = cfg.parentSelector ?? cfg.selector;
        const child       = cfg.selector;
        const fallback    = cfg.fallbackSelector;

        // Fallback-aware comma lists
        const parentBoth     = fallback ? `${parent},\n${fallback}` : parent;
        const parentBefore   = fallback
            ? `${parent}::before,\n${fallback}::before`
            : `${parent}::before`;
        const childBoth      = (child !== parent)
            ? (fallback ? `${child}` : child)
            : null;

        const lines: string[] = [];

        // ── Parent container ──────────────────────────────────────────────────
        // position:relative  → anchors the absolute ::before
        // background:transparent → reveals the ::before behind it
        // NO isolation:isolate  → preserves the global stacking context so
        //                         VS Code's menus/popups/overlays still work
        lines.push(`${parentBoth} {`);
        lines.push(`  position: relative !important;`);
        lines.push(`  background: transparent !important;`);
        if (cfg.allowOverflowClip) {
            lines.push(`  overflow: hidden !important;`);
        }
        lines.push(`}`);

        // ── Child content container (overflow-clip regions only) ─────────────
        // For allowOverflowClip regions (z-index:-1 approach), make the child
        // transparent so the ::before shines through.
        // For non-overflow regions the child block is handled below (with z-index:1).
        if (childBoth && cfg.allowOverflowClip) {
            lines.push(`${childBoth} {`);
            lines.push(`  background: transparent !important;`);
            lines.push(`}`);
        }

        // ── Child content container ───────────────────────────────────────────
        // When the region cannot use overflow:hidden (e.g. titlebar, whose menu
        // dropdowns are DOM children and would be clipped), we use z-index:0 on
        // ::before instead of -1.  The child container is then elevated to z-index:1
        // so it naturally sits above the wallpaper layer.  VS Code's own overlays
        // (menus, popups) use z-indices in the thousands and remain unaffected.
        //
        // When overflow:hidden IS set (editor, sidebar, activitybar, statusbar,
        // terminal), Chromium's paint containment traps the ::before inside the
        // parent's visual box correctly, so z-index:-1 is safe and preferred
        // because it avoids creating any new stacking context on children.
        const zForBefore = cfg.allowOverflowClip ? -1 : 0;

        // For non-overflow regions with a separate child selector, elevate the
        // child to z-index:1 so it paints above the z-index:0 ::before.
        if (childBoth && !cfg.allowOverflowClip) {
            lines.push(`${childBoth} {`);
            lines.push(`  background: transparent !important;`);
            lines.push(`  position: relative !important;`);
            lines.push(`  z-index: 1 !important;`);
            lines.push(`}`);
        }

        // ── ::before — the actual background image layer ─────────────────────
        lines.push(`${parentBefore} {`);
        lines.push(`  content: '' !important;`);
        lines.push(`  position: absolute !important;`);
        lines.push(`  inset: 0 !important;`);
        lines.push(`  z-index: ${zForBefore} !important;`);
        lines.push(`  pointer-events: none !important;`);

        if (!s.isVideo) {
            lines.push(`  background-image: url('${imgUrl}') !important;`);
            lines.push(`  background-size: cover !important;`);
            lines.push(`  background-position: center !important;`);
            lines.push(`  background-repeat: no-repeat !important;`);
        }

        lines.push(`  opacity: ${opacity} !important;`);

        if (blurPx > 0) {
            lines.push(`  filter: blur(${blurPx}px) !important;`);
            lines.push(`  transform: scale(1.05) !important;`); // hide blur edge bleed
        }

        lines.push(`}`);

        // ── Transparency overrides ────────────────────────────────────────────
        // Pre-built constant strings — no allocation at call time.
        lines.push(...cfg.transparencyLines);
        lines.push('');

        return lines.join('\n');
    }



    // ── Video config + JS generation ──────────────────────────────────────────

    /** Build video config map. Called once per apply cycle. O(6). */
    private _buildVideoConfigs(): Record<string, VideoConfig> {
        const result: Record<string, VideoConfig> = {};
        for (const cfg of REGION_CONFIGS) {
            const s = this._state[cfg.id];
            if (!s.enabled || !s.imagePath || !s.isVideo) { continue; }

            result[cfg.id] = {
                selector: cfg.fallbackSelector
                    ? `${cfg.selector}, ${cfg.fallbackSelector}`
                    : cfg.selector,
                videoUrl: fsPathToVscodeUri(s.imagePath),
                opacity:  clamp(s.opacity / 100, 0, 1).toFixed(3),
                blur:     clamp(s.blur, 0, 50),
            };
        }
        return result;
    }

    /**
     * Generate the JS bootstrap injected into workbench.html.
     *
     * Design decisions:
     *  - Video configs are embedded so first-paint has zero fetch latency.
     *  - Dual-poll hot-reload: a tiny tick file (50ms) triggers an immediate
     *    full state fetch when changed. Full state poll runs at 500ms as fallback.
     *  - Tick file is ~3 bytes (a counter integer), making the fast poll
     *    near-zero cost even at 50ms intervals.
     *  - ETag-based change detection avoids re-applying identical state.
     *  - `document.visibilityState` check stops the poll when VS Code is backgrounded.
     */
    private _generateJs(videoConfigs: Record<string, VideoConfig>): string {
        let rawPath = this._cssManager.stateFilePath.replace(/\\/g, '/');
        if (!rawPath.startsWith('/')) { rawPath = '/' + rawPath; }
        const stateUrl = `vscode-file://vscode-app${rawPath}`;

        let rawTickPath = this._cssManager.tickFilePath.replace(/\\/g, '/');
        if (!rawTickPath.startsWith('/')) { rawTickPath = '/' + rawTickPath; }
        const tickUrl = `vscode-file://vscode-app${rawTickPath}`;

        return /* js */`/* CodeSkin — generated, do not edit manually */
/* ${CODESKIN_JS_VERSION} */
(function () {
    'use strict';

    /** @type {Record<string,{selector:string,videoUrl:string,opacity:string,blur:number}>} */
    let videoConfigs = ${JSON.stringify(videoConfigs, null, 2)};

    // ── Video management ──────────────────────────────────────────────────────

    function upsertVideo(container, id, cfg) {
        const cls   = 'codeskin-video-' + id;
        let   video = container.querySelector('.' + cls);

        if (!video) {
            video               = document.createElement('video');
            video.className     = 'codeskin-video ' + cls;
            video.autoplay      = true;
            video.loop          = true;
            video.muted         = true;
            video.style.cssText =
                'position:absolute;inset:0;width:100%;height:100%;' +
                'object-fit:cover;pointer-events:none;z-index:-1;';
            container.style.setProperty('position', 'relative', 'important');
            container.insertBefore(video, container.firstChild);
        }

        if (video.src !== cfg.videoUrl)   { video.src = cfg.videoUrl; }
        video.style.opacity   = cfg.opacity;
        video.style.filter    = cfg.blur > 0 ? 'blur(' + cfg.blur + 'px)' : 'none';
        video.style.transform = cfg.blur > 0 ? 'scale(1.05)' : 'none';
    }

    function applyVideos() {
        // Insert / update
        for (const id of Object.keys(videoConfigs)) {
            const cfg = videoConfigs[id];
            document.querySelectorAll(cfg.selector).forEach(function (el) {
                upsertVideo(el, id, cfg);
            });
        }
        // Remove stale
        document.querySelectorAll('.codeskin-video').forEach(function (el) {
            const m = el.className.match(/codeskin-video-([^\\s]+)/);
            if (m && !videoConfigs[m[1]]) { el.remove(); }
        });
    }

    // ── Hot-reload ─────────────────────────────────────────────────────────────
    // Dual-poll strategy for near-instant CSS updates in ALL regions
    // (Editor, Sidebar, Terminal, Activity Bar, Status Bar, Title Bar):
    //
    //  1. TICK poll (50ms) — reads codeskin-tick.txt, a file containing just
    //     an integer counter (~3 bytes). Near-zero I/O cost. When the counter
    //     changes (extension writes it on every state update), an immediate
    //     full state fetch is triggered — giving ~50ms end-to-end latency.
    //
    //  2. STATE poll (500ms) — full fallback that catches the initial page load
    //     and any race conditions where the tick is missed.
    //
    // Root-cause fix for: slow BG updates, Activity Bar not updating,
    // Status Bar not updating. All three had the same cause: the old 500ms
    // single-poll was too slow, especially when combined with the 150ms debounce.

    const STATE_URL = ${JSON.stringify(stateUrl)};
    const TICK_URL  = ${JSON.stringify(tickUrl)};
    let lastHash = 0;
    let lastTick = '';
    let styleEl  = null;

    function applyState(state) {
        // <style id="codeskin-hot"> is the SOLE CSS delivery path.
        // (The static @import was removed to avoid Electron's browser cache
        //  serving a stale stylesheet when backgrounds are added or removed.)
        if (typeof state.css === 'string') {
            if (!styleEl) {
                styleEl    = document.createElement('style');
                styleEl.id = 'codeskin-hot';
                document.head.appendChild(styleEl);
            }
            if (styleEl.textContent !== state.css) {
                styleEl.textContent = state.css;
            }
        }
        if (state.videos && typeof state.videos === 'object') {
            videoConfigs = state.videos;
            applyVideos();
        }
    }

    function fnv1a32(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h  = (h * 0x01000193) >>> 0;
        }
        return h;
    }

    function fetchState() {
        // Skip when window is hidden (saves CPU + avoids spurious fetches)
        if (document.visibilityState === 'hidden') { return; }

        fetch(STATE_URL + '?t=' + Date.now())
            .then(function (r) { return r.text(); })
            .then(function (text) {
                const h = fnv1a32(text);
                if (h === lastHash) { return; }  // nothing changed
                lastHash = h;
                try { applyState(JSON.parse(text)); } catch (_) {}
            })
            .catch(function () { /* file may not exist on first launch */ });
    }

    // ── Tick-file fast poll (50ms) ─────────────────────────────────────────────
    // The extension writes a new integer to this file on every state update.
    // We detect the change here and immediately trigger a full state fetch.
    function fetchTick() {
        if (document.visibilityState === 'hidden') { return; }
        fetch(TICK_URL + '?t=' + Date.now())
            .then(function (r) { return r.text(); })
            .then(function (tick) {
                if (tick === lastTick) { return; }
                lastTick = tick;
                fetchState(); // instant state fetch on tick change
            })
            .catch(function () { /* tick file may not exist on first launch */ });
    }

    // ── Bootstrap ─────────────────────────────────────────────────────────────
    // Wrap in DOMContentLoaded so querySelectorAll finds the workbench DOM.
    // VS Code injects this <script> before the workbench shell is fully painted;
    // without this guard applyVideos() runs against an empty DOM and no-ops.

    function bootstrap() {
        fetchState();
        applyVideos();
        // Re-run once after a short delay to catch containers that mount late
        // (e.g. the terminal panel only exists after the user opens a terminal).
        setTimeout(function () { applyVideos(); fetchState(); }, 1000);
        // Fast tick poll (50ms) — triggers immediate state fetch on any change.
        setInterval(function () { fetchTick(); }, 50);
        // Slow state poll (500ms) — fallback for initial load + missed ticks.
        setInterval(function () { fetchState(); }, 500);
        // Video DOM upsert — coarser interval is fine (videos don't change often).
        setInterval(function () { applyVideos(); }, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }
})();
`;
    }


    // ── Webview state sync ────────────────────────────────────────────────────

    /**
     * Push current region state to the React webview.
     *
     * Optimization: `asWebviewUri` is only called for regions whose imagePath
     * differs from what was last sent.  All other regions reuse the cached URI.
     */
    private _pushStateToWebview(): void {
        const payload: Record<string, object> = {};

        for (const r of ALL_REGIONS) {
            const s = this._state[r];

            let webviewUri: string | null;
            const cached = this._lastWebviewUri.get(r);

            if (s.imagePath === null) {
                webviewUri = null;
                if (cached !== null) { this._lastWebviewUri.set(r, null); }
            } else {
                // Recompute only if this region just changed (dirty was set)
                // or we have no cached URI yet.
                const needRecompute = cached === undefined || cached === null ||
                    // Simple heuristic: if the cache holds no query string it's stale
                    !cached.includes('?t=');

                if (needRecompute) {
                    webviewUri = this._panel.webview
                        .asWebviewUri(vscode.Uri.file(s.imagePath))
                        .toString() + `?t=${Date.now()}`;
                    this._lastWebviewUri.set(r, webviewUri);
                } else {
                    webviewUri = cached;
                }
            }

            payload[r] = {
                enabled: s.enabled, opacity: s.opacity, blur: s.blur,
                isVideo: s.isVideo, imageName: s.imageName, webviewUri,
            };
        }

        this._panel.webview.postMessage({ type: 'STATE_UPDATE', state: payload });
    }

    // ── HTML builder ──────────────────────────────────────────────────────────

    private _buildHtml(webview: vscode.Webview): string {
        const distDir   = path.join(this._context.extensionPath, 'webview', 'dist');
        const indexPath = path.join(distDir, 'index.html');

        try {
            let html = fs.readFileSync(indexPath, 'utf-8');

            html = html.replace(/\s+crossorigin/g, '');

            html = html.replace(/(href|src)="(\/[^"]+)"/g, (_m, attr, assetPath) => {
                const abs = path.join(distDir, assetPath as string);
                return fs.existsSync(abs)
                    ? `${attr as string}="${webview.asWebviewUri(vscode.Uri.file(abs))}"`
                    : _m;
            });

            const src = webview.cspSource;
            const csp =
                `default-src 'none'; ` +
                `img-src ${src} vscode-webview-resource: vscode-file: data: blob:; ` +
                `media-src ${src} vscode-webview-resource: vscode-file: blob:; ` +
                `script-src ${src} 'unsafe-inline'; ` +
                `style-src ${src} 'unsafe-inline'; ` +
                `font-src ${src};`;

            html = html.replace(
                '<head>',
                `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`,
            );

            return html;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[CodeSkin] Failed to load webview HTML:', err);
            return (
                `<!DOCTYPE html><html><body style="color:#ccc;padding:2rem">` +
                `<h2>⚠ CodeSkin webview failed to load</h2>` +
                `<p>${msg}</p>` +
                `<p>Run <code>npm run build:webview</code> from the extension root.</p>` +
                `</body></html>`
            );
        }
    }

    // ── Dispose ───────────────────────────────────────────────────────────────

    public dispose(): void {
        PanelProvider.currentPanel = undefined;

        if (this._debounceTimer !== null) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }

        this._panel.dispose();
        for (const d of this._disposables) { d.dispose(); }
        this._disposables.length = 0;
    }
}
