# 🎨 CodeSkin - VS Code Personalizer

> **Make every developer's VS Code feel as personal as their phone — without touching a single config file.**

[![Version](https://img.shields.io/visual-studio-marketplace/v/Ranjitpawar.codeskin?style=for-the-badge&color=blue)](https://marketplace.visualstudio.com/items?itemName=Ranjitpawar.codeskin)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/Ranjitpawar.codeskin?style=for-the-badge&color=brightgreen)](https://marketplace.visualstudio.com/items?itemName=Ranjitpawar.codeskin)

CodeSkin is a powerful Visual Studio Code extension that allows you to fully customize the look and feel of your editor. By injecting custom CSS, CodeSkin enables you to set beautiful background images, apply glassmorphism effects, and automatically theme your workspace based on your wallpaper—just like Android's Material You!

---

## ✨ Features

- **🖼️ Background Image Upload**: Add custom background images to your Editor, Sidebar, or Terminal regions via a simple drag-and-drop interface.
- **🎯 Precise Region Targeting**: Customize background image, blur radius, and opacity specifically for the Editor, Sidebar, and Terminal independently.
- **🎨 Auto Color Extraction (Material You)**: With a single click, extract dominant colors from your wallpaper and automatically apply a matching, harmonious VS Code theme.
- **🎛️ Profiles System**: Save your favorite setups as profiles and switch between complete configurations instantly.
- **🖱️ User-Friendly UI**: A sleek webview interface that requires zero manual JSON configuration.

---

## 🚀 Installation & Usage

1. Open the Command Palette (`Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS).
2. Type and select **`CodeSkin: Open Settings`** (or use the shortcut `Ctrl+Shift+K` / `Cmd+Shift+K`).
3. In the CodeSkin Webview panel, **drag and drop** your favorite image.
4. Use the intuitive sliders to adjust the **Opacity** and **Blur** for each region.
5. Click **Extract Colors (Material You)** to automatically adapt your VS Code UI colors to match your new background!

---

## ⚠️ Important Disclaimer: "Installation Corrupted" Warning

CodeSkin achieves these deep customizations by injecting custom CSS directly into VS Code's core UI files (like `workbench.html`). 

Because of this, VS Code will likely display an **"Installation Corrupted"** warning in the title bar after applying a theme. 

**This is completely normal and safe.** It is simply VS Code detecting that its internal files have been modified. 
- You can safely dismiss the warning.
- Alternatively, click the gear icon on the warning and select **"Don't show again"**.

---

## 🔧 Troubleshooting & Uninstallation

If you ever experience visual glitches or wish to remove CodeSkin completely:

- **To Repair/Reset UI**: Open the Command Palette and run `CodeSkin: Repair Installation`. This will attempt to clean up the injected CSS and restore VS Code's default UI state.
- **To Uninstall**: 
  1. Open the Command Palette and run `CodeSkin: Uninstall / Remove Backgrounds` to clean up modified files.
  2. Uninstall the extension from the VS Code Extensions panel.
  3. Fully restart VS Code.

---

## 📋 Requirements

- **Visual Studio Code**: Version `1.85.0` or later.
- Make sure VS Code has the appropriate file system permissions to modify its own installation files.

---

*Crafted with ❤️ for developers who love a beautiful workspace.*
