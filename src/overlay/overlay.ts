// overlay.ts — supports 4 capture modes on the frozen screenshot:
// 1. Rectangle (drag box)
// 2. Freeform / Lasso (draw irregular outline -> transparent PNG cutout)
// 3. Window (choose from the Open Applications list OR hover & click a window on screen)
// 4. Screen (choose which monitor to capture in full OR switch the overlay to another monitor)

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { applyLanguage, t } from "../i18n";

type CaptureMode = "rect" | "freeform" | "window" | "screen" | "scroll";

interface WindowRect {
  id: number;
  app_name: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  on_current_monitor: boolean;
  is_minimized: boolean;
}

interface MonitorSummary {
  id: number;
  name: string;
  width: number;
  height: number;
  is_primary: boolean;
  is_current: boolean;
}

interface CaptureInfo {
  width: number;
  height: number;
  windows: WindowRect[];
  monitors: MonitorSummary[];
}

interface Point {
  x: number;
  y: number;
}

const shot = document.querySelector<HTMLCanvasElement>("#shot")!;
const mask = document.querySelector<HTMLCanvasElement>("#mask")!;
const sizeLabel = document.querySelector<HTMLDivElement>("#size-label")!;
const topWrap = document.querySelector<HTMLDivElement>("#overlay-top-wrap")!;
const modeBar = document.querySelector<HTMLDivElement>("#mode-bar")!;
const overlayBlob = document.querySelector<HTMLDivElement>("#overlay-liquid-blob")!;
const pickerPanel = document.querySelector<HTMLDivElement>("#picker-panel")!;
const pickerTitle = document.querySelector<HTMLDivElement>("#picker-title")!;
const pickerList = document.querySelector<HTMLDivElement>("#picker-list")!;
const maskCtx = mask.getContext("2d")!;

const css = getComputedStyle(document.documentElement);
const DIM = css.getPropertyValue("--overlay-dim").trim();
let BORDER = css.getPropertyValue("--accent").trim();

function syncOverlayUiTheme(): void {
  const uiTheme = localStorage.getItem("glimpse-ui-theme") || "liquid-glass";
  if (uiTheme === "liquid-glass") {
    document.documentElement.removeAttribute("data-ui-theme");
  } else {
    document.documentElement.setAttribute("data-ui-theme", uiTheme);
  }
  BORDER = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#0a84ff";
}
syncOverlayUiTheme();
window.addEventListener("storage", syncOverlayUiTheme);
window.addEventListener("focus", syncOverlayUiTheme);

let imgW = 0;
let imgH = 0;
let windows: WindowRect[] = [];
let monitors: MonitorSummary[] = [];
let mode: CaptureMode = "rect";

// Rectangle state
let start: Point | null = null;
let current: Point | null = null;

// Freeform lasso state (in CSS coordinates)
let lassoPoints: Point[] = [];
let isDrawingLasso = false;

// Window hover state
let hoveredWindow: WindowRect | null = null;

