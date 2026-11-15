// main.ts — Mac-style Liquid Glass dock navigation + background-free Editor wiring.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize, PhysicalPosition, currentMonitor } from "@tauri-apps/api/window";
import { AnnotationEditor } from "./editor/editor";
import { applyLanguage, t } from "./i18n";

const appWindow = getCurrentWindow();
let toastTimer: number | undefined;
let editor: AnnotationEditor | null = null;
let lastDockPos: { x: number; y: number } | null = null;
let clampTimer: number | undefined;

async function fitWindowToDock(): Promise<void> {
  const shell = document.querySelector<HTMLElement>(".dock-shell");
  if (!shell) return;
  const rect = shell.getBoundingClientRect();
  await appWindow.setSize(new LogicalSize(Math.ceil(rect.width), Math.ceil(rect.height)));
}

function showToast(message: string, isError = false): void {
  const toast = document.querySelector<HTMLDivElement>("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2200);
}

async function switchToEditorView(): Promise<void> {
  const editorView = document.querySelector("#editor-view");
  const alreadyInEditor = editorView ? !editorView.classList.contains("hidden") : false;
  document.querySelector("#welcome-view")?.classList.add("hidden");
  document.querySelector("#scrolling-view")?.classList.add("hidden");
  document.querySelector("#recording-view")?.classList.add("hidden");
  document.querySelector("#settings-view")?.classList.add("hidden");
  document.querySelector("#shortcuts-view")?.classList.add("hidden");
  editorView?.classList.remove("hidden");
  try {
    const fullscreen = await appWindow.isFullscreen();
    if (!fullscreen && !alreadyInEditor) {
      await appWindow.setSize(new LogicalSize(1240, 740));
      await appWindow.center();
    }
  } catch (e) {
    console.error("resize to editor failed", e);
  }
  window.setTimeout(() => editor?.fitCanvasToStage(), 50);
}

async function switchToDockView(): Promise<void> {
  document.querySelector("#editor-view")?.classList.add("hidden");
  document.querySelector("#recording-view")?.classList.add("hidden");
  document.querySelector("#settings-view")?.classList.add("hidden");
  document.querySelector("#shortcuts-view")?.classList.add("hidden");
  document.querySelector("#welcome-view")?.classList.remove("hidden");
  try {
    if (await appWindow.isFullscreen()) await appWindow.setFullscreen(false);
    await fitWindowToDock();
    if (lastDockPos) {
      await appWindow.setPosition(new PhysicalPosition(lastDockPos.x, lastDockPos.y));
    } else {
      await appWindow.center();
    }
  } catch (e) {
    console.error("resize to dock failed", e);
  }
}

interface AppSettings {
  theme: "dark" | "light";
  launch_on_startup: boolean;
  video_dir: string | null;
}

let currentSettings: AppSettings = {
  theme: "dark",
  launch_on_startup: false,
  video_dir: null,
};

type UiTheme = "liquid-glass" | "win-xp" | "minecraft";

async function fitWindowToSettings(): Promise<void> {
  const card = document.querySelector<HTMLElement>("#settings-view .settings-card");
  if (!card) return;
  const rect = card.getBoundingClientRect();
  const h = Math.ceil(Math.max(rect.height, card.scrollHeight) + 2);
  await appWindow.setSize(new LogicalSize(490, h));
}

function applyUiTheme(uiTheme: UiTheme): void {
  if (uiTheme === "liquid-glass") {
    document.documentElement.removeAttribute("data-ui-theme");
  } else {
    document.documentElement.setAttribute("data-ui-theme", uiTheme);
  }
  localStorage.setItem("glimpse-ui-theme", uiTheme);
  document.querySelectorAll<HTMLButtonElement>("[data-ui-theme-choice]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.uiThemeChoice === uiTheme);
  });
  const settingsView = document.querySelector("#settings-view");
  if (settingsView && !settingsView.classList.contains("hidden")) {
    fitWindowToSettings().catch(() => {});
  }
  const welcomeView = document.querySelector("#welcome-view");
  if (welcomeView && !welcomeView.classList.contains("hidden")) {
    fitWindowToDock().catch(() => {});
  }
}

