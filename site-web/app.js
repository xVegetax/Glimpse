/* ==========================================================================
   Glimpse Website — High-End GSAP + ScrollTrigger Choreography & Interactivity
   ========================================================================== */

(() => {
  // Register GSAP ScrollTrigger
  if (window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
  }

  // ---- 1. Bilingual Dictionary (FR / EN) ----
  const dict = {
    fr: {
      nav_capture: "Capture",
      nav_editor: "Éditeur",
      nav_themes: "Thèmes",
      nav_mobile: "Mobile",
      nav_shortcuts: "Raccourcis",
      nav_cta: "Télécharger",
      hero_badge: "Glimpse 1.0 · Tauri v2 + Rust · Windows 10 & 11",
      hero_title: "La capture d'écran, élevée au rang d'objet éditorial.",
      hero_subtitle:
        "Un dock flottant imperceptible, cinq modes de capture instantanés, un studio d'annotation vectoriel et pixel, l'OCR natif hors-ligne et le transfert mobile par QR Code local.",
      hero_cta_primary: "Télécharger pour Windows (.exe)",
      hero_cta_secondary: "Explorer le code sur GitHub",
      pill_modes: "5 Modes de Capture & Vidéo 60 FPS",
      pill_themes: "Liquid Glass · Windows XP · Minecraft",
      hero_dock_label: "Dock flottant actif",
      badge_default: "Défaut",
      card_desc_glass: "Verre translucide moderne, mode clair et sombre",
      card_desc_xp: "Barre bleue iconique et bouton vert démarrer",
      card_desc_mc: "Inventaire en pierre ciselée et accent émeraude",
      mockup_split: "+ Ajouter à côté (50/50)",
      mockup_phone_ready: "Téléphone prêt · Wi-Fi local",
      mockup_copy: "Copier (Ctrl+C)",
      card_1_title: "Architecture Tauri v2",
      card_1_meta: "Capture GDI sans latence, superposition multi-écrans et consommation mémoire minimale.",
      card_2_title: "Moteur Vectoriel & Pixel",
      card_2_meta: "Redimensionnement par poignées aux 4 coins, flèche calibrée au pixel et floutage confidentiel.",
      mockup_annotation_note: "Flèche vectorielle sans débordement · Poignées de redimensionnement actives",
      layers_title: "Calques actifs",
      layer_1: "① Pastille numérotée #1",
      layer_2: "↗ Flèche directionnelle",
      layer_3: "▦ Zone floutée (RGPD)",
      ocr_title: "OCR Windows",
      ocr_desc: "Texte détecté prêt à être copié en un clic via Windows.Media.Ocr.",
      sec1_badge: "01 · Précision de capture",
      sec1_title: "Cinq façons de saisir l'instant, de la région au flux vidéo 60 FPS.",
      sec1_p1:
        "Chaque capture commence par un geste net. Que vous découpiez un composant d'interface au pixel près grâce à la loupe intégrée, que vous verrouilliez automatiquement une fenêtre Windows sous votre curseur ou que vous détouriez une silhouette au lasso à main levée, Glimpse répond instantanément.",
      sec1_p2:
        "Besoin de montrer un mouvement ? Basculez sur l'enregistreur vidéo MP4 intégré : choisissez entre 30 et 60 images par seconde, sélectionnez votre source audio et activez le suivi fluide du curseur sans quitter votre barre d'accueil.",
      mode_rect: "Rectangle",
      mode_win: "Fenêtre intelligente",
      mode_lasso: "Lasso libre",
      mode_full: "Plein écran",
      mode_video: "Vidéo MP4 (30/60 FPS)",
      sec2_badge: "02 · Studio d'annotation & Multi-captures",
      sec2_title: "Un atelier vectoriel et pixel pensé pour comparer, masquer et expliquer.",
      sec2_p1:
        "La barre d'outils verticale sur deux colonnes garde chaque instrument à portée de main sans jamais défiler : flèches à pointe calibrée, rectangles, cercles et triangles redimensionnables par leurs quatre coins, texte riche avec six typographies dédiées, pastilles numérotées auto-incrémentées et baguette magique de détourage.",
      sec2_p2:
        "Ouvrez plusieurs captures dans des onglets dédiés, renommez-les d'un double-clic sans déclencher de raccourcis parasites, ou affichez deux captures côte à côte en mode Split View 50/50 pour documenter un avant/après en un clin d'œil.",
      sec3_badge: "03 · Trois identités visuelles",
      sec3_title: "Du verre dépoli contemporain aux icônes nostalgiques de Windows XP et Minecraft.",
      sec3_p1:
        "Parce qu'un outil quotidien doit s'accorder à votre humeur, Glimpse transforme intégralement son dock, son éditeur, ses sous-menus et ses animations selon trois thèmes complets : Liquid Glass (Clair et Sombre), Windows XP Luna et Minecraft GUI.",
      dock_btn_capture: "⊡ Capturer",
      dock_btn_video: "▭ Vidéo",
      dock_btn_settings: "⚙ Réglages",
      sec4_badge: "04 · Partage Mobile Local & OCR Hors-ligne",
      sec4_title: "De votre écran PC à votre téléphone en deux secondes, sans aucun cloud.",
      sec4_p1:
        "Un clic sur Envoyer au téléphone démarre un serveur HTTP local éphémère sur votre réseau Wi-Fi. Scannez le QR Code généré pour parcourir et enregistrer vos captures en pleine résolution dans votre pellicule mobile — avec indicateur de connexion en direct intégré au bouton.",
      qr_badge: "Zéro serveur externe · 100 % Réseau local",
      qr_title: "Galerie mobile plein écran instantanée",
      qr_desc:
        "Chaque nouvelle capture envoyée apparaît instantanément sur votre téléphone avec téléchargement direct en pleine qualité et fermeture propre de la session en un clic.",
      sec5_badge: "05 · Pensé pour le clavier",
      sec5_title: "Chaque action possède son raccourci dédié, entièrement personnalisable.",
      sec5_p1:
        "Remplacez la capture actuelle ou ajoutez un nouvel onglet photo à la volée. Lorsque vous saisissez du texte sur le canevas ou renommez un onglet de capture, la détection des raccourcis se met automatiquement en pause pour ne jamais interrompre votre frappe.",
      sc_new_cap: "Nouvelle capture",
      sc_new_cap_sub: "Lance une nouvelle sélection et remplace le canevas actif",
      sc_new_photo: "+ Nouvelle photo (Onglet)",
      sc_new_photo_sub: "Prend une capture et l'ajoute dans un nouvel onglet sans fermer les précédentes",
      sc_copy_save: "Copier / Enregistrer l'image annotée",
      sc_copy_save_sub: "Presse-papiers instantané ou export PNG, JPEG et WebP",
      sc_tools: "Outils rapides de l'éditeur",
      sc_tools_sub: "Sélecteur (V), Pinceau (P), Flèche (A), Rectangle (R), Texte (T), Floutage (B), OCR (O)",
      dl_badge: "Disponible en 5 langues · FR · EN · ES · DE · RU",
      dl_title: "Adoptez Glimpse sur votre bureau Windows.",
      dl_desc:
        "Installeur natif ultra-léger (.exe NSIS & .msi), démarrage automatique optionnel avec Windows et code source intégralement ouvert sous licence MIT.",
      dl_btn_main: "Télécharger Glimpse v1.0.0 (.exe)",
      dl_btn_gh: "Voir le dépôt GitHub",
      footer_copy: "Conçu avec Tauri v2, Rust & TypeScript · Licence MIT",
    },
    en: {
      nav_capture: "Capture",
      nav_editor: "Editor",
      nav_themes: "Themes",
      nav_mobile: "Mobile",
      nav_shortcuts: "Shortcuts",
      nav_cta: "Download",
      hero_badge: "Glimpse 1.0 · Tauri v2 + Rust · Windows 10 & 11",
      hero_title: "Screen capture, elevated to an editorial craft.",
      hero_subtitle:
        "A weightless floating dock, five instant capture modes, a vector and pixel annotation studio, offline native Windows OCR, and local Wi-Fi QR code phone transfer.",
      hero_cta_primary: "Download for Windows (.exe)",
      hero_cta_secondary: "Explore source on GitHub",
      pill_modes: "5 Capture Modes & 60 FPS Video",
      pill_themes: "Liquid Glass · Windows XP · Minecraft",
      hero_dock_label: "Active Floating Dock",
      badge_default: "Default",
      card_desc_glass: "Modern frosted glass, light and dark modes",
      card_desc_xp: "Iconic Luna blue bar and green start button",
      card_desc_mc: "Chiseled stone inventory and emerald accent",
      mockup_split: "+ Add side-by-side (50/50)",
      mockup_phone_ready: "Phone connected · Local Wi-Fi",
      mockup_copy: "Copy (Ctrl+C)",
      card_1_title: "Tauri v2 Architecture",
      card_1_meta: "Zero-latency GDI capture, multi-monitor overlay, and minimal memory footprint.",
      card_2_title: "Vector & Pixel Engine",
      card_2_meta: "4-corner resize handles, precision-calibrated arrow tips, and privacy pixelation.",
      mockup_annotation_note: "Zero-overshoot vector arrow · 4-corner resize handles active",
      layers_title: "Active Layers",
      layer_1: "① Numbered badge #1",
      layer_2: "↗ Directional arrow",
      layer_3: "▦ Redacted mosaic zone",
      ocr_title: "Windows OCR",
      ocr_desc: "Extracted text ready to copy in one click via offline Windows.Media.Ocr.",
      sec1_badge: "01 · Capture Precision",
      sec1_title: "Five ways to seize the frame, from pixel region to 60 FPS video.",
      sec1_p1:
        "Every capture starts with a crisp gesture. Whether you crop a UI component to the exact pixel with the live magnifier, snap automatically to any Windows application window under your cursor, or trace a freehand lasso mask, Glimpse responds instantaneously.",
      sec1_p2:
        "Need to show motion? Switch to the built-in MP4 recorder: choose between 30 and 60 FPS, pick your audio input device, and enable smooth cursor tracking right from the dock.",
      mode_rect: "Rectangle",
      mode_win: "Smart Window",
      mode_lasso: "Freehand Lasso",
      mode_full: "Fullscreen",
      mode_video: "MP4 Video (30/60 FPS)",
      sec2_badge: "02 · Annotation Studio & Multi-Capture",
      sec2_title: "A vector and pixel workshop built to compare, redact, and explain.",
      sec2_p1:
        "The two-column vertical toolbar keeps every instrument within reach without scrolling: calibrated arrows, rectangles, circles, and triangles with four-corner resize handles, rich text in six curated fonts, auto-incrementing step badges, and a tolerance-based Magic Wand.",
      sec2_p2:
        "Open multiple captures in dedicated tabs, double-click to rename them without triggering hotkeys, or place two captures side-by-side in 50/50 Split View to document before-and-after changes effortlessly.",
      sec3_badge: "03 · Three Visual Identities",
      sec3_title: "From contemporary frosted glass to nostalgic Windows XP and Minecraft skins.",
      sec3_p1:
        "Because a daily utility should match your taste, Glimpse restyles its entire floating dock, editor, popovers, and motion curves across three complete themes: Liquid Glass (Light & Dark), Windows XP Luna, and Minecraft GUI.",
      dock_btn_capture: "⊡ Capture",
      dock_btn_video: "▭ Video",
      dock_btn_settings: "⚙ Settings",
      sec4_badge: "04 · Local Mobile Share & Offline OCR",
      sec4_title: "From your PC desktop to your phone camera roll in two seconds, zero cloud.",
      sec4_p1:
        "Clicking Send to Phone spins up an ephemeral local HTTP server over your Wi-Fi network. Scan the QR Code to browse and download full-resolution captures straight to your phone — complete with a live connection status dot.",
      qr_badge: "Zero external server · 100% Local Wi-Fi",
      qr_title: "Instant fullscreen mobile gallery",
      qr_desc:
        "Every capture you send appears immediately on your smartphone with one-tap full-quality download and clean session disconnect.",
      sec5_badge: "05 · Keyboard First",
      sec5_title: "Every action has its own dedicated, customizable shortcut.",
      sec5_p1:
        "Replace the active capture or open a fresh photo tab on the fly. Whenever you type inside a text layer or rename a capture tab, global shortcut detection pauses automatically so your typing is never interrupted.",
      sc_new_cap: "New Capture",
      sc_new_cap_sub: "Starts a new region selection and replaces the current canvas",
      sc_new_photo: "+ New Photo (Tab)",
      sc_new_photo_sub: "Captures a new shot and opens it in a fresh tab alongside existing ones",
      sc_copy_save: "Copy / Save annotated image",
      sc_copy_save_sub: "Instant clipboard copy or PNG, JPEG, and WebP file export",
      sc_tools: "Quick Editor Tools",
      sc_tools_sub: "Select (V), Pen (P), Arrow (A), Rectangle (R), Text (T), Blur (B), OCR (O)",
      dl_badge: "Available in 5 languages · EN · FR · ES · DE · RU",
      dl_title: "Bring Glimpse to your Windows desktop.",
      dl_desc:
        "Lightweight native installer (.exe NSIS & .msi), optional Windows startup launch, and 100% open-source under the MIT License.",
      dl_btn_main: "Download Glimpse v1.0.0 (.exe)",
      dl_btn_gh: "View GitHub Repository",
      footer_copy: "Built with Tauri v2, Rust & TypeScript · MIT License",
    },
  };

  let currentLang = "fr";

  const modeDescriptions = {
    fr: {
      rect: {
        badge: "Loupe ×4 · Dimensions en direct",
        heading: "Sélection rectangulaire au pixel près",
        desc: "Tracez une zone avec aperçu des coordonnées en temps réel, ajustez les poignées avant validation ou copiez immédiatement dans le presse-papiers.",
      },
      win: {
        badge: "Détection Win32 automatique",
        heading: "Capture de fenêtre intelligente",
        desc: "Survolez n'importe quelle application ouverte : Glimpse isole automatiquement ses bordures exactes en un clic.",
      },
      lasso: {
        badge: "Tracé libre organique",
        heading: "Détourage à main levée (Lasso)",
        desc: "Dessinez librement autour d'un élément précis pour extraire uniquement la forme souhaitée sur fond transparent.",
      },
      full: {
        badge: "Multi-écrans instantané",
        heading: "Capture Plein Écran sans latence",
        desc: "Saisissez l'intégralité de votre moniteur actif en une fraction de seconde via l'API native Windows GDI.",
      },
      video: {
        badge: "MP4 · 30 / 60 FPS · Audio & Curseur",
        heading: "Enregistrement vidéo haute fluidité",
        desc: "Enregistrez une zone précise ou tout l'écran en MP4 avec sélection du microphone et suivi optionnel de la souris.",
      },
    },
    en: {
      rect: {
        badge: "4× Magnifier · Live Dimensions",
        heading: "Pixel-accurate rectangular selection",
        desc: "Drag a region with real-time coordinate feedback, fine-tune handles before confirming, or copy straight to clipboard.",
      },
      win: {
        badge: "Automatic Win32 Detection",
        heading: "Smart Window snapping",
        desc: "Hover over any open application window: Glimpse highlights and captures its exact bounds in a single click.",
      },
      lasso: {
        badge: "Organic Freeform Mask",
        heading: "Freehand Lasso cutout",
        desc: "Draw freely around any UI element to extract only the exact shape you need on a clean transparent background.",
      },
      full: {
        badge: "Instant Multi-Monitor",
        heading: "Zero-latency Fullscreen capture",
        desc: "Grab your entire active monitor in milliseconds powered by native Windows GDI.",
      },
      video: {
        badge: "MP4 · 30 / 60 FPS · Audio & Cursor",
        heading: "High-framerate MP4 video recording",
        desc: "Record a custom region or fullscreen in smooth 30/60 FPS MP4 with audio device selection and cursor tracking.",
      },
    },
  };

  const skinDescriptions = {
    fr: {
      "liquid-glass":
        "Translucidité subtile, contours spéculaires d'un pixel et animations élastiques inspirées des interfaces natives modernes.",
      "win-xp":
        "Hommage authentique au style Luna de Windows XP : barres de titre bleues, surfaces beiges tactiles et boutons biseautés.",
      minecraft:
        "Interface pixel-art inspirée de l'inventaire Minecraft avec slots en pierre ciselée, états actifs émeraude et typographie rétro.",
    },
    en: {
      "liquid-glass":
        "Subtle frosted translucency, 1px specular borders, and spring animations inspired by modern native OS surfaces.",
      "win-xp":
        "Authentic tribute to Windows XP Luna: iconic blue title bars, tactile beige toolbars, and classic 3D beveled controls.",
      minecraft:
        "Crisp pixel-art stone inventory slots, emerald active states, and blocky typography inspired by Minecraft.",
    },
  };

  // ---- 2. Language Switcher (Dropdown FR / EN) ----
  const langToggleBtn = document.getElementById("lang-toggle");
  const langMenu = document.getElementById("lang-menu");
  const langCurrentLabel = document.getElementById("lang-current-label");

  function setLanguage(lang) {
    if (!dict[lang]) return;
    currentLang = lang;
    document.documentElement.lang = currentLang;
    const strings = dict[currentLang];

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (strings[key]) {
        el.textContent = strings[key];
      }
    });

    if (langCurrentLabel) {
      langCurrentLabel.textContent = currentLang.toUpperCase();
    }

    document.querySelectorAll(".lang-option[data-lang]").forEach((opt) => {
      opt.classList.toggle("active", opt.getAttribute("data-lang") === currentLang);
    });

    // Refresh active mode, skin & tool descriptions
    const activeModeBtn = document.querySelector(".mode-pill-btn[data-mode].active");
    if (activeModeBtn) updateModeStage(activeModeBtn.getAttribute("data-mode"));

    const activeSkinCard = document.querySelector("[data-skin-card].active");
    if (activeSkinCard) updateSkinStage(activeSkinCard.getAttribute("data-skin-card"));
  }

  if (langToggleBtn && langMenu) {
    langToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = langMenu.classList.toggle("open");
      langToggleBtn.setAttribute("aria-expanded", String(isOpen));
    });

    document.querySelectorAll(".lang-option[data-lang]").forEach((opt) => {
      opt.addEventListener("click", () => {
        setLanguage(opt.getAttribute("data-lang"));
        langMenu.classList.remove("open");
        langToggleBtn.setAttribute("aria-expanded", "false");
      });
    });

    document.addEventListener("click", () => {
      langMenu.classList.remove("open");
      langToggleBtn.setAttribute("aria-expanded", "false");
    });
  }

  // ---- 3. Smooth Scroll for Hero Pill Buttons ----
  document.querySelectorAll("[data-scroll-to]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.querySelector(btn.getAttribute("data-scroll-to"));
      if (target) target.scrollIntoView({ behavior: "smooth" });
    });
  });

  // ---- 4. Interactive Capture Modes Switcher ----
  function updateModeStage(modeKey) {
    const data = modeDescriptions[currentLang][modeKey];
    if (!data) return;
    const badge = document.getElementById("mode-stage-badge");
    const heading = document.getElementById("mode-stage-heading");
    const desc = document.getElementById("mode-stage-desc");
    const container = document.getElementById("mode-stage-content");

    if (window.gsap && container) {
      gsap.fromTo(
        container,
        { opacity: 0.3, y: 8 },
        { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" }
      );
    }
    if (badge) badge.textContent = data.badge;
    if (heading) heading.textContent = data.heading;
    if (desc) desc.textContent = data.desc;
  }

  document.querySelectorAll(".mode-pill-btn[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mode-pill-btn[data-mode]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      updateModeStage(btn.getAttribute("data-mode"));
    });
  });

  // ---- 5. Interactive Theme Switcher (Liquid Glass / Win XP / Minecraft) ----
  const skinAssets = {
    "liquid-glass": "assets/dock-liquid-glass.png",
    "win-xp": "assets/dock-win-xp.png",
    minecraft: "assets/dock-minecraft.png",
  };

  const skinMeta = {
    fr: {
      "liquid-glass": {
        label: "Liquid Glass · Clair & Sombre",
        spec: "Verre dépoli · Contours 1px · Courbes élastiques",
      },
      "win-xp": {
        label: "Windows XP · Style Luna",
        spec: "Dégradé Bleu Luna · Boutons 3D · Nostalgie 2001",
      },
      minecraft: {
        label: "Minecraft GUI · Pixel Art",
        spec: "Slots en pierre · Émeraude actif · Grille nette",
      },
    },
    en: {
      "liquid-glass": {
        label: "Liquid Glass · Light & Dark",
        spec: "Frosted glass · 1px specular · Spring motion",
      },
      "win-xp": {
        label: "Windows XP · Luna Style",
        spec: "Luna Blue gradient · 3D bevels · 2001 nostalgia",
      },
      minecraft: {
        label: "Minecraft GUI · Pixel Art",
        spec: "Stone inventory slots · Emerald active · Crisp grid",
      },
    },
  };

  function updateSkinStage(skinKey) {
    const dock = document.getElementById("interactive-theme-dock");
    const stageCanvas = document.getElementById("theme-stage-canvas");
    const pill = document.getElementById("skin-indicator-pill");
    const specPill = document.getElementById("skin-spec-pill");
    const caption = document.getElementById("skin-caption-text");
    const activeImg = document.getElementById("active-skin-dock-img");
    if (!dock) return;

    const meta = skinMeta[currentLang][skinKey];
    if (stageCanvas) stageCanvas.setAttribute("data-skin-stage", skinKey);
    if (pill && meta) pill.textContent = meta.label;
    if (specPill && meta) specPill.textContent = meta.spec;
    if (caption) caption.textContent = skinDescriptions[currentLang][skinKey];
    if (activeImg && skinAssets[skinKey]) {
      activeImg.src = skinAssets[skinKey];
      activeImg.alt = `Dock Glimpse — ${meta ? meta.label : skinKey}`;
    }

    document.querySelectorAll("[data-skin-card]").forEach((c) => {
      c.classList.toggle("active", c.getAttribute("data-skin-card") === skinKey);
    });

    if (window.gsap) {
      gsap.fromTo(
        dock,
        { y: 8, scale: 0.96, opacity: 0.65 },
        { y: 0, scale: 1, opacity: 1, duration: 0.38, ease: "back.out(1.7)" }
      );
    }
  }

  document.querySelectorAll("[data-skin-card]").forEach((card) => {
    card.addEventListener("click", () => {
      updateSkinStage(card.getAttribute("data-skin-card"));
    });
  });

  // ---- 6. Interactive Tool Slots & Color Swatches inside Hero Device Mockup ----
  const toolMessages = {
    fr: {
      select: { num: "↖", text: "Sélecteur (V) · Déplacez et redimensionnez chaque calque par ses 4 coins" },
      pen: { num: "✎", text: "Pinceau (P) · Tracé à main levée lissé avec épaisseur réglable" },
      highlighter: { num: "🖍", text: "Surligneur (H) · Passage translucide sur le texte sans masquer le fond" },
      line: { num: "╱", text: "Ligne (L) · Trait vectoriel droit avec maintien Shift pour 45° / 90°" },
      arrow: { num: "↗", text: "Flèche vectorielle (A) · Pointe calibrée sans débordement au pixel près" },
      text: { num: "T", text: "Texte riche (T) · 6 polices, alignement, contour, fond et rotation libre" },
      shapes: { num: "△", text: "Formes & Emojis (R) · Rectangle, Rond, Triangle (64×64 min) et autocollants" },
      badge: { num: "1", text: "Pastilles numérotées (N) · Numérotation automatique ① ② ③ à chaque clic" },
      blur: { num: "▦", text: "Floutage & Mosaïque (B) · Masquez instantanément vos données sensibles" },
      eraser: { num: "◫", text: "Gomme (G) · Effacez proprement vos tracés pixel ou supprimez un calque" },
      crop: { num: "⌗", text: "Recadrer (C) · Ajustement libre ou par poignées avec dimensions en direct" },
      undo: { num: "↶", text: "Annuler (Ctrl+Z) · Historique complet multi-niveaux de vos modifications" },
      redo: { num: "↷", text: "Rétablir (Ctrl+Y) · Revenez à l'état suivant en un instant" },
      ocr: { num: "⌕", text: "OCR Windows (O) · Extraction de texte 100 % hors-ligne via Windows.Media.Ocr" },
      layers: { num: "⧉", text: "Calques · Réorganisez, verrouillez, masquez ou dupliquez vos annotations" },
    },
    en: {
      select: { num: "↖", text: "Select (V) · Move and resize any layer from its 4 corner handles" },
      pen: { num: "✎", text: "Pen (P) · Smooth freehand drawing with adjustable stroke width" },
      highlighter: { num: "🖍", text: "Highlighter (H) · Translucent marker over text without hiding details" },
      line: { num: "╱", text: "Line (L) · Crisp vector line with Shift snap for 45° / 90° angles" },
      arrow: { num: "↗", text: "Vector Arrow (A) · Precision-calibrated tip with zero overshoot" },
      text: { num: "T", text: "Rich Text (T) · 6 curated fonts, alignment, outline, backdrop, and rotation" },
      shapes: { num: "△", text: "Shapes & Emojis (R) · Rectangle, Circle, Triangle (64×64 min), and stickers" },
      badge: { num: "1", text: "Numbered Badges (N) · Auto-incrementing ① ② ③ steps on every click" },
      blur: { num: "▦", text: "Blur & Pixelate (B) · Instantly redact sensitive information" },
      eraser: { num: "◫", text: "Eraser (G) · Cleanly erase pixel strokes or remove annotations" },
      crop: { num: "⌗", text: "Crop (C) · Freeform or handle-based cropping with live dimensions" },
      undo: { num: "↶", text: "Undo (Ctrl+Z) · Full multi-step edit history" },
      redo: { num: "↷", text: "Redo (Ctrl+Y) · Step forward instantly" },
      ocr: { num: "⌕", text: "Windows OCR (O) · 100% offline text extraction via Windows.Media.Ocr" },
      layers: { num: "⧉", text: "Layers · Reorder, lock, toggle visibility, or duplicate annotations" },
    },
  };

  document.querySelectorAll(".tool-slot[data-tool]").forEach((slot) => {
    slot.addEventListener("click", () => {
      document.querySelectorAll(".tool-slot[data-tool]").forEach((s) => s.classList.remove("active"));
      slot.classList.add("active");

      const toolKey = slot.getAttribute("data-tool");
      const info = toolMessages[currentLang][toolKey];
      const pillNum = document.getElementById("annotation-pill-num");
      const pillText = document.getElementById("annotation-pill-text");

      if (info && pillNum && pillText) {
        pillNum.textContent = info.num;
        pillText.textContent = info.text;
      }

      if (window.gsap) {
        gsap.fromTo(
          "#gsap-annotation-pill",
          { scale: 0.94, opacity: 0.7 },
          { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(2)" }
        );
      }
    });
  });

  document.querySelectorAll(".color-swatch").forEach((swatch) => {
    swatch.addEventListener("click", () => {
      document.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("active"));
      swatch.classList.add("active");
    });
  });

  // ---- 7. GSAP + ScrollTrigger High-End Animations ----
  if (window.gsap && window.ScrollTrigger) {
    // A. Initial Hero Entrance Timeline
    const heroTl = gsap.timeline({ defaults: { ease: "power3.out" } });

    heroTl
      .fromTo(
        "#floating-nav",
        { y: -30, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8 }
      )
      .fromTo(
        "#hero-plaque",
        { y: 36, opacity: 0, scale: 0.98 },
        { y: 0, opacity: 1, scale: 1, duration: 0.9 },
        "-=0.45"
      )
      .fromTo(
        "#hero-pills .btn-hero-pill",
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.6, stagger: 0.1 },
        "-=0.5"
      )
      .fromTo(
        "#hero-mockup",
        { y: 60, opacity: 0, scale: 0.96 },
        { y: 0, opacity: 1, scale: 1, duration: 1.1, ease: "expo.out" },
        "-=0.45"
      );

    // B. Hero Parallax on Scroll (Mockup rises gently over the sunset silhouette)
    gsap.to("#hero-mockup", {
      y: -38,
      ease: "none",
      scrollTrigger: {
        trigger: ".hero-section",
        start: "top top",
        end: "bottom top",
        scrub: 0.8,
      },
    });

    gsap.to("#hero-stars", {
      y: 80,
      ease: "none",
      scrollTrigger: {
        trigger: ".hero-section",
        start: "top top",
        end: "bottom top",
        scrub: true,
      },
    });

    // C. Reveal Editorial Blocks & Showcase Cards on Scroll
    gsap.utils.toArray(".gsap-reveal").forEach((section) => {
      gsap.fromTo(
        section,
        { y: 44, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.9,
          ease: "power3.out",
          scrollTrigger: {
            trigger: section,
            start: "top 84%",
            toggleActions: "play none none none",
          },
        }
      );
    });

    // D. Stagger Keyboard Shortcut Cards
    gsap.fromTo(
      ".shortcut-row-card",
      { y: 24, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.65,
        stagger: 0.1,
        ease: "power2.out",
        scrollTrigger: {
          trigger: ".shortcuts-stack",
          start: "top 85%",
        },
      }
    );
  }
})();
