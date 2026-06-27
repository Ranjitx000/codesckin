import Vibrant from 'node-vibrant';
import tinycolor from 'tinycolor2';
import * as vscode from 'vscode';

export class ColorExtractor {
    public static async extractAndApply(imagePath: string): Promise<boolean> {
        try {
            // Wait for Vibrant extraction
            const palette = await Vibrant.from(imagePath).getPalette();
            if (!palette) return false;

            const tokens = this.mapPaletteToTokens(palette);
            
            // Apply to vscode workspace settings
            await vscode.workspace.getConfiguration('workbench').update(
                'colorCustomizations', 
                tokens, 
                vscode.ConfigurationTarget.Global
            );
            
            return true;
        } catch (err) {
            console.error('Failed to extract colors:', err);
            return false;
        }
    }

    private static mapPaletteToTokens(palette: any) {
        // Fallback neutral color if a swatch is missing
        const fallback = '#444444';
        
        const darkMuted   = palette.DarkMuted?.hex    || fallback;
        const darkVibrant = palette.DarkVibrant?.hex  || fallback;
        const vibrant     = palette.Vibrant?.hex       || fallback;
        const lightVibrant = palette.LightVibrant?.hex || fallback;
        const muted       = palette.Muted?.hex         || fallback;

        const tokens: any = {};

        // NOTE: We deliberately do NOT set or clear activityBar.background,
        // sideBar.background, or editor.background here.
        // CodeSkin controls those regions via CSS ::before injection.
        // Setting them to `undefined` would delete the user's existing
        // colorCustomizations and snap the VS Code bg back to theme defaults,
        // fighting our CSS injection and leaving the bg opaque.

        tokens['statusBar.background']         = darkVibrant;
        tokens['titleBar.activeBackground']    = darkVibrant;
        
        tokens['button.background']            = vibrant;
        tokens['badge.background']             = vibrant;
        tokens['focusBorder']                  = vibrant;
        
        tokens['editor.selectionBackground']      = lightVibrant;
        tokens['list.activeSelectionBackground']   = lightVibrant;
        
        tokens['editor.inactiveSelectionBackground'] = muted;
        tokens['list.hoverBackground']               = muted;

        // Calculate foregrounds
        tokens['activityBar.foreground']    = this.getAccessibleForeground(darkMuted);
        tokens['sideBarTitle.foreground']   = this.getAccessibleForeground(darkMuted);
        tokens['editor.foreground']         = this.getAccessibleForeground(darkMuted);
        tokens['statusBar.foreground']      = this.getAccessibleForeground(darkVibrant);
        tokens['button.foreground']         = this.getAccessibleForeground(vibrant);

        return tokens;
    }

    private static getAccessibleForeground(bgColor: string): string {
        const bg = tinycolor(bgColor);
        let fg = tinycolor('#ffffff'); // start with white
        
        if (tinycolor.readability(bg, fg) < 4.5) {
            fg = tinycolor('#000000'); // fallback to black if white doesn't contrast enough
        }
        
        return fg.toHexString();
    }
}
