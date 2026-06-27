import * as vscode from 'vscode';
import * as fs     from 'fs';
import * as path   from 'path';
import {
    INJECT_START,
    INJECT_END,
    findWorkbenchHtml,
    stripInjection,
    patchCsp,
    updateChecksum
} from './CssOperations';

// ─── Constants ────────────────────────────────────────────────────────────────

const CSS_FILENAME   = 'codeskin.css';
const JS_FILENAME    = 'codeskin.js';
const STATE_FILENAME = 'codeskin-state.json';
const TICK_FILENAME  = 'codeskin-tick.txt';

const VSCODE_APP_SCHEME = 'vscode-file://vscode-app';

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function fsPathToVscodeUri(fsPath: string): string {
    let p = fsPath.replace(/\\/g, '/');
    if (!p.startsWith('/')) { p = '/' + p; }
    return `${VSCODE_APP_SCHEME}${p}`;
}

// ─── Result type for install/uninstall ───────────────────────────────────────

export type InstallResult =
    | { ok: true }
    | { ok: false; reason: 'permission' | 'not_found' | 'error'; message: string };

// ─── CssManager ──────────────────────────────────────────────────────────────

/**
 * Manages all disk I/O for CodeSkin.
 *
 * VS Code update survival
 * ────────────────────────
 * When VS Code auto-updates it replaces ALL files under `appRoot/out/`, which
 * wipes our injection from `workbench.html`.  The extension detects this via
 * `isInstalled()` and re-applies automatically on the next activate.
 *
 * The `install()` method is fully idempotent: it strips any previous injection
 * before writing the new one, so running it after a VS Code update always
 * produces a clean, up-to-date patch.
 */
export class CssManager {
    private readonly _storageDir: string;
    private readonly _cssPath:    string;
    private readonly _jsPath:     string;
    private readonly _statePath:  string;
    private readonly _tickPath:   string;

    constructor(context: vscode.ExtensionContext) {
        this._storageDir = context.globalStorageUri.fsPath;
        this._cssPath    = path.join(this._storageDir, CSS_FILENAME);
        this._jsPath     = path.join(this._storageDir, JS_FILENAME);
        this._statePath  = path.join(this._storageDir, STATE_FILENAME);
        this._tickPath   = path.join(this._storageDir, TICK_FILENAME);
    }

    // ── Public accessors ──────────────────────────────────────────────────────

    get cssFilePath():   string { return this._cssPath; }
    get jsFilePath():    string { return this._jsPath; }
    get stateFilePath(): string { return this._statePath; }
    get tickFilePath():  string { return this._tickPath; }

    // ── Wallpaper file management ─────────────────────────────────────────────

    /**
     * Copy the source wallpaper into global storage under a stable name.
     * Uses `fs.copyFile` so the full file never enters the Node.js heap
     * (safe for multi-hundred MB video files).
     */
    async saveImage(region: string, sourceFsPath: string): Promise<string> {
        await this._ensureDir();
        const ext      = path.extname(sourceFsPath).toLowerCase().replace('.', '') || 'png';
        const destPath = path.join(this._storageDir, `codeskin-${region}.${ext}`);
        await fs.promises.copyFile(sourceFsPath, destPath);
        console.log(`[CodeSkin] Wallpaper saved: ${sourceFsPath} → ${destPath}`);
        return destPath;
    }

    // ── Generated file writers ────────────────────────────────────────────────

    async updateCss(content: string):   Promise<void> { await this._write(this._cssPath,   content); }
    async updateJs(content: string):    Promise<void> { await this._write(this._jsPath,    content); }
    async updateState(state: object):   Promise<void> {
        await this._write(this._statePath, JSON.stringify(state));
    }

    /**
     * Returns true when the on-disk codeskin.js contains the given version token.
     *
     * Used on activation to detect when the cached JS in the workbench is stale
     * (i.e. an old version without tick-poll support). When this returns false,
     * extension.ts forces a repair and prompts the user to reload so the new JS
     * is loaded by the Electron browser engine.
     */
    async isJsVersionCurrent(versionToken: string): Promise<boolean> {
        try {
            const js = await fs.promises.readFile(this._jsPath, 'utf-8');
            return js.includes(versionToken);
        } catch {
            return false; // file doesn't exist yet — treat as stale
        }
    }


    // ── Installation status ───────────────────────────────────────────────────

    /**
     * Returns true when our injection markers are present in `workbench.html`.
     *
     * Call this on extension activation to detect whether VS Code updated
     * and wiped the patch.  O(file-size) read — acceptable on activate only.
     */
    async isInstalled(): Promise<boolean> {
        const htmlPath = this._findWorkbenchHtml();
        if (!htmlPath) { return false; }
        try {
            const html = await fs.promises.readFile(htmlPath, 'utf-8');
            return html.includes(INJECT_START);
        } catch {
            return false;
        }
    }

