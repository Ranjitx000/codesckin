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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const CssOperations_1 = require("./css/CssOperations");
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
        const htmlPath = (0, CssOperations_1.findWorkbenchHtml)(appRoot);
        if (!htmlPath) {
            console.error('[CodeSkin-Uninstall] workbench.html path not found.');
            return;
        }
        // 2. Read and strip injection
        console.log(`[CodeSkin-Uninstall] Restoring original workbench.html at ${htmlPath}...`);
        const originalHtml = await fs.promises.readFile(htmlPath, 'utf-8');
        const cleanedHtml = (0, CssOperations_1.stripInjection)(originalHtml);
        if (cleanedHtml !== originalHtml) {
            // Write changes and update checksum
            await fs.promises.writeFile(htmlPath, cleanedHtml, 'utf-8');
            await (0, CssOperations_1.updateChecksum)(appRoot, htmlPath);
            console.log('[CodeSkin-Uninstall] workbench.html restored successfully.');
        }
        else {
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
                }
                catch (err) {
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
        }
        catch (err) {
            // Non-fatal
        }
        console.log('[CodeSkin-Uninstall] Uninstall clean-up complete.');
    }
    catch (err) {
        console.error('[CodeSkin-Uninstall] Critical error during uninstall clean-up:', err);
    }
}
run().catch(err => {
    console.error('[CodeSkin-Uninstall] Hook execution failed:', err);
});
//# sourceMappingURL=uninstall.js.map