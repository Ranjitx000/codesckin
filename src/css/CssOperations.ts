import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

export const INJECT_START = '<!-- codeskin-start -->';
export const INJECT_END   = '<!-- codeskin-end -->';
export const CSP_START    = '<!-- codeskin-csp-start -->';
export const CSP_END      = '<!-- codeskin-csp-end -->';

const VSCODE_APP_SCHEME = 'vscode-file://vscode-app';

const EXTRA_CSP_SOURCES =
    'vscode-file: vscode-app: vscode-webview: vscode-webview-resource: blob: data:';

const CSP_TARGET_DIRECTIVES = new Set([
    'default-src', 'img-src', 'media-src', 'script-src',
    'style-src',   'frame-src', 'worker-src', 'connect-src', 'font-src',
]);

// ─── Candidates Finder ───────────────────────────────────────────────────────

export function workbenchHtmlCandidates(appRoot: string): string[] {
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

export function relaxCspContent(original: string): string {
    return original
        .split(';')
        .map(d => d.trim())
        .filter(Boolean)
        .map(directive => {
            const name = directive.split(/\s+/)[0].toLowerCase();
            // Remove trusted-types — it blocks our runtime script injection
            if (name === 'require-trusted-types-for') { return null; }
            if (CSP_TARGET_DIRECTIVES.has(name)) {
                return `${directive} ${EXTRA_CSP_SOURCES}`;
            }
            return directive;
        })
        .filter((d): d is string => d !== null)
        .join('; ') + ';';
}

/** Strip both the injection block and the backed-up CSP from `html`. */
export function stripInjection(html: string): string {
    // Remove script/style block
    html = html.replace(
        /\r?\n<!-- codeskin-start -->[\s\S]*?<!-- codeskin-end -->\r?\n/,
        '',
    );
    // Restore original CSP tag
    const re = /\r?\n<!-- codeskin-csp-start -->\r?\n<!-- ORIGINAL_CSP: (.*?) -->\r?\n[\s\S]*?<!-- codeskin-csp-end -->\r?\n/s;
    const m  = html.match(re);
    if (m) {
        const original = m[1].replace(/&#45;/g, '-');
        html = html.replace(re, () => original);
    }
    return html;
}

/** Wrap the existing CSP tag in a backup comment and replace it with a relaxed version. */
export function patchCsp(html: string): string {
    const tagRe = /(<meta\s+http-equiv=["']?Content-Security-Policy["']?[^>]*>)/i;
    const match  = html.match(tagRe);
    if (!match) { return html; }

    const originalTag = match[1];
    const escapedTag  = originalTag.replace(/-/g, '&#45;');

    let relaxedTag = originalTag;
    const contentMatch = originalTag.match(/content=(["'])(.*?)\1/i);
    if (contentMatch) {
        const relaxed = relaxCspContent(contentMatch[2]);
        relaxedTag    = originalTag.replace(
            contentMatch[0],
            () => `content="${relaxed}"`,
        );
    } else {
        relaxedTag =
            `<meta http-equiv="Content-Security-Policy" content=` +
            `"default-src * 'unsafe-inline' 'unsafe-eval' data: blob: ${EXTRA_CSP_SOURCES};">`;
    }

    const block =
        `\n${CSP_START}\n` +
        `<!-- ORIGINAL_CSP: ${escapedTag} -->\n` +
        `${relaxedTag}\n` +
        `${CSP_END}\n`;

    return html.replace(originalTag, () => block);
}

/** Find VS Code's workbench.html. Returns null when not found. */
export function findWorkbenchHtml(appRoot: string): string | null {
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
export async function updateChecksum(appRoot: string, htmlPath: string): Promise<void> {
    const productPath = path.join(appRoot, 'product.json');
    try {
        const raw      = await fs.promises.readFile(productPath, 'utf-8');
        const product  = JSON.parse(raw) as Record<string, unknown>;
        const checksums = product.checksums as Record<string, string> | undefined;
        if (!checksums) { return; }

        const normalised = htmlPath.replace(/\\/g, '/');
        const key = Object.keys(checksums).find(
            k => normalised.endsWith(k.replace(/\\/g, '/')),
        );
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
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[CodeSkin] Could not update checksum (non-fatal):', msg);
    }
}
