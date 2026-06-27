"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfileManager = void 0;
const crypto_1 = require("crypto");
class ProfileManager {
    context;
    STORAGE_KEY = 'codeskin.profiles';
    ACTIVE_KEY = 'codeskin.activeProfileId';
    constructor(context) {
        this.context = context;
    }
    getProfiles() {
        return this.context.globalState.get(this.STORAGE_KEY) || [];
    }
    saveProfile(name, currentState, thumbnailBase64 = null) {
        const profiles = this.getProfiles();
        const newProfile = {
            id: (0, crypto_1.randomUUID)(),
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
    deleteProfile(id) {
        const profiles = this.getProfiles().filter(p => p.id !== id);
        this.context.globalState.update(this.STORAGE_KEY, profiles);
    }
    getActiveProfileId() {
        return this.context.globalState.get(this.ACTIVE_KEY);
    }
    setActiveProfile(id) {
        this.context.globalState.update(this.ACTIVE_KEY, id);
    }
}
exports.ProfileManager = ProfileManager;
//# sourceMappingURL=ProfileManager.js.map