    /**
     * Read the VS Code version that was current when we last patched
     * `workbench.html`. Returns null when not yet recorded.
     *
     * Stored in the state JSON so it persists across extension host restarts.
     */
    async getInstalledForVersion(): Promise<string | null> {
        try {
            const raw = await fs.promises.readFile(this._statePath, 'utf-8');
            const obj = JSON.parse(raw) as Record<string, unknown>;
            return typeof obj._vscodeVersion === 'string' ? obj._vscodeVersion : null;
        } catch {
            return null;
        }
    }

    // ── workbench.html patching ───────────────────────────────────────────────

    /**
     * Inject the CodeSkin `<style>` and `<script>` tags into `workbench.html`
     * and relax the CSP.
     *
     * Idempotent: always strips any previous injection before inserting,
     * so running after a partial VS Code update always produces a clean patch.
     *
     * Returns a typed result so callers can handle permission errors gracefully
     * without catching untyped exceptions.
     */
    async install(): Promise<InstallResult> {
        const htmlPath = this._findWorkbenchHtml();
        if (!htmlPath) {
            return {
                ok: false, reason: 'not_found',
                message:
                    'Could not locate workbench.html. ' +
                    'Try running VS Code as Administrator.',
            };
        }

        try {
            let html = await fs.promises.readFile(htmlPath, 'utf-8');

            // Remove any previous CodeSkin injection (handles VS Code partial updates
            // that preserve the HTML file but scramble line positions).
            html = stripInjection(html);

            // Build the injection block.
            // NOTE: We deliberately do NOT use a static @import here.
            // @import URLs are cached by Electron's browser engine, so when codeskin.css
            // changes on disk (e.g. a bg is removed), Electron may serve the stale cached
            // version — leaving old ::before image rules in place even after removal.
            //
            // Instead, the codeskin.js hot-reload script is the sole CSS delivery path.
            // It fetches codeskin-state.json with a ?t= cache-bust timestamp on every
            // 500 ms poll and writes the full CSS into <style id="codeskin-hot"> directly.
            // This is always fresh — no browser caching involved.
            const jsUri  = fsPathToVscodeUri(this._jsPath);
            const block  =
                `\n${INJECT_START}\n` +
                `<script src="${jsUri}"></script>\n` +
                `${INJECT_END}\n`;

            html = html.replace('</html>', () => block + '</html>');
            html = patchCsp(html);

            await fs.promises.writeFile(htmlPath, html, 'utf-8');
            await this._updateChecksum(htmlPath);

            console.log('[CodeSkin] Installed into', htmlPath);
            return { ok: true };
        } catch (err: unknown) {
            return this._classifyFsError(err, 'install');
        }
    }

    /**
     * Remove the CodeSkin injection and restore the original CSP.
     */
    async uninstall(): Promise<InstallResult> {
        const htmlPath = this._findWorkbenchHtml();
        if (!htmlPath) { return { ok: true }; } // nothing to remove

        try {
            const original = await fs.promises.readFile(htmlPath, 'utf-8');
            const cleaned  = stripInjection(original);

            if (cleaned === original) { return { ok: true }; }

            await fs.promises.writeFile(htmlPath, cleaned, 'utf-8');
            await this._updateChecksum(htmlPath);
            console.log('[CodeSkin] Removed from', htmlPath);
            return { ok: true };
        } catch (err: unknown) {
            return this._classifyFsError(err, 'uninstall');
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private async _ensureDir(): Promise<void> {
        await fs.promises.mkdir(this._storageDir, { recursive: true });
    }

    private async _write(filePath: string, content: string): Promise<void> {
        await this._ensureDir();
        await fs.promises.writeFile(filePath, content, 'utf-8');
        console.log(`[CodeSkin] Written: ${path.basename(filePath)}`);
    }

    private _findWorkbenchHtml(): string | null {
        return findWorkbenchHtml(vscode.env.appRoot);
    }

    private async _updateChecksum(htmlPath: string): Promise<void> {
        await updateChecksum(vscode.env.appRoot, htmlPath);
    }

    private _classifyFsError(err: unknown, op: string): InstallResult {
        const isPermission =
            err instanceof Error &&
            'code' in err &&
            ((err as NodeJS.ErrnoException).code === 'EACCES' ||
             (err as NodeJS.ErrnoException).code === 'EPERM');

        const message = err instanceof Error ? err.message : String(err);
        console.error(`[CodeSkin] ${op} error:`, err);

        return {
            ok:      false,
            reason:  isPermission ? 'permission' : 'error',
            message: isPermission
                ? `Permission denied during ${op}. On Windows, run VS Code as Administrator once.`
                : `${op} failed: ${message}`,
        };
    }
}
