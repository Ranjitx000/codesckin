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
exports.CSP_END = exports.CSP_START = exports.INJECT_END = exports.INJECT_START = void 0;
exports.workbenchHtmlCandidates = workbenchHtmlCandidates;
exports.relaxCspContent = relaxCspContent;
exports.stripInjection = stripInjection;
exports.patchCsp = patchCsp;
exports.findWorkbenchHtml = findWorkbenchHtml;
exports.updateChecksum = updateChecksum;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
// ─── Constants ────────────────────────────────────────────────────────────────
exports.INJECT_START = '<!-- codeskin-start -->';
exports.INJECT_END = '<!-- codeskin-end -->';
exports.CSP_START = '<!-- codeskin-csp-start -->';
exports.CSP_END = '<!-- codeskin-csp-end -->';
const VSCODE_APP_SCHEME = 'vscode-file://vscode-app';
const EXTRA_CSP_SOURCES = 'vscode-file: vscode-app: vscode-webview: vscode-webview-resource: blob: data:';
const CSP_TARGET_DIRECTIVES = new Set([
    'default-src', 'img-src', 'media-src', 'script-src',
    'style-src', 'frame-src', 'worker-src', 'connect-src', 'font-src',
]);
// ─── Candidates Finder ───────────────────────────────────────────────────────
function workbenchHtmlCandidates(appRoot) {
    return [
        // VS Code 1.70+ (Electron sandbox)
        path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
        // VS Code < 1.70 (Electron browser)
        path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
        // VS Code OSS / Insiders alternate
        path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.html'),
        // Some Linux distro builds
        path.join(appRoot, 'out', 'vs', 'code', 'node', 'extensionHostProcess', 'workbench.html'),
    ];
}
// ─── Pure Helpers ─────────────────────────────────────────────────────────────
function relaxCspContent(original) {
    return original
        .split(';')
        .map(d => d.trim())
        .filter(Boolean)
        .map(directive => {
        const name = directive.split(/\s+/)[0].toLowerCase();
        // Remove trusted-types — it blocks our runtime script injection
        if (name === 'require-trusted-types-for') {
            return null;
        }
        if (CSP_TARGET_DIRECTIVES.has(name)) {
            return `${directive} ${EXTRA_CSP_SOURCES}`;
        }
        return directive;
    })
        .filter((d) => d !== null)
        .join('; ') + ';';
}
/** Strip both the injection block and the backed-up CSP from `html`. */
function stripInjection(html) {
    // Remove script/style block
    html = html.replace(/\r?\n<!-- codeskin-start -->[\s\S]*?<!-- codeskin-end -->\r?\n/, '');
    // Restore original CSP tag
    const re = /\r?\n<!-- codeskin-csp-start -->\r?\n<!-- ORIGINAL_CSP: (.*?) -->\r?\n[\s\S]*?<!-- codeskin-csp-end -->\r?\n/s;
    const m = html.match(re);
    if (m) {
        const original = m[1].replace(/&#45;/g, '-');
        html = html.replace(re, () => original);
    }
    return html;
}
/** Wrap the existing CSP tag in a backup comment and replace it with a relaxed version. */
function patchCsp(html) {
    const tagRe = /(<meta\s+http-equiv=["']?Content-Security-Policy["']?[^>]*>)/i;
    const match = html.match(tagRe);
    if (!match) {
        return html;
    }
    const originalTag = match[1];
    const escapedTag = originalTag.replace(/-/g, '&#45;');
    let relaxedTag = originalTag;
    const contentMatch = originalTag.match(/content=(["'])(.*?)\1/i);
    if (contentMatch) {
        const relaxed = relaxCspContent(contentMatch[2]);
        relaxedTag = originalTag.replace(contentMatch[0], () => `content="${relaxed}"`);
    }
    else {
        relaxedTag =
            `<meta http-equiv="Content-Security-Policy" content=` +
                `"default-src * 'unsafe-inline' 'unsafe-eval' data: blob: ${EXTRA_CSP_SOURCES};">`;
    }
    const block = `\n${exports.CSP_START}\n` +
        `<!-- ORIGINAL_CSP: ${escapedTag} -->\n` +
        `${relaxedTag}\n` +
        `${exports.CSP_END}\n`;
    return html.replace(originalTag, () => block);
}
/** Find VS Code's workbench.html. Returns null when not found. */
function findWorkbenchHtml(appRoot) {
    for (const p of workbenchHtmlCandidates(appRoot)) {
        if (fs.existsSync(p)) {
            console.log('[CodeSkin] workbench.html found:', p);
            return p;
        }
    }
    console.error('[CodeSkin] workbench.html not found under appRoot:', appRoot);
    return null;
}
/**
 * Update the SHA-256 checksum in `product.json` so VS Code does not show
 * the "Installation Corrupted" warning after we patch `workbench.html`.
 */
async function updateChecksum(appRoot, htmlPath) {
    const productPath = path.join(appRoot, 'product.json');
    try {
        const raw = await fs.promises.readFile(productPath, 'utf-8');
        const product = JSON.parse(raw);
        const checksums = product.checksums;
        if (!checksums) {
            return;
        }
        const normalised = htmlPath.replace(/\\/g, '/');
        const key = Object.keys(checksums).find(k => normalised.endsWith(k.replace(/\\/g, '/')));
        if (!key) {
            console.warn('[CodeSkin] No checksum key for', htmlPath);
            return;
        }
        // Hash the bytes on disk (not the in-memory string) so the checksum
        // matches exactly what VS Code's integrity checker will read.
        const buffer = await fs.promises.readFile(htmlPath);
        checksums[key] = crypto.createHash('sha256').update(buffer).digest('base64');
        await fs.promises.writeFile(productPath, JSON.stringify(product, null, '\t'), 'utf-8');
        console.log('[CodeSkin] Checksum updated for', key);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[CodeSkin] Could not update checksum (non-fatal):', msg);
    }
}
//# sourceMappingURL=CssOperations.js.map