async function init(): Promise<void> {
  try {
    try {
      const s = await invoke<{ language?: string }>("get_settings").catch(() => null);
      if (s?.language) {
        applyLanguage(s.language);
      }
    } catch {
      // ignore
    }

    const info = await invoke<CaptureInfo>("get_capture_info");
    const buffer = await invoke<ArrayBuffer>("get_capture_pixels");
    imgW = info.width;
    imgH = info.height;
    windows = info.windows || [];
    monitors = info.monitors || [];

    shot.width = imgW;
    shot.height = imgH;
    const data = new ImageData(new Uint8ClampedArray(buffer), imgW, imgH);
    shot.getContext("2d")!.putImageData(data, 0, 0);

    resizeMask();
    drawMask();
    bindModeBar();

    const win = getCurrentWindow();
    await win.show();
    await win.setFocus();

    const activeBtn = document.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`);
    if (activeBtn) {
      moveOverlayBlobTo(activeBtn, false);
    }
  } catch (e) {
    console.error("overlay init failed", e);
    cancel();
  }
}

function bindModeBar(): void {
  topWrap.addEventListener("mousedown", (e) => e.stopPropagation());
  topWrap.addEventListener("mouseup", (e) => e.stopPropagation());
  topWrap.addEventListener("mousemove", (e) => e.stopPropagation());

  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setMode(btn.dataset.mode as CaptureMode);
    });
  });

  document.querySelector("#btn-cancel")?.addEventListener("click", () => {
    cancel();
  });
}

function moveOverlayBlobTo(targetBtn: HTMLElement, animate = true): void {
  if (!modeBar || !overlayBlob) return;
  const barRect = modeBar.getBoundingClientRect();
  const btnRect = targetBtn.getBoundingClientRect();
  if (barRect.width === 0 || btnRect.width === 0) return;

  const offsetX = btnRect.left - barRect.left;
  overlayBlob.style.width = `${btnRect.width}px`;
  overlayBlob.style.setProperty("--blob-x", `translateX(${offsetX}px)`);
  overlayBlob.style.transform = `translateX(${offsetX}px)`;

  if (animate) {
    overlayBlob.classList.add("splashing");
    window.setTimeout(() => {
      overlayBlob.classList.remove("splashing");
    }, 220);
  }
}

function setMode(newMode: CaptureMode): void {
  mode = newMode;
  start = null;
  current = null;
  lassoPoints = [];
  isDrawingLasso = false;
  hoveredWindow = null;

  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
    const isTarget = btn.dataset.mode === newMode;
    btn.classList.toggle("active", isTarget);
    if (isTarget) {
      moveOverlayBlobTo(btn, true);
    }
  });

  if (newMode === "window" || newMode === "scroll") {
    document.body.style.cursor = newMode === "window" ? "pointer" : "crosshair";
    renderWindowPicker();
    pickerPanel.classList.remove("hidden");
  } else if (newMode === "screen") {
    document.body.style.cursor = "default";
    renderScreenPicker();
    pickerPanel.classList.remove("hidden");
  } else {
    document.body.style.cursor = "crosshair";
    pickerPanel.classList.add("hidden");
  }
  drawMask();
}

function renderWindowPicker(): void {
  pickerTitle.textContent =
    mode === "scroll"
      ? `${t("overlay.mode.scroll")} (${windows.length}) — ${t("overlay.picker.scrollDesc")}`
      : `${t("overlay.picker.openWindows")} (${windows.length}) — ${t("overlay.picker.openWindowsDesc")}`;
  pickerList.innerHTML = "";

  if (windows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "picker-sub";
    empty.textContent = t("overlay.picker.noWindow");
    pickerList.appendChild(empty);
    return;
  }

  for (const w of windows) {
    const row = document.createElement("div");
    row.className = "picker-item";

    const main = document.createElement("div");
    main.className = "picker-main";

    const name = document.createElement("div");
    name.className = "picker-name";
    name.textContent = w.app_name ? `${w.app_name} — ${w.title}` : w.title;

    const sub = document.createElement("div");
    sub.className = "picker-sub";
    let status = "";
    if (w.is_minimized) {
      status = ` · ${t("overlay.picker.inBackground")}`;
    } else if (!w.on_current_monitor) {
      status = ` · ${t("overlay.picker.otherScreen")}`;
    }
    sub.textContent = `${w.width} × ${w.height}${status}`;

    main.appendChild(name);
    main.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "picker-actions";
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "picker-pill primary";
    pill.textContent = t("overlay.picker.captureBtn");
    actions.appendChild(pill);

    row.appendChild(main);
    row.appendChild(actions);

    row.addEventListener("mouseenter", () => {
      if (w.on_current_monitor && !w.is_minimized) {
        hoveredWindow = w;
      } else {
        hoveredWindow = null;
      }
      drawMask();
    });

    row.addEventListener("click", () => {
      captureWindowById(w.id);
    });

    pickerList.appendChild(row);
  }
}

function renderScreenPicker(): void {
  pickerTitle.textContent = `${t("overlay.picker.screensDetected")} (${monitors.length}) — ${t("overlay.picker.screensDesc")}`;
  pickerList.innerHTML = "";

  for (const m of monitors) {
    const row = document.createElement("div");
    row.className = "picker-item";

    const main = document.createElement("div");
    main.className = "picker-main";

    const name = document.createElement("div");
    name.className = "picker-name";
    name.textContent = `${m.name}${m.is_current ? ` · ${t("overlay.picker.activeScreen")}` : ""}`;

    const sub = document.createElement("div");
    sub.className = "picker-sub";
    sub.textContent = `${m.width} × ${m.height}`;

    main.appendChild(name);
    main.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "picker-actions";

    if (!m.is_current) {
      const switchBtn = document.createElement("button");
      switchBtn.type = "button";
      switchBtn.className = "picker-pill";
      switchBtn.title = t("overlay.picker.zoneHereTitle");
      switchBtn.textContent = t("overlay.picker.zoneHere");
      switchBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        invoke("switch_capture_monitor", { monitorId: m.id }).catch((err) =>
          console.error(err),
        );
      });
      actions.appendChild(switchBtn);
    }

    const fullBtn = document.createElement("button");
    fullBtn.type = "button";
    fullBtn.className = "picker-pill primary";
    fullBtn.textContent = t("overlay.picker.fullscreen");
    actions.appendChild(fullBtn);

    row.appendChild(main);
    row.appendChild(actions);

    row.addEventListener("click", () => {
      captureMonitorById(m.id);
    });

    pickerList.appendChild(row);
  }
}

function resizeMask(): void {
  const dpr = window.devicePixelRatio || 1;
  mask.width = Math.round(window.innerWidth * dpr);
  mask.height = Math.round(window.innerHeight * dpr);
  maskCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function selectionRect(): { x: number; y: number; w: number; h: number } | null {
  if (!start || !current) return null;
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    w: Math.abs(current.x - start.x),
    h: Math.abs(current.y - start.y),
  };
}

function drawMask(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const sx = imgW / w;
  const sy = imgH / h;

  maskCtx.clearRect(0, 0, w, h);
  maskCtx.fillStyle = DIM;
  maskCtx.fillRect(0, 0, w, h);

  if (mode === "rect" || mode === "scroll") {
    const r = selectionRect();
    if (!r || r.w < 1 || r.h < 1) {
      sizeLabel.classList.add("hidden");
      return;
    }
    maskCtx.clearRect(r.x, r.y, r.w, r.h);
    maskCtx.strokeStyle = BORDER;
    maskCtx.lineWidth = 2;
    maskCtx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);

    sizeLabel.textContent = `${Math.round(r.w * sx)} × ${Math.round(r.h * sy)}`;
    sizeLabel.style.left = `${r.x}px`;
    sizeLabel.style.top = `${Math.max(4, r.y - 30)}px`;
    sizeLabel.classList.remove("hidden");
    return;
  }

  if (mode === "freeform") {
    if (lassoPoints.length < 2) {
      sizeLabel.classList.add("hidden");
      return;
    }
    maskCtx.save();
    maskCtx.beginPath();
    maskCtx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
    for (let i = 1; i < lassoPoints.length; i++) {
      maskCtx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
    }
    maskCtx.closePath();
    maskCtx.globalCompositeOperation = "destination-out";
    maskCtx.fill();
    maskCtx.restore();

    maskCtx.save();
    maskCtx.beginPath();
    maskCtx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
    for (let i = 1; i < lassoPoints.length; i++) {
      maskCtx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
    }
    maskCtx.closePath();
    maskCtx.strokeStyle = BORDER;
    maskCtx.lineWidth = 2;
    maskCtx.setLineDash([5, 4]);
    maskCtx.stroke();
    maskCtx.restore();

    const bounds = getLassoBoundsCss();
    if (bounds) {
      sizeLabel.textContent = `Forme libre · ${Math.round(bounds.w * sx)} × ${Math.round(bounds.h * sy)}`;
      sizeLabel.style.left = `${bounds.x}px`;
      sizeLabel.style.top = `${Math.max(4, bounds.y - 30)}px`;
      sizeLabel.classList.remove("hidden");
    }
    return;
  }

  if (mode === "window") {
    if (!hoveredWindow || !hoveredWindow.on_current_monitor) {
      sizeLabel.classList.add("hidden");
      return;
    }
    const rx = hoveredWindow.x / sx;
    const ry = hoveredWindow.y / sy;
    const rw = hoveredWindow.width / sx;
    const rh = hoveredWindow.height / sy;

    maskCtx.clearRect(rx, ry, rw, rh);
    maskCtx.strokeStyle = BORDER;
    maskCtx.lineWidth = 2.5;
    maskCtx.strokeRect(rx + 1, ry + 1, Math.max(0, rw - 2), Math.max(0, rh - 2));

    const shortTitle =
      hoveredWindow.title.length > 36
        ? `${hoveredWindow.title.slice(0, 36)}…`
        : hoveredWindow.title;
    sizeLabel.textContent = `${shortTitle} · ${hoveredWindow.width} × ${hoveredWindow.height}`;
    sizeLabel.style.left = `${Math.max(8, rx)}px`;
    sizeLabel.style.top = `${Math.max(8, ry - 32)}px`;
    sizeLabel.classList.remove("hidden");
    return;
  }

  sizeLabel.classList.add("hidden");
}

function getLassoBoundsCss(): { x: number; y: number; w: number; h: number } | null {
  if (lassoPoints.length < 3) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of lassoPoints) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function cancel(): void {
  invoke("cancel_capture").catch((e) => console.error(e));
}

async function captureWindowById(windowId: number): Promise<void> {
  topWrap.classList.add("hidden");
  try {
    if (mode === "scroll") {
      await invoke("start_scrolling_window", { windowId });
      return;
    }
    await invoke("capture_window_by_id", { windowId });
  } catch (e) {
    console.error("capture_window_by_id failed", e);
    cancel();
  }
}

async function captureMonitorById(monitorId: number): Promise<void> {
  topWrap.classList.add("hidden");
  try {
    await invoke("capture_monitor_by_id", { monitorId });
  } catch (e) {
    console.error("capture_monitor_by_id failed", e);
    cancel();
  }
}

async function finishRect(): Promise<void> {
  const r = selectionRect();
  start = null;
  current = null;
  if (!r || r.w < 4 || r.h < 4) {
    topWrap.classList.remove("hidden");
    drawMask();
    return;
  }
  const sx = imgW / window.innerWidth;
  const sy = imgH / window.innerHeight;
  const rx = Math.round(r.x * sx);
  const ry = Math.round(r.y * sy);
  const rw = Math.round(r.w * sx);
  const rh = Math.round(r.h * sy);
  try {
    if (mode === "scroll") {
      await invoke<number>("start_scrolling_capture", {
        x: rx,
        y: ry,
        width: rw,
        height: rh,
      });
      return;
    }
    await invoke("finish_capture", {
      region: { x: rx, y: ry, width: rw, height: rh },
    });
  } catch (e) {
    console.error("finish_capture failed", e);
    cancel();
  }
}

async function finishFreeform(): Promise<void> {
  const bounds = getLassoBoundsCss();
  if (!bounds || bounds.w < 8 || bounds.h < 8) {
    lassoPoints = [];
    topWrap.classList.remove("hidden");
    drawMask();
    return;
  }
  const sx = imgW / window.innerWidth;
  const sy = imgH / window.innerHeight;

  const bx = Math.max(0, Math.floor(bounds.x * sx));
  const by = Math.max(0, Math.floor(bounds.y * sy));
  const bw = Math.min(imgW - bx, Math.max(1, Math.round(bounds.w * sx)));
  const bh = Math.min(imgH - by, Math.max(1, Math.round(bounds.h * sy)));

  const off = document.createElement("canvas");
  off.width = bw;
  off.height = bh;
  const offCtx = off.getContext("2d")!;

  offCtx.beginPath();
  offCtx.moveTo(lassoPoints[0].x * sx - bx, lassoPoints[0].y * sy - by);
  for (let i = 1; i < lassoPoints.length; i++) {
    offCtx.lineTo(lassoPoints[i].x * sx - bx, lassoPoints[i].y * sy - by);
  }
  offCtx.closePath();
  offCtx.clip();
  offCtx.drawImage(shot, bx, by, bw, bh, 0, 0, bw, bh);

  const rgba = Array.from(offCtx.getImageData(0, 0, bw, bh).data);
  try {
    await invoke("finish_freeform_capture", {
      width: bw,
      height: bh,
      rgba,
    });
  } catch (e) {
    console.error("finish_freeform_capture failed", e);
    cancel();
  }
}

window.addEventListener("mousedown", (e) => {
  if (e.button === 2) {
    cancel();
    return;
  }
  if (e.button !== 0) return;

  if (mode === "window") {
    if (hoveredWindow) {
      captureWindowById(hoveredWindow.id);
    }
    return;
  }

  if (mode === "screen") {
    return;
  }

  topWrap.classList.add("hidden");
  if (mode === "rect" || mode === "scroll") {
    start = { x: e.clientX, y: e.clientY };
    current = { ...start };
    drawMask();
  } else if (mode === "freeform") {
    isDrawingLasso = true;
    lassoPoints = [{ x: e.clientX, y: e.clientY }];
    drawMask();
  }
});

window.addEventListener("mousemove", (e) => {
  if (mode === "rect" || mode === "scroll") {
    if (!start) return;
    current = { x: e.clientX, y: e.clientY };
    requestAnimationFrame(drawMask);
    return;
  }

  if (mode === "freeform") {
    if (!isDrawingLasso) return;
    lassoPoints.push({ x: e.clientX, y: e.clientY });
    requestAnimationFrame(drawMask);
    return;
  }

  if (mode === "window") {
    const sx = imgW / window.innerWidth;
    const sy = imgH / window.innerHeight;
    const px = e.clientX * sx;
    const py = e.clientY * sy;
    const found =
      windows.find(
        (w) =>
          w.on_current_monitor &&
          px >= w.x &&
          px <= w.x + w.width &&
          py >= w.y &&
          py <= w.y + w.height,
      ) ?? null;
    if (found !== hoveredWindow) {
      hoveredWindow = found;
      requestAnimationFrame(drawMask);
    }
  }
});

window.addEventListener("mouseup", (e) => {
  if (e.button !== 0) return;
  if ((mode === "rect" || mode === "scroll") && start) {
    finishRect();
  } else if (mode === "freeform" && isDrawingLasso) {
    isDrawingLasso = false;
    finishFreeform();
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    cancel();
  } else if (e.key === "1") {
    setMode("rect");
  } else if (e.key === "2") {
    setMode("freeform");
  } else if (e.key === "3") {
    setMode("window");
  } else if (e.key === "4") {
    setMode("screen");
  } else if (e.key === "5") {
    setMode("scroll");
  }
});

window.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("resize", () => {
  resizeMask();
  drawMask();
});

init();