function applyTheme(theme: "dark" | "light"): void {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach((btn) => {
    btn.classList.toggle("primary-pill", btn.dataset.themeChoice === theme);
  });
}

async function switchToSettingsView(): Promise<void> {
  document.querySelector("#welcome-view")?.classList.add("hidden");
  document.querySelector("#editor-view")?.classList.add("hidden");
  document.querySelector("#recording-view")?.classList.add("hidden");
  document.querySelector("#shortcuts-view")?.classList.add("hidden");
  document.querySelector("#settings-view")?.classList.remove("hidden");
  try {
    await fitWindowToSettings();
    await appWindow.center();
  } catch (e) {
    console.error("resize to settings failed", e);
  }
}

let recTimerInterval: number | undefined;
let recSeconds = 0;
let recPaused = false;

function formatDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

async function startVideoRecordingFlow(): Promise<void> {
  document.querySelector("#welcome-view")?.classList.add("hidden");
  document.querySelector("#editor-view")?.classList.add("hidden");
  document.querySelector("#recording-view")?.classList.remove("hidden");

  const timerEl = document.querySelector<HTMLSpanElement>("#rec-timer");
  const dotEl = document.querySelector<HTMLSpanElement>("#rec-dot");
  recSeconds = 0;
  recPaused = false;
  dotEl?.classList.remove("paused");
  if (timerEl) timerEl.textContent = "00:00";

  try {
    await appWindow.setSize(new LogicalSize(310, 76));
    await appWindow.setAlwaysOnTop(true);
  } catch (e) {
    console.error("resize to recording capsule failed", e);
  }

  try {
    await invoke<string>("start_recording", {
      options: {
        region: null,
        include_cursor: true,
        record_system_audio: true,
        record_mic: false,
      },
    });

    window.clearInterval(recTimerInterval);
    recTimerInterval = window.setInterval(() => {
      if (!recPaused) {
        recSeconds++;
        if (timerEl) timerEl.textContent = formatDuration(recSeconds);
      }
    }, 1000);
  } catch (e) {
    showToast(`${t("toast.videoError")} : ${String(e)}`, true);
    await appWindow.setAlwaysOnTop((currentSettings as { always_on_top?: boolean }).always_on_top ?? true).catch(() => {});
    await switchToDockView();
  }
}

function moveLiquidBlobTo(targetBtn: HTMLElement): void {
  const blob = document.querySelector<HTMLDivElement>("#liquid-blob");
  if (!blob) return;
  const x = targetBtn.offsetLeft - 8;
  blob.style.setProperty("--blob-x", `translateX(${x}px)`);
  blob.style.transform = `translateX(${x}px)`;
  blob.style.width = `${targetBtn.offsetWidth}px`;
  blob.classList.add("splashing");
  window.setTimeout(() => blob.classList.remove("splashing"), 240);
}

window.addEventListener("DOMContentLoaded", () => {
  window.requestAnimationFrame(() => {
    fitWindowToDock().catch((error) => console.error("dock resize failed", error));
  });
  editor = new AnnotationEditor(showToast);

  // Frameless window resize handles for Editor
  document.querySelectorAll<HTMLElement>("[data-resize-dir]").forEach((el) => {
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const dir = el.dataset.resizeDir as
        | "North"
        | "South"
        | "East"
        | "West"
        | "NorthWest"
        | "NorthEast"
        | "SouthWest"
        | "SouthEast";
      if (dir) {
        appWindow.startResizeDragging(dir).catch(() => {});
      }
    });
  });

  // Keep dock inside screen bounds (debounced after drag ends so it never fights the cursor)
  appWindow.onMoved(({ payload }) => {
    const welcome = document.querySelector("#welcome-view");
    if (!welcome || welcome.classList.contains("hidden")) return;
    lastDockPos = { x: payload.x, y: payload.y };
    window.clearTimeout(clampTimer);
    clampTimer = window.setTimeout(async () => {
      try {
        const mon = await currentMonitor();
        const size = await appWindow.outerSize();
        if (!mon) return;
        const minX = mon.position.x;
        const minY = mon.position.y;
        const maxX = mon.position.x + mon.size.width - size.width;
        const maxY = mon.position.y + mon.size.height - size.height;
        const cx = Math.max(minX, Math.min(maxX, payload.x));
        const cy = Math.max(minY, Math.min(maxY, payload.y));
        lastDockPos = { x: cx, y: cy };
        if (cx !== payload.x || cy !== payload.y) {
          await appWindow.setPosition(new PhysicalPosition(cx, cy));
        }
      } catch {
        // ignore monitor query errors
      }
    }, 120);
  });

  const closeWindow = () => {
    appWindow.close().catch((e) => console.error("close failed", e));
  };
  document.querySelector("#btn-minimize")?.addEventListener("click", () => {
    appWindow.minimize().catch((e) => console.error("minimize failed", e));
  });
  document.querySelector("#btn-maximize")?.addEventListener("click", async () => {
    try {
      await appWindow.toggleMaximize();
      window.setTimeout(() => editor?.fitCanvasToStage(), 80);
    } catch (e) {
      console.error("maximize failed", e);
    }
  });
  document.querySelector("#btn-close")?.addEventListener("click", closeWindow);
  document.querySelector("#btn-dock-close")?.addEventListener("click", closeWindow);
  document.querySelector("#btn-back-dock")?.addEventListener("click", () => {
    switchToDockView();
  });

  let appendMode = false;
  let addPhotoMode = false;
  const triggerCapture = () => {
    appendMode = false;
    addPhotoMode = false;
    invoke("request_capture").catch((e) => showToast(String(e), true));
  };
  const triggerAddPhotoCapture = () => {
    appendMode = false;
    addPhotoMode = true;
    invoke("request_capture").catch((e) => {
      addPhotoMode = false;
      showToast(String(e), true);
    });
  };
  const triggerAppendCapture = () => {
    appendMode = true;
    addPhotoMode = false;
    invoke("request_capture").catch((e) => {
      appendMode = false;
      showToast(String(e), true);
    });
  };
  document.querySelector("#btn-capture")?.addEventListener("click", triggerCapture);
  document.querySelector("#btn-new-snip")?.addEventListener("click", triggerCapture);
  document.querySelector("#btn-add-photo")?.addEventListener("click", triggerAddPhotoCapture);
  document.querySelector("#btn-add-capture")?.addEventListener("click", triggerAppendCapture);
  document.querySelector("#btn-layer-add-capture")?.addEventListener("click", triggerAppendCapture);

  // Mac-style dock navigation items with liquid morphing blob on click
  const dockItems = document.querySelectorAll<HTMLButtonElement>(".dock-item");
  const initialActive = document.querySelector<HTMLButtonElement>(".dock-item.active");
  if (initialActive) {
    requestAnimationFrame(() => {
      const blob = document.querySelector<HTMLDivElement>("#liquid-blob");
      if (!blob) return;
      const x = initialActive.offsetLeft - 8;
      blob.style.setProperty("--blob-x", `translateX(${x}px)`);
      blob.style.transform = `translateX(${x}px)`;
      blob.style.width = `${initialActive.offsetWidth}px`;
    });
  }
  dockItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      dockItems.forEach((el) => el.classList.remove("active"));
      btn.classList.add("active");
      moveLiquidBlobTo(btn);

      const nav = btn.dataset.nav;
      if (nav === "capture") {
        window.setTimeout(triggerCapture, 160);
      } else if (nav === "editor") {
        if (editor?.hasImage()) {
          window.setTimeout(() => {
            switchToEditorView();
            editor?.setEditorToolsOpen(true);
          }, 160);
        } else {
          showToast(t("toast.takeCaptureFirst"));
          window.setTimeout(triggerCapture, 220);
        }
      } else if (nav === "record") {
        window.setTimeout(() => startVideoRecordingFlow(), 160);
      } else if (nav === "shortcut") {
        window.setTimeout(() => switchToSettingsView(), 160);
      }
    });
  });

  listen<[number, number]>("capture-copied", async (e) => {
    const [w, h] = e.payload;
    const isAppend = appendMode;
    const isAddPhoto = addPhotoMode;
    appendMode = false;
    addPhotoMode = false;
    const autoOpenTools = Boolean(
      (currentSettings as { open_editor_after_capture?: boolean }).open_editor_after_capture,
    );
    await switchToEditorView();
    editor?.setEditorToolsOpen(autoOpenTools);
    try {
      if (isAppend && editor?.hasImage()) {
        await editor.appendFromBackend();
        showToast(`${t("toast.captureAppended")} (+${w} × ${h})`);
      } else {
        await editor?.loadFromBackend(!isAddPhoto);
        showToast(`${t("toast.captureCopied")}  ${w} × ${h}`);
      }
    } catch (err) {
      showToast(`${t("toast.editorLoadError")} : ${String(err)}`, true);
    }
  });

  listen<{ count: number }>("scrolling-started", async (e) => {
    document.querySelector("#welcome-view")?.classList.add("hidden");
    document.querySelector("#editor-view")?.classList.add("hidden");
    document.querySelector("#settings-view")?.classList.add("hidden");
    document.querySelector("#recording-view")?.classList.add("hidden");
    document.querySelector("#scrolling-view")?.classList.remove("hidden");
    const lbl = document.querySelector<HTMLSpanElement>("#scroll-count-label");
    if (lbl) lbl.textContent = `Défilez… · ${e.payload.count}`;
    try {
      await appWindow.setSize(new LogicalSize(340, 76));
      await appWindow.setAlwaysOnTop(true);
    } catch {
      // ignore
    }
  });

  listen<{ count: number }>("scrolling-step", (e) => {
    const lbl = document.querySelector<HTMLSpanElement>("#scroll-count-label");
    if (lbl) lbl.textContent = `${t("scroll.scrolling")} · ${e.payload.count}`;
  });

  document.querySelector("#btn-scroll-finish")?.addEventListener("click", async () => {
    document.querySelector("#scrolling-view")?.classList.add("hidden");
    try {
      await invoke("finish_scrolling_capture");
    } catch (e) {
      showToast(String(e), true);
      await switchToDockView();
    }
  });

  document.querySelector("#btn-scroll-cancel")?.addEventListener("click", async () => {
    document.querySelector("#scrolling-view")?.classList.add("hidden");
    await invoke("cancel_scrolling_capture").catch(() => {});
    await switchToDockView();
  });

  listen<string>("capture-error", (e) => showToast(`${t("common.error")} : ${e.payload}`, true));

  document.querySelector("#btn-rec-pause")?.addEventListener("click", async () => {
    try {
      recPaused = await invoke<boolean>("pause_recording");
      document.querySelector("#rec-dot")?.classList.toggle("paused", recPaused);
    } catch (e) {
      showToast(String(e), true);
    }
  });

  document.querySelector("#btn-rec-stop")?.addEventListener("click", async () => {
    window.clearInterval(recTimerInterval);
    try {
      await invoke<string | null>("stop_recording");
    } catch (e) {
      showToast(String(e), true);
    }
    await appWindow.setAlwaysOnTop((currentSettings as { always_on_top?: boolean }).always_on_top ?? true).catch(() => {});
    await switchToDockView();
  });

  listen<string>("recording-finished", async (e) => {
    window.clearInterval(recTimerInterval);
    await appWindow.setAlwaysOnTop((currentSettings as { always_on_top?: boolean }).always_on_top ?? true).catch(() => {});
    await switchToDockView();
    showToast(t("toast.videoSaved"));
    invoke("open_recording_folder", { path: e.payload }).catch(() => {});
  });

  listen<string>("recording-error", async (e) => {
    window.clearInterval(recTimerInterval);
    await appWindow.setAlwaysOnTop((currentSettings as { always_on_top?: boolean }).always_on_top ?? true).catch(() => {});
    await switchToDockView();
    showToast(`${t("toast.recError")} : ${e.payload}`, true);
  });

  // Load saved settings (theme + startup + video folder)
  const updateVideoDirLabel = (dir: string | null) => {
    const el = document.querySelector<HTMLSpanElement>("#video-dir-label");
    if (el) {
      el.textContent = dir && dir.trim() ? dir : t("settings.videoDirDefault", "Vidéos\\Glimpse (par défaut)");
      el.title = el.textContent;
    }
  };

  const applyGlassOpacity = (pct: number) => {
    const clamped = Math.max(25, Math.min(100, pct));
    document.documentElement.style.setProperty("--glass-opacity", String(clamped / 100));
    const lbl = document.querySelector<HTMLSpanElement>("#opacity-value-label");
    if (lbl) lbl.textContent = `${clamped}%`;
    const slider = document.querySelector<HTMLInputElement>("#slider-opacity");
    if (slider) {
      slider.value = String(clamped);
      slider.style.setProperty("--slider-pct", `${((clamped - 25) / 75) * 100}%`);
    }
  };

  // Sync --slider-pct for all Apple Liquid Glass range sliders
  document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((range) => {
    const syncPct = () => {
      const min = Number(range.min || 0);
      const max = Number(range.max || 100);
      const val = Number(range.value || 0);
      const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
      range.style.setProperty("--slider-pct", `${pct}%`);
    };
    syncPct();
    range.addEventListener("input", syncPct);
  });

  const applyDockItems = (items: string[]) => {
    const allowed = new Set(items);
    document.querySelectorAll<HTMLButtonElement>(".dock-item[data-nav]").forEach((btn) => {
      const nav = btn.dataset.nav ?? "";
      if (nav === "shortcut") return; // Keep Réglages always accessible
      btn.classList.toggle("hidden-item", !allowed.has(nav));
    });
    document.querySelectorAll<HTMLButtonElement>(".dock-preview-pill[data-dock-toggle]").forEach((pill) => {
      const key = pill.dataset.dockToggle ?? "";
      const on = allowed.has(key);
      pill.classList.toggle("active", on);
      pill.classList.toggle("off", !on);
    });
    const visibleActive =
      document.querySelector<HTMLButtonElement>(".dock-item.active:not(.hidden-item)") ??
      document.querySelector<HTMLButtonElement>(".dock-item:not(.hidden-item)");
    if (visibleActive) {
      document.querySelectorAll<HTMLButtonElement>(".dock-item").forEach((b) => b.classList.remove("active"));
      visibleActive.classList.add("active");
      requestAnimationFrame(() => {
        const blob = document.querySelector<HTMLDivElement>("#liquid-blob");
        if (!blob) return;
        const x = visibleActive.offsetLeft - 8;
        blob.style.setProperty("--blob-x", `translateX(${x}px)`);
        blob.style.transform = `translateX(${x}px)`;
        blob.style.width = `${visibleActive.offsetWidth}px`;
      });
    }
  };

  const syncLangUI = (lang: string) => {
    const trigger = document.querySelector<HTMLButtonElement>("#btn-lang-menu");
    const activeOpt = document.querySelector<HTMLButtonElement>(`.lang-option[data-lang="${lang}"]`);
    document.querySelectorAll<HTMLButtonElement>(".lang-option").forEach((opt) => {
      opt.classList.toggle("active", opt.dataset.lang === lang);
    });
    if (trigger && activeOpt) {
      const label = activeOpt.querySelector("span")?.textContent ?? lang.toUpperCase();
      trigger.textContent = `${label} ▾`;
    }
  };

  const DEFAULT_SHORTCUTS: Record<string, string> = {
    capture: "Ctrl+Shift+S",
    newPhoto: "Ctrl+Shift+N",
    copy: "Ctrl+C",
    save: "Ctrl+S",
    undo: "Ctrl+Z",
    redo: "Ctrl+Y",
    select: "V",
    pen: "P",
    highlighter: "H",
    line: "L",
    arrow: "A",
    rect: "R",
    text: "T",
    emoji: "E",
    step: "N",
    blur: "B",
    eraser: "G",
    crop: "C",
    ocr: "O",
  };

  const SHORTCUT_LABELS: [string, string][] = [
    ["capture", "Capture"],
    ["newPhoto", "Nouvelle photo"],
    ["copy", "Copier"],
    ["save", "Enregistrer"],
    ["undo", "Annuler"],
    ["redo", "Rétablir"],
    ["select", "Sélecteur"],
    ["pen", "Stylo"],
    ["highlighter", "Surligneur"],
    ["line", "Ligne"],
    ["arrow", "Flèche"],
    ["rect", "Rectangle"],
    ["text", "Texte"],
    ["emoji", "Emoji"],
    ["step", "Pastilles"],
    ["blur", "Floutage"],
    ["eraser", "Gomme"],
    ["crop", "Recadrer"],
    ["ocr", "OCR"],
  ];

  const renderShortcutsList = (map: Record<string, string>) => {
    const listEl = document.querySelector<HTMLDivElement>("#shortcuts-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    for (const [key, label] of SHORTCUT_LABELS) {
      const row = document.createElement("div");
      row.className = "shortcut-item";
      const lbl = document.createElement("span");
      lbl.textContent = t(`shortcut.action.${key}`, label);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "shortcut-key-btn";
      btn.textContent = map[key] || DEFAULT_SHORTCUTS[key];
      btn.title = t("shortcuts.keyTip", "Cliquer puis appuyer sur une touche");
      btn.addEventListener("click", () => {
        document.querySelectorAll(".shortcut-key-btn.recording").forEach((el) => el.classList.remove("recording"));
        btn.classList.add("recording");
        btn.textContent = t("shortcuts.keyPrompt", "Touche…");
        const onKey = (ke: KeyboardEvent) => {
          ke.preventDefault();
          ke.stopPropagation();
          if (["Control", "Shift", "Alt", "Meta"].includes(ke.key)) return;
          if (ke.key === "Escape") {
            btn.classList.remove("recording");
            btn.textContent = map[key] || DEFAULT_SHORTCUTS[key];
            window.removeEventListener("keydown", onKey, true);
            return;
          }
          const parts: string[] = [];
          if (ke.ctrlKey || ke.metaKey) parts.push("Ctrl");
          if (ke.shiftKey) parts.push("Shift");
          if (ke.altKey) parts.push("Alt");
          parts.push(ke.key.length === 1 ? ke.key.toUpperCase() : ke.key);
          const combo = parts.join("+");
          map[key] = combo;
          (currentSettings as AppSettings & { shortcuts: Record<string, string> }).shortcuts = { ...map };
          editor?.setShortcuts(map);
          btn.classList.remove("recording");
          btn.textContent = combo;
          window.removeEventListener("keydown", onKey, true);
          invoke("save_settings", { settings: currentSettings }).catch(() => {});
        };
        window.addEventListener("keydown", onKey, true);
      });
      row.appendChild(lbl);
      row.appendChild(btn);
      listEl.appendChild(row);
    }
  };

  document.querySelector("#btn-open-shortcuts")?.addEventListener("click", async () => {
    document.querySelector("#settings-view")?.classList.add("hidden");
    document.querySelector("#shortcuts-view")?.classList.remove("hidden");
    const scMap = (currentSettings as AppSettings & { shortcuts?: Record<string, string> }).shortcuts ?? DEFAULT_SHORTCUTS;
    renderShortcutsList(scMap);
    await appWindow.setSize(new LogicalSize(480, 520)).catch(() => {});
  });
  const backToSettings = async () => {
    document.querySelector("#shortcuts-view")?.classList.add("hidden");
    document.querySelector("#settings-view")?.classList.remove("hidden");
    await fitWindowToSettings().catch(() => {});
  };
  document.querySelector("#btn-close-shortcuts")?.addEventListener("click", backToSettings);
  document.querySelector("#btn-shortcuts-done")?.addEventListener("click", backToSettings);
  document.querySelector("#btn-reset-shortcuts")?.addEventListener("click", () => {
    const resetMap = { ...DEFAULT_SHORTCUTS };
    (currentSettings as AppSettings & { shortcuts: Record<string, string> }).shortcuts = resetMap;
    editor?.setShortcuts(resetMap);
    renderShortcutsList(resetMap);
    invoke("save_settings", { settings: currentSettings }).catch(() => {});
    showToast(t("toast.shortcutsReset"));
  });

  invoke<
    AppSettings & {
      glass_opacity?: number;
      always_on_top?: boolean;
      dock_items?: string[];
      language?: string;
      open_editor_after_capture?: boolean;
      shortcuts?: Record<string, string>;
    }
  >("get_settings")
    .then((s) => {
      currentSettings = s;
      applyTheme(s.theme);
      applyGlassOpacity(s.glass_opacity ?? 85);
      applyDockItems(s.dock_items ?? ["capture", "record"]);
      const lang = s.language ?? "fr";
      applyLanguage(lang);
      syncLangUI(lang);
      updateVideoDirLabel(s.video_dir);
      const toggle = document.querySelector<HTMLInputElement>("#toggle-startup");
      if (toggle) toggle.checked = s.launch_on_startup;
      const onTop = s.always_on_top ?? true;
      const onTopToggle = document.querySelector<HTMLInputElement>("#toggle-always-on-top");
      if (onTopToggle) onTopToggle.checked = onTop;
      const autoEdToggle = document.querySelector<HTMLInputElement>("#toggle-open-editor");
      if (autoEdToggle) autoEdToggle.checked = s.open_editor_after_capture ?? false;
      const shortcutMap = { ...DEFAULT_SHORTCUTS, ...(s.shortcuts ?? {}) };
      editor?.setShortcuts(shortcutMap);
      renderShortcutsList(shortcutMap);
      appWindow.setAlwaysOnTop(onTop).catch(() => {});
    })
    .catch(() => {});

  const langBtn = document.querySelector<HTMLButtonElement>("#btn-lang-menu");
  const langMenu = document.querySelector<HTMLDivElement>("#lang-menu");
  langBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    langMenu?.classList.toggle("hidden");
  });
  document.querySelectorAll<HTMLButtonElement>(".lang-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      const lang = opt.dataset.lang ?? "fr";
      (currentSettings as AppSettings & { language: string }).language = lang;
      applyLanguage(lang);
      syncLangUI(lang);
      updateVideoDirLabel(currentSettings.video_dir);
      const scMap = (currentSettings as AppSettings & { shortcuts?: Record<string, string> }).shortcuts ?? DEFAULT_SHORTCUTS;
      renderShortcutsList(scMap);
      editor?.refreshI18n();
      langMenu?.classList.add("hidden");
      invoke("save_settings", { settings: currentSettings }).catch(() => {});
    });
  });
  document.addEventListener("click", (e) => {
    if (!langMenu || langMenu.classList.contains("hidden")) return;
    if (!(e.target as HTMLElement)?.closest("#lang-dropdown")) {
      langMenu.classList.add("hidden");
    }
  });

  document.querySelectorAll<HTMLButtonElement>(".dock-preview-pill[data-dock-toggle]").forEach((pill) => {
    pill.addEventListener("click", () => {
      const key = pill.dataset.dockToggle;
      if (!key) return;
      const s = currentSettings as AppSettings & { dock_items?: string[] };
      const list = new Set(s.dock_items ?? ["capture", "record"]);
      if (list.has(key)) {
        list.delete(key);
      } else {
        list.add(key);
      }
      const next = ["capture", "record"].filter((k) => list.has(k));
      s.dock_items = next;
      applyDockItems(next);
      invoke("save_settings", { settings: currentSettings }).catch(() => {});
    });
  });

  const onTopToggle = document.querySelector<HTMLInputElement>("#toggle-always-on-top");
  onTopToggle?.addEventListener("change", () => {
    const enabled = onTopToggle.checked;
    (currentSettings as AppSettings & { always_on_top: boolean }).always_on_top = enabled;
    appWindow.setAlwaysOnTop(enabled).catch(() => {});
    invoke("save_settings", { settings: currentSettings }).catch(() => {});
  });

  const autoEdToggle = document.querySelector<HTMLInputElement>("#toggle-open-editor");
  autoEdToggle?.addEventListener("change", () => {
    const enabled = autoEdToggle.checked;
    (currentSettings as AppSettings & { open_editor_after_capture: boolean }).open_editor_after_capture = enabled;
    invoke("save_settings", { settings: currentSettings }).catch(() => {});
  });

  const opacitySlider = document.querySelector<HTMLInputElement>("#slider-opacity");
  opacitySlider?.addEventListener("input", () => {
    applyGlassOpacity(Number(opacitySlider.value));
  });
  opacitySlider?.addEventListener("change", () => {
    const val = Number(opacitySlider.value);
    (currentSettings as AppSettings & { glass_opacity: number }).glass_opacity = val;
    invoke("save_settings", { settings: currentSettings }).catch(() => {});
  });

  document.querySelector("#btn-pick-video-dir")?.addEventListener("click", async () => {
    try {
      const picked = await invoke<string | null>("pick_video_folder");
      if (picked) {
        currentSettings.video_dir = picked;
        updateVideoDirLabel(picked);
        await invoke("save_settings", { settings: currentSettings });
        showToast(t("toast.videoDirSaved"));
      }
    } catch (e) {
      showToast(String(e), true);
    }
  });

  const savedUiTheme = (localStorage.getItem("glimpse-ui-theme") as UiTheme) || "liquid-glass";
  applyUiTheme(savedUiTheme);
  document.querySelectorAll<HTMLButtonElement>("[data-ui-theme-choice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const uiTheme = (btn.dataset.uiThemeChoice as UiTheme) || "liquid-glass";
      applyUiTheme(uiTheme);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const theme = (btn.dataset.themeChoice as "dark" | "light") || "dark";
      currentSettings.theme = theme;
      applyTheme(theme);
      try {
        await invoke("save_settings", { settings: currentSettings });
      } catch (e) {
        showToast(String(e), true);
      }
    });
  });

  document.querySelector<HTMLInputElement>("#toggle-startup")?.addEventListener("change", async (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    currentSettings.launch_on_startup = checked;
    try {
      await invoke("save_settings", { settings: currentSettings });
      showToast(checked ? t("toast.startupEnabled") : t("toast.startupDisabled"));
    } catch (err) {
      showToast(String(err), true);
    }
  });

  document.querySelector("#btn-open-videos")?.addEventListener("click", () => {
    invoke("open_videos_dir").catch((e) => showToast(String(e), true));
  });
  document.querySelector("#btn-settings-back")?.addEventListener("click", () => switchToDockView());
  document.querySelector("#btn-settings-done")?.addEventListener("click", () => switchToDockView());
});
