import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CssManager }    from './css/CssManager';
import { PanelProvider } from './panel/PanelProvider';

/**
 * Extension activation.
 *
 * VS Code update survival strategy
 * ──────────────────────────────────
 * When VS Code auto-updates it replaces all files under `appRoot/out/`,
 * wiping our `workbench.html` injection.  On the NEXT launch after an update:
 *
 *   1. We compare the running VS Code version with the version stored the last
 *      time we successfully patched workbench.html.
 *   2. If they differ OR the injection markers are missing, we auto-repair:
 *      re-write the CSS/JS from persisted state and re-patch workbench.html.
 *   3. The user sees ONE notification: "VS Code updated — reload to reactivate."
 *
 * JS runtime version check
 * ─────────────────────────
 * We also check whether the on-disk codeskin.js contains the current version
 * token. If it does NOT (i.e. the user just updated the extension without
 * reloading), we force a repair so the new JS gets written and prompt for
 * reload.  This ensures fast hot-reload (tick-poll) activates after every
 * extension update — no manual intervention needed.
 *
 * This happens silently in the background; the user does NOT need to open the
 * CodeSkin panel or manually trigger anything.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('[CodeSkin] Activating…');

    // Ensure global storage directory exists
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);

    // Save appRoot and globalStorageUri for the vscode:uninstall hook
    try {
        const configPath = path.join(context.extensionPath, 'uninstall-config.json');
        const configData = {
            appRoot: vscode.env.appRoot,
            globalStorage: context.globalStorageUri.fsPath
        };
        await fs.promises.writeFile(configPath, JSON.stringify(configData, null, 2), 'utf-8');
        console.log('[CodeSkin] Written uninstall-config.json.');
    } catch (err) {
        console.error('[CodeSkin] Failed to write uninstall-config.json:', err);
    }

    // ── Register commands ────────────────────────────────────────────────────

    context.subscriptions.push(
        // Open the settings panel
        vscode.commands.registerCommand('codeskin.open', () => {
            PanelProvider.createOrShow(context);
        }),

        // Manual repair command — shown in the Command Palette so users can
        // fix things themselves after permission issues or failed auto-repairs.
        vscode.commands.registerCommand('codeskin.repair', async () => {
            await repairInstallation(context, /* silent */ false);
        }),

        // Uninstall command — cleanly removes the workbench.html injection
        vscode.commands.registerCommand('codeskin.uninstall', async () => {
            const mgr    = new CssManager(context);
            const result = await mgr.uninstall();
            if (result.ok) {
                const action = await vscode.window.showInformationMessage(
                    'CodeSkin: Removed from VS Code. Reload to complete.',
                    'Reload Window',
                );
                if (action === 'Reload Window') {
                    await vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            } else {
                vscode.window.showErrorMessage(`CodeSkin: Uninstall failed — ${result.message}`);
            }
        }),
    );

    // ── Auto-repair on VS Code update OR extension JS update (background) ────
    //
    // Run after a short delay so we don't slow down VS Code startup.
    // Two checks:
    //   1. workbench.html injection markers still present + VS Code version matches
    //   2. on-disk codeskin.js contains the current version token
    // If either check fails, we force a repair and prompt for reload.
    setTimeout(() => {
        repairInstallation(context, /* silent */ true).catch(err => {
            console.error('[CodeSkin] Auto-repair error:', err);
        });
    }, 3000);
}

export function deactivate(): void {
    console.log('[CodeSkin] Deactivated.');
}

// ─── Repair logic ─────────────────────────────────────────────────────────────

/**
 * Check whether the workbench.html injection is still in place AND the
 * on-disk codeskin.js is the current version. If either check fails,
 * re-apply from persisted state.
 *
 * @param silent  When true, shows no notification if everything is already OK.
 *                When false (manual repair command), always reports the outcome.
 */
async function repairInstallation(
    context: vscode.ExtensionContext,
    silent: boolean,
): Promise<void> {
    const mgr             = new CssManager(context);
    const currentVersion  = vscode.version;           // e.g. "1.90.2"
    const [installed, installedFor, jsIsCurrent] = await Promise.all([
        mgr.isInstalled(),
        mgr.getInstalledForVersion(),
        mgr.isJsVersionCurrent(PanelProvider.jsVersion),
    ]);

    const needsRepair =
        !installed ||                                  // injection was wiped
        installedFor !== currentVersion ||             // VS Code version changed
        !jsIsCurrent;                                  // codeskin.js is old version

    if (!needsRepair) {
        if (!silent) {
            vscode.window.showInformationMessage(
                `CodeSkin: Installation OK (VS Code ${currentVersion}).`,
            );
        }
        console.log(`[CodeSkin] Installation OK (VS Code ${currentVersion}), JS current: ${jsIsCurrent}`);
        return;
    }

    console.log(
        `[CodeSkin] Repair needed. installed=${installed}, ` +
        `installedFor=${installedFor ?? 'never'}, current=${currentVersion}, ` +
        `jsIsCurrent=${jsIsCurrent}`,
    );

    // Check whether there is any persisted wallpaper state worth restoring.
    // If this is a brand-new install with no state, do nothing silently.
    const hasSavedState = !!context.globalState.get('codeskin.state');
    if (!hasSavedState) {
        if (!silent) {
            vscode.window.showInformationMessage(
                'CodeSkin: No saved wallpaper state found. ' +
                'Open the settings panel and upload an image to get started.',
            );
        }
        return;
    }

    // Delegate the actual re-apply to PanelProvider which owns the CSS
    // generation logic. We create a temporary (hidden) panel to do the work
    // without revealing the UI to the user.
    //
    // PanelProvider.repairAfterVscodeUpdate() handles:
    //   - Rebuilding CSS/JS from persisted state
    //   - Writing files to disk (including the new tick-poll codeskin.js)
    //   - Calling cssManager.install()
    //   - Showing the "Reload Window" prompt
    PanelProvider.createOrShow(context);

    // Allow the panel to mount and load state before triggering repair
    setTimeout(async () => {
        await PanelProvider.currentPanel?.repairAfterVscodeUpdate();
    }, 1000);
}
