<p align="center">
  <img src="src-tauri/icons/128x128.png" width="84" alt="Glimpse Logo">
</p>

<h1 align="center">Glimpse</h1>

<p align="center">Screen capture, in glass.</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-10%20%2F%2011-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows 10/11">
  <img src="https://img.shields.io/badge/Tauri-v2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri v2">
  <img src="https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="MIT License">
</p>

<p align="center">
  <b>English</b> · <a href="README.fr.md">Français</a> &nbsp;|&nbsp;
  <a href="#features">Features</a> ·
  <a href="#themes">Themes</a> ·
  <a href="#shortcuts">Shortcuts</a> ·
  <a href="#build-it">Build it</a>
</p>

<p align="center">
  <img src="docs/dock%20glass.png" width="32%" alt="Liquid Glass Dock">
  <img src="docs/dock%20win.png" width="32%" alt="Windows XP Dock">
  <img src="docs/dock%20minecraft.png" width="32%" alt="Minecraft GUI Dock">
</p>

<p align="center">
  <img src="docs/menu%20editor%20haut.png" width="96%" alt="Glimpse Editor Top Bar & Multi-Capture Tabs">
</p>

<p align="center">
  <img src="docs/menu%20reglages%20win.png" width="44%" alt="Glimpse Settings">
  <img src="docs/raccourcis%20clavier.png" width="44%" alt="Glimpse Keyboard Shortcuts">
  <img src="docs/menu%20editor.png" width="8%" alt="Glimpse Vertical Toolbar">
</p>

A fast, lightweight screen capture, annotation, and MP4 recording tool for Windows built with **Tauri v2**, **Rust**, and **Vanilla TypeScript**.

Glimpse replaces bulky screenshot utilities with a translucent floating dock, a full vector & pixel editor, offline Windows OCR, instant Wi-Fi QR code phone transfer, and three complete visual themes.

| | |
|---|---|
| Capture modes | **Rectangle · Window · Freehand Lasso · Fullscreen · MP4 Video** |
| Vector & Pixel editor | **Arrows · Shapes · Rich Text · Blur/Pixelate · Magic Wand · Layers** |
| Multi-capture workflow | **Multi-tab workspace · 50/50 Split View · Batch export** |
| Native OCR | **100% offline text extraction** (`Windows.Media.Ocr`) |
| Local Mobile Share | **Instant Wi-Fi transfer via QR Code** (zero cloud, local HTTP server) |
| Visual Themes | **Liquid Glass** (Light/Dark) · **Windows XP Luna** · **Minecraft GUI** |
| Languages | **English · Français · Español · Deutsch · Русский** |

## Features

### Capture & Record
Pick a pixel-accurate region with a live magnifier, snap directly to any Windows application window, draw a freehand lasso mask, or record smooth **30/60 FPS MP4 video** with audio device selection and optional cursor tracking.

### Annotate & Compare
Every arrow, shape, text box, numbered badge, and sticker stays on its own editable layer. Blur sensitive data in one stroke, strip backgrounds with the tolerance-based **Magic Wand**, open multiple captures in tabs, rename them inline, or compare two shots side-by-side in **Split View**.

### Send to Phone
Click the phone icon in the editor to spin up an ephemeral local Wi-Fi server. Scan the generated QR Code with your phone to preview and save full-resolution captures straight to your camera roll — nothing ever leaves your local network.

## Themes

Glimpse ships with three full UI skins that restyle the floating dock, editor, submenus, and capture overlay:
- **Liquid Glass** — Translucent frosted glass with specular borders (Light & Dark modes).
- **Windows XP (Luna)** — Authentic blue title bars, tactile beige toolbars, and classic 3D beveled controls.
- **Minecraft GUI** — Crisp pixel-art stone inventory slots, emerald active states, and blocky typography.

## Shortcuts

| Shortcut | Action |
|---|---|
| `PrintScreen` | Trigger quick capture |
| `Ctrl + Shift + S` | New capture (replaces current canvas) |
| `Ctrl + Shift + N` | Add capture in a new tab (`+ New Photo`) |
| `Ctrl + C` | Copy annotated image to clipboard |
| `Ctrl + S` | Save image (`PNG`, `JPEG`, `WebP`) |
| `Ctrl + Z` / `Ctrl + Y` | Undo / Redo |
| `Delete` / `Backspace` | Delete selected layer |
| `Escape` | Cancel capture or deselect tool |

## Build it

Download the latest `.exe` or `.msi` installer from [**Releases**](../../releases), or build it from source on Windows 10/11.

### Prerequisites

Install [Node.js](https://nodejs.org/) (v18+), [Rust](https://rustup.rs/), and the [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/). Then:

    npm install

### Run & Package

    npm run tauri dev      # launch in development mode with hot-reload
    npm run tauri build    # build production NSIS (.exe) & MSI installers

Built installers are output to:
- `src-tauri/target/release/bundle/nsis/Glimpse_1.0.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Glimpse_1.0.0_x64_en-US.msi`

## License

MIT License.
