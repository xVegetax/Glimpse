<p align="center">
  <img src="src-tauri/icons/128x128.png" width="84" alt="Glimpse Logo">
</p>

<h1 align="center">Glimpse</h1>

<p align="center">La capture d'écran, en verre liquide.</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-10%20%2F%2011-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows 10/11">
  <img src="https://img.shields.io/badge/Tauri-v2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri v2">
  <img src="https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="MIT License">
</p>

<p align="center">
  <a href="README.md">English</a> · <b>Français</b> &nbsp;|&nbsp;
  <a href="#fonctionnalités">Fonctionnalités</a> ·
  <a href="#thèmes">Thèmes</a> ·
  <a href="#raccourcis">Raccourcis</a> ·
  <a href="#compiler">Compiler</a>
</p>

<p align="center">
  <img src="docs/dock%20glass.png" width="32%" alt="Dock Liquid Glass">
  <img src="docs/dock%20win.png" width="32%" alt="Dock Windows XP">
  <img src="docs/dock%20minecraft.png" width="32%" alt="Dock Minecraft GUI">
</p>

<p align="center">
  <img src="docs/menu%20editor%20haut.png" width="96%" alt="Barre supérieure et onglets multi-captures">
</p>

<p align="center">
  <img src="docs/menu%20reglages%20win.png" width="44%" alt="Réglages Glimpse">
  <img src="docs/raccourcis%20clavier.png" width="44%" alt="Raccourcis clavier">
  <img src="docs/menu%20editor.png" width="8%" alt="Barre d'outils verticale">
</p>

Un outil rapide et ultra-léger de capture d'écran, d'annotation et d'enregistrement vidéo MP4 pour Windows, conçu avec **Tauri v2**, **Rust** et **TypeScript**.

Glimpse remplace les utilitaires de capture lourds par un dock flottant translucide, un éditeur complet (vectoriel + pixel), la reconnaissance de texte hors-ligne (OCR Windows), le transfert instantané sur téléphone par QR Code Wi-Fi et trois thèmes visuels complets.

| | |
|---|---|
| Modes de capture | **Rectangle · Fenêtre · Lasso libre · Plein écran · Vidéo MP4** |
| Éditeur Vectoriel & Pixel | **Flèches · Formes · Texte riche · Floutage · Baguette magique · Calques** |
| Multi-captures | **Onglets multiples · Vue côte à côte (Split 50/50) · Export groupé** |
| OCR Natif | **Extraction de texte 100 % hors-ligne** (`Windows.Media.Ocr`) |
| Partage Mobile Local | **Transfert Wi-Fi instantané par QR Code** (zéro cloud, serveur HTTP local) |
| Thèmes Visuels | **Liquid Glass** (Clair/Sombre) · **Windows XP Luna** · **Minecraft GUI** |
| Langues | **Français · English · Español · Deutsch · Русский** |

## Fonctionnalités

### Capturer & Enregistrer
Sélectionnez une zone au pixel près avec loupe intégrée, détectez automatiquement n'importe quelle fenêtre Windows sous le curseur, détournez une zone au lasso libre, ou enregistrez vos vidéos en **MP4 à 30/60 FPS** avec sélection du périphérique audio et suivi du curseur.

### Annoter & Comparer
Chaque flèche, forme, zone de texte, puce numérotée ou sticker repose sur son propre calque modifiable. Floutez les données sensibles d'un geste, supprimez un arrière-plan avec la **Baguette magique**, ouvrez plusieurs captures dans des onglets, renommez-les d'un double-clic ou comparez deux images côte à côte en mode **Split View**.

### Envoyer sur téléphone
Cliquez sur l'icône téléphone dans l'éditeur pour démarrer un serveur Wi-Fi local éphémère. Scannez le QR Code avec votre smartphone pour visualiser et télécharger vos captures en pleine résolution — aucune donnée ne quitte votre réseau local.

## Thèmes

Glimpse intègre trois interfaces complètes qui transforment le dock flottant, l'éditeur, les sous-menus et l'écran de sélection :
- **Liquid Glass** — Verre dépoli translucide avec reflets spéculaires (Modes Clair & Sombre).
- **Windows XP (Luna)** — Barres de titre bleues iconiques, barres d'outils beiges et boutons 3D classiques.
- **Minecraft GUI** — Cases d'inventaire en pierre pixel-art, états actifs émeraude et typographie rétro.

## Raccourcis

| Raccourci | Action |
|---|---|
| `Impr. écran` | Lancer une capture rapide |
| `Ctrl + Shift + S` | Nouvelle capture (remplace la capture actuelle) |
| `Ctrl + Shift + N` | Ajouter une capture dans un nouvel onglet (`+ Nouvelle photo`) |
| `Ctrl + C` | Copier l'image annotée dans le presse-papiers |
| `Ctrl + S` | Enregistrer l'image (`PNG`, `JPEG`, `WebP`) |
| `Ctrl + Z` / `Ctrl + Y` | Annuler / Rétablir |
| `Suppr` / `Retour arrière` | Supprimer le calque sélectionné |
| `Échap` | Annuler la sélection ou désélectionner l'outil |

## Compiler

Téléchargez directement l'installeur `.exe` ou `.msi` depuis la page [**Releases**](../../releases), ou compilez le projet depuis les sources sur Windows 10/11.

### Prérequis

Installez [Node.js](https://nodejs.org/) (v18+), [Rust](https://rustup.rs/) et les [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/). Puis :

    npm install

### Lancer & Générer l'installeur

    npm run tauri dev      # lancer en mode développement
    npm run tauri build    # compiler les installeurs NSIS (.exe) et MSI

Les installeurs générés se trouvent dans :
- `src-tauri/target/release/bundle/nsis/Glimpse_1.0.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Glimpse_1.0.0_x64_en-US.msi`

## Licence

Licence MIT.
