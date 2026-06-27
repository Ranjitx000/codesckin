"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CssManager = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const CssOperations_1 = require("./CssOperations");
// ─── Constants ────────────────────────────────────────────────────────────────
const CSS_FILENAME = 'codeskin.css';
const JS_FILENAME = 'codeskin.js';
const STATE_FILENAME = 'codeskin-state.json';
const TICK_FILENAME = 'codeskin-tick.txt';
const VSCODE_APP_SCHEME = 'vscode-file://vscode-app';
// ─── Pure helpers ─────────────────────────────────────────────────────────────
function fsPathToVscodeUri(fsPath) {
    let p = fsPath.replace(/\\/g, '/');
    if (!p.startsWith('/')) {
        p = '/' + p;
    }
    return `${VSCODE_APP_SCHEME}${p}`;
}
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
class CssManager {
    _storageDir;
    _cssPath;
    _jsPath;
    _statePath;
    _tickPath;
    constructor(context) {
        this._storageDir = context.globalStorageUri.fsPath;
        this._cssPath = path.join(this._storageDir, CSS_FILENAME);
        this._jsPath = path.join(this._storageDir, JS_FILENAME);
        this._statePath = path.join(this._storageDir, STATE_FILENAME);
        this._tickPath = path.join(this._storageDir, TICK_FILENAME);
    }
    // ── Public accessors ──────────────────────────────────────────────────────
    get cssFilePath() { return this._cssPath; }
    get jsFilePath() { return this._jsPath; }
    get stateFilePath() { return this._statePath; }
    get tickFilePath() { return this._tickPath; }
    // ── Wallpaper file management ─────────────────────────────────────────────
    /**
     * Copy the source wallpaper into global storage under a stable name.
     * Uses `fs.copyFile` so the full file never enters the Node.js heap
     * (safe for multi-hundred MB video files).
     */
    async saveImage(region, sourceFsPath) {
        await this._ensureDir();
        const ext = path.extname(sourceFsPath).toLowerCase().replace('.', '') || 'png';
        const destPath = path.join(this._storageDir, `codeskin-${region}.${ext}`);
        await fs.promises.copyFile(sourceFsPath, destPath);
        console.log(`[CodeSkin] Wallpaper saved: ${sourceFsPath} → ${destPath}`);
        return destPath;
    }
    // ── Generated file writers ────────────────────────────────────────────────
    async updateCss(content) { await this._write(this._cssPath, content); }
    async updateJs(content) { await this._write(this._jsPath, content); }
    async updateState(state) {
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
    async isJsVersionCurrent(versionToken) {
        try {
            const js = await fs.promises.readFile(this._jsPath, 'utf-8');
            return js.includes(versionToken);
        }
        catch {
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
    async isInstalled() {
        const htmlPath = this._findWorkbenchHtml();
        if (!htmlPath) {
            return false;
        }
        try {
            const html = await fs.promises.readFile(htmlPath, 'utf-8');
            return html.includes(CssOperations_1.INJECT_START);
        }
        catch {
            return false;
        }
    }
    /**
     * Read the VS Code version that was current when we last patched
     * `workbench.html`. Returns null when not yet recorded.
     *
     * Stored in the state JSON so it persists across extension host restarts.
     */
    async getInstalledForVersion() {
        try {
            const raw = await fs.promises.readFile(this._statePath, 'utf-8');
            const obj = JSON.parse(raw);
            return typeof obj._vscodeVersion === 'string' ? obj._vscodeVersion : null;
        }
        catch {
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
    async install() {
        const htmlPath = this._findWorkbenchHtml();
        if (!htmlPath) {
            return {
                ok: false, reason: 'not_found',
                message: 'Could not locate workbench.html. ' +
                    'Try running VS Code as Administrator.',
            };
        }
        try {
            let html = await fs.promises.readFile(htmlPath, 'utf-8');
            // Remove any previous CodeSkin injection (handles VS Code partial updates
            // that preserve the HTML file but scramble line positions).
            html = (0, CssOperations_1.stripInjection)(html);
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
            const jsUri = fsPathToVscodeUri(this._jsPath);
            const block = `\n${CssOperations_1.INJECT_START}\n` +
                `<script src="${jsUri}"></script>\n` +
                `${CssOperations_1.INJECT_END}\n`;
            html = html.replace('</html>', () => block + '</html>');
            html = (0, CssOperations_1.patchCsp)(html);
            await fs.promises.writeFile(htmlPath, html, 'utf-8');
            await this._updateChecksum(htmlPath);
            console.log('[CodeSkin] Installed into', htmlPath);
            return { ok: true };
        }
        catch (err) {
            return this._classifyFsError(err, 'install');
        }
    }
    /**
     * Remove the CodeSkin injection and restore the original CSP.
     */
    async uninstall() {
        const htmlPath = this._findWorkbenchHtml();
        if (!htmlPath) {
            return { ok: true };
        } // nothing to remove
        try {
            const original = await fs.promises.readFile(htmlPath, 'utf-8');
            const cleaned = (0, CssOperations_1.stripInjection)(original);
            if (cleaned === original) {
                return { ok: true };
            }
            await fs.promises.writeFile(htmlPath, cleaned, 'utf-8');
            await this._updateChecksum(htmlPath);
            console.log('[CodeSkin] Removed from', htmlPath);
            return { ok: true };
        }
        catch (err) {
            return this._classifyFsError(err, 'uninstall');
        }
    }
    // ── Private helpers ───────────────────────────────────────────────────────
    async _ensureDir() {
        await fs.promises.mkdir(this._storageDir, { recursive: true });
    }
    async _write(filePath, content) {
        await this._ensureDir();
        await fs.promises.writeFile(filePath, content, 'utf-8');
        console.log(`[CodeSkin] Written: ${path.basename(filePath)}`);
    }
    _findWorkbenchHtml() {
        return (0, CssOperations_1.findWorkbenchHtml)(vscode.env.appRoot);
    }
    async _updateChecksum(htmlPath) {
        await (0, CssOperations_1.updateChecksum)(vscode.env.appRoot, htmlPath);
    }
    _classifyFsError(err, op) {
        const isPermission = err instanceof Error &&
            'code' in err &&
            (err.code === 'EACCES' ||
                err.code === 'EPERM');
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[CodeSkin] ${op} error:`, err);
        return {
            ok: false,
            reason: isPermission ? 'permission' : 'error',
            message: isPermission
                ? `Permission denied during ${op}. On Windows, run VS Code as Administrator once.`
                : `${op} failed: ${message}`,
        };
    }
}
exports.CssManager = CssManager;
//# sourceMappingURL=CssManager.js.map