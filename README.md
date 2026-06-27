# CodeSkin - VS Code Personalizer

Make every developer's VS Code feel as personal as their phone — without touching a single config file.

## Features

- **Background Image Upload:** Add a background image to your Editor, Sidebar, or Terminal regions via simple drag-and-drop.
- **Region Targeting:** Customize background, blur, and opacity specifically for the Editor, Sidebar, and Terminal independently.
- **Auto Color Extraction:** With one click, extract dominant colors from your wallpaper and apply a matching theme (like Android's Material You).
- **Profiles:** Save and switch between complete configurations instantly.

## Usage

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Search for `CodeSkin: Open Settings`.
3. In the Webview panel, drag and drop an image.
4. Use the sliders to adjust Opacity and Blur.
5. Click **Extract Colors (Material You)** to automatically match your VS Code theme colors to the background!

## Disclaimer

**Important:** CodeSkin works by injecting CSS directly into the core `workbench.html` file of VS Code. After applying a background, VS Code may show an **"Installation Corrupted"** warning. This is perfectly normal and expected for CSS injection extensions. You can safely dismiss the warning or click the gear icon to "Don't show again".

## Requirements

- VS Code version 1.85.0 or later.
