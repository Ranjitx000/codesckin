import * as fs from 'fs';
import * as path from 'path';
import { findWorkbenchHtml, stripInjection, updateChecksum } from './css/CssOperations';

async function run() {
    console.log('[CodeSkin-Uninstall] Running uninstall clean-up hook...');

    // In production, uninstall.js is executed inside the compiled "out" directory.
    // Therefore, the root of the extension is one level up (..).
    const extensionRoot = path.join(__dirname, '..');
    const configPath = path.join(extensionRoot, 'uninstall-config.json');

    if (!fs.existsSync(configPath)) {
        console.log('[CodeSkin-Uninstall] No uninstall-config.json found. Clean-up skipped.');
        return;
    }

    try {
        const rawConfig = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(rawConfig);

        const appRoot = config.appRoot;
        const globalStorage = config.globalStorage;

        if (!appRoot) {
            console.error('[CodeSkin-Uninstall] appRoot is missing in uninstall-config.json.');
            return;
        }

        // 1. Locate workbench.html
        const htmlPath = findWorkbenchHtml(appRoot);
        if (!htmlPath) {
            console.error('[CodeSkin-Uninstall] workbench.html path not found.');
            return;
        }

        // 2. Read and strip injection
        console.log(`[CodeSkin-Uninstall] Restoring original workbench.html at ${htmlPath}...`);
        const originalHtml = await fs.promises.readFile(htmlPath, 'utf-8');
        const cleanedHtml = stripInjection(originalHtml);

        if (cleanedHtml !== originalHtml) {
            // Write changes and update checksum
            await fs.promises.writeFile(htmlPath, cleanedHtml, 'utf-8');
            await updateChecksum(appRoot, htmlPath);
            console.log('[CodeSkin-Uninstall] workbench.html restored successfully.');
        } else {
            console.log('[CodeSkin-Uninstall] workbench.html is already clean.');
        }

        // 3. Clean up global storage files
        if (globalStorage && fs.existsSync(globalStorage)) {
            console.log(`[CodeSkin-Uninstall] Cleaning up files in global storage: ${globalStorage}...`);
            const filesToClean = [
                'codeskin.css',
                'codeskin.js',
                'codeskin-state.json',
                'codeskin-tick.txt'
            ];

            for (const file of filesToClean) {
                const filePath = path.join(globalStorage, file);
                try {
                    if (fs.existsSync(filePath)) {
                        await fs.promises.unlink(filePath);
                        console.log(`[CodeSkin-Uninstall] Deleted global storage file: ${file}`);
                    }
                } catch (err) {
                    console.warn(`[CodeSkin-Uninstall] Non-fatal: could not delete global storage file ${file}:`, err);
                }
            }
        }

        // 4. Remove the config file itself
        try {
            if (fs.existsSync(configPath)) {
                await fs.promises.unlink(configPath);
                console.log('[CodeSkin-Uninstall] Deleted uninstall-config.json.');
            }
        } catch (err) {
            // Non-fatal
        }

        console.log('[CodeSkin-Uninstall] Uninstall clean-up complete.');
    } catch (err) {
        console.error('[CodeSkin-Uninstall] Critical error during uninstall clean-up:', err);
    }
}

run().catch(err => {
    console.error('[CodeSkin-Uninstall] Hook execution failed:', err);
});
