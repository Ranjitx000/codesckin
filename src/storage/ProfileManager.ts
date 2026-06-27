import * as vscode from 'vscode';
import { randomUUID } from 'crypto';

export interface ThemeProfile {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    editor: RegionState;
    sidebar: RegionState;
    terminal: RegionState;
    colors: any | null;
    thumbnailBase64: string | null;
}

export interface RegionState {
    enabled: boolean;
    opacity: number;
    blur: number;
    imagePath: string | null;
}

export class ProfileManager {
    private readonly context: vscode.ExtensionContext;
    private readonly STORAGE_KEY = 'codeskin.profiles';
    private readonly ACTIVE_KEY = 'codeskin.activeProfileId';

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public getProfiles(): ThemeProfile[] {
        return this.context.globalState.get<ThemeProfile[]>(this.STORAGE_KEY) || [];
    }

    public saveProfile(name: string, currentState: any, thumbnailBase64: string | null = null): ThemeProfile {
        const profiles = this.getProfiles();
        
        const newProfile: ThemeProfile = {
            id: randomUUID(),
            name,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            editor: currentState.editor || { enabled: false, opacity: 40, blur: 5, imagePath: null },
            sidebar: currentState.sidebar || { enabled: false, opacity: 40, blur: 5, imagePath: null },
            terminal: currentState.terminal || { enabled: false, opacity: 40, blur: 5, imagePath: null },
            colors: currentState.colors || null,
            thumbnailBase64
        };

        profiles.unshift(newProfile); // add to top

        // Enforce max 20
        if (profiles.length > 20) {
            profiles.pop();
        }

        this.context.globalState.update(this.STORAGE_KEY, profiles);
        return newProfile;
    }

    public deleteProfile(id: string): void {
        const profiles = this.getProfiles().filter(p => p.id !== id);
        this.context.globalState.update(this.STORAGE_KEY, profiles);
    }

    public getActiveProfileId(): string | undefined {
        return this.context.globalState.get<string>(this.ACTIVE_KEY);
    }

    public setActiveProfile(id: string): void {
        this.context.globalState.update(this.ACTIVE_KEY, id);
    }
}
