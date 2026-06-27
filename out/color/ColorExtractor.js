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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ColorExtractor = void 0;
const node_vibrant_1 = __importDefault(require("node-vibrant"));
const tinycolor2_1 = __importDefault(require("tinycolor2"));
const vscode = __importStar(require("vscode"));
class ColorExtractor {
    static async extractAndApply(imagePath) {
        try {
            // Wait for Vibrant extraction
            const palette = await node_vibrant_1.default.from(imagePath).getPalette();
            if (!palette)
                return false;
            const tokens = this.mapPaletteToTokens(palette);
            // Apply to vscode workspace settings
            await vscode.workspace.getConfiguration('workbench').update('colorCustomizations', tokens, vscode.ConfigurationTarget.Global);
            return true;
        }
        catch (err) {
            console.error('Failed to extract colors:', err);
            return false;
        }
    }
    static mapPaletteToTokens(palette) {
        // Fallback neutral color if a swatch is missing
        const fallback = '#444444';
        const darkMuted = palette.DarkMuted?.hex || fallback;
        const darkVibrant = palette.DarkVibrant?.hex || fallback;
        const vibrant = palette.Vibrant?.hex || fallback;
        const lightVibrant = palette.LightVibrant?.hex || fallback;
        const muted = palette.Muted?.hex || fallback;
        const tokens = {};
        // NOTE: We deliberately do NOT set or clear activityBar.background,
        // sideBar.background, or editor.background here.
        // CodeSkin controls those regions via CSS ::before injection.
        // Setting them to `undefined` would delete the user's existing
        // colorCustomizations and snap the VS Code bg back to theme defaults,
        // fighting our CSS injection and leaving the bg opaque.
        tokens['statusBar.background'] = darkVibrant;
        tokens['titleBar.activeBackground'] = darkVibrant;
        tokens['button.background'] = vibrant;
        tokens['badge.background'] = vibrant;
        tokens['focusBorder'] = vibrant;
        tokens['editor.selectionBackground'] = lightVibrant;
        tokens['list.activeSelectionBackground'] = lightVibrant;
        tokens['editor.inactiveSelectionBackground'] = muted;
        tokens['list.hoverBackground'] = muted;
        // Calculate foregrounds
        tokens['activityBar.foreground'] = this.getAccessibleForeground(darkMuted);
        tokens['sideBarTitle.foreground'] = this.getAccessibleForeground(darkMuted);
        tokens['editor.foreground'] = this.getAccessibleForeground(darkMuted);
        tokens['statusBar.foreground'] = this.getAccessibleForeground(darkVibrant);
        tokens['button.foreground'] = this.getAccessibleForeground(vibrant);
        return tokens;
    }
    static getAccessibleForeground(bgColor) {
        const bg = (0, tinycolor2_1.default)(bgColor);
        let fg = (0, tinycolor2_1.default)('#ffffff'); // start with white
        if (tinycolor2_1.default.readability(bg, fg) < 4.5) {
            fg = (0, tinycolor2_1.default)('#000000'); // fallback to black if white doesn't contrast enough
        }
        return fg.toHexString();
    }
}
exports.ColorExtractor = ColorExtractor;
//# sourceMappingURL=ColorExtractor.js.map