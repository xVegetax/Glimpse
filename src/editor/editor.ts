// editor.ts — Liquid Glass annotation editor engine:
// - Non-destructive vector items + pixelation blur + undoable crop
// - Corner-handle resizing & dragging for Emojis and Text
// - Floating Layers panel (select, bring forward ↑, send backward ↓, delete 🗑)
// - Movable Text widget with integrated Font / Color / Size bar

import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";

export type ToolKind =
  | "select"
  | "pen"
  | "highlighter"
  | "line"
  | "arrow"
  | "rect"
  | "circle"
  | "triangle"
  | "text"
  | "emoji"
  | "step"
  | "blur"
  | "eraser"
  | "crop";

interface Point {
  x: number;
  y: number;
}

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EraserPath {
  points: Point[];
  size: number;
}

interface BaseItem {
  name?: string;
  erased?: EraserPath[];
}

export type AnnotationItem =
  | (BaseItem & { kind: "pen"; points: Point[]; color: string; size: number })
  | (BaseItem & { kind: "highlighter"; points: Point[]; color: string; size: number })
  | (BaseItem & { kind: "line"; start: Point; end: Point; color: string; size: number })
  | (BaseItem & { kind: "arrow"; start: Point; end: Point; color: string; size: number })
  | (BaseItem & { kind: "rect"; start: Point; end: Point; color: string; size: number })
  | (BaseItem & { kind: "circle"; start: Point; end: Point; color: string; size: number })
  | (BaseItem & { kind: "triangle"; start: Point; end: Point; color: string; size: number })
  | (BaseItem & {
      kind: "text";
      pos: Point;
      text: string;
      color: string;
      size: number;
      font: string;
    })
  | (BaseItem & { kind: "emoji"; pos: Point; emoji: string; size: number })
  | (BaseItem & {
      kind: "step";
      pos: Point;
      num: number;
      color: string;
      size: number;
    })
  | (BaseItem & { kind: "blur"; start: Point; end: Point; blockSize: number });

interface EditorSnapshot {
  base: ImageData;
  items: AnnotationItem[];
}

interface OcrWordBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OcrLineBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  words: OcrWordBox[];
}

interface OcrResponse {
  full_text: string;
  lines: OcrLineBox[];
}

// Tools that display the contextual size popover when clicked.
const SIZED_TOOLS = new Set<ToolKind>([
  "pen",
  "highlighter",
  "line",
  "arrow",
  "rect",
  "circle",
  "triangle",
  "step",
  "blur",
  "eraser",
]);

// User annotation palette (user data, not theme — see AGENTS.md section 3).
const USER_PALETTE = [
  "#ff453a",
  "#ff9f0a",
  "#ffd60a",
  "#30d158",
  "#0a84ff",
  "#bf5af2",
  "#ffffff",
  "#1c1c1e",
];

const EMOJI_LIST = ["👍", "❤️", "🔥", "✅", "⚠️", "❌", "🎯", "💡", "👀", "⭐"];
const DEFAULT_FONT = '"Segoe UI Variable", "Segoe UI", sans-serif';

export class AnnotationEditor {
  private baseCanvas = document.querySelector<HTMLCanvasElement>("#base-canvas")!;
  private annotCanvas = document.querySelector<HTMLCanvasElement>("#annot-canvas")!;
  private canvasBoard = document.querySelector<HTMLDivElement>("#canvas-board")!;
  private canvasViewport = document.querySelector<HTMLDivElement>("#canvas-viewport")!;
  private canvasPanZoom = document.querySelector<HTMLDivElement>("#canvas-pan-zoom")!;
  private stage = document.querySelector<HTMLDivElement>("#canvas-stage")!;
  private toolbarWrap = document.querySelector<HTMLDivElement>("#toolbar-wrap")!;
  private dimBadge = document.querySelector<HTMLSpanElement>("#img-dimensions")!;
  private zoomResetBtn = document.querySelector<HTMLButtonElement>("#btn-zoom-reset")!;
  private undoBtn = document.querySelector<HTMLButtonElement>("#btn-undo")!;
  private redoBtn = document.querySelector<HTMLButtonElement>("#btn-redo")!;
  private sizePopover = document.querySelector<HTMLDivElement>("#size-popover")!;
  private sizeSlider = document.querySelector<HTMLInputElement>("#stroke-size")!;
  private sizeValue = document.querySelector<HTMLSpanElement>("#size-value")!;
  private emojiPopover = document.querySelector<HTMLDivElement>("#emoji-popover")!;
  private shapePopover = document.querySelector<HTMLDivElement>("#shape-popover")!;
  private toolCursor = document.querySelector<HTMLDivElement>("#tool-cursor")!;

  // Rich movable Text Widget elements
  private textWidget = document.querySelector<HTMLDivElement>("#text-widget")!;
  private textInput = document.querySelector<HTMLInputElement>("#text-input")!;
  private textFontSelect = document.querySelector<HTMLSelectElement>("#text-font")!;
  private textSizeLabel = document.querySelector<HTMLSpanElement>("#text-size-label")!;
  private textColorCustom = document.querySelector<HTMLInputElement>("#text-color-custom")!;

  // Layers panel elements
  private layersPanel = document.querySelector<HTMLElement>("#layers-panel")!;
  private layersList = document.querySelector<HTMLDivElement>("#layers-list")!;
  private layersCount = document.querySelector<HTMLSpanElement>("#layers-count")!;

  // OCR panel elements & state
  private ocrPanel = document.querySelector<HTMLElement>("#ocr-panel")!;
  private ocrBtn = document.querySelector<HTMLButtonElement>("#btn-ocr")!;
  private ocrTextarea = document.querySelector<HTMLTextAreaElement>("#ocr-textarea")!;
  private ocrModeCopyBtn = document.querySelector<HTMLButtonElement>("#btn-ocr-mode-copy")!;
  private ocrModeRedactBtn = document.querySelector<HTMLButtonElement>("#btn-ocr-mode-redact")!;
  private ocrLines: OcrLineBox[] = [];
  private isOcrActive = false;
  private ocrClickMode: "copy" | "redact" = "copy";
  private hoveredOcrLineIdx: number | null = null;
  private baseWasCropped = false;

  private baseCtx = this.baseCanvas.getContext("2d")!;
  private annotCtx = this.annotCanvas.getContext("2d")!;

  private tool: ToolKind = "select";
  private color = USER_PALETTE[0];
  private strokeSize = 4;
  private activeEmoji = EMOJI_LIST[0];

  // Inline text state
  private textFont = DEFAULT_FONT;
  private textColor = USER_PALETTE[0];
  private textSize = 24;
  private editingTextIndex: number | null = null;
  private pendingTextPos: Point | null = null;
  private isDraggingTextWidget = false;
  private textWidgetDragOffset: Point = { x: 0, y: 0 };

  // Items & selection / transform state
  private items: AnnotationItem[] = [];
  private draft: AnnotationItem | null = null;
  private cropDraft: { start: Point; end: Point } | null = null;
  private selectedIndex: number | null = null;

  private interactionMode:
    | "none"
    | "draw"
    | "move-item"
    | "resize-item"
    | "place-emoji"
    | "erase"
    | "crop" = "none";
  private dragStartPt: Point = { x: 0, y: 0 };
  private resizeStartSize = 32;
  private resizeCenter: Point = { x: 0, y: 0 };
  private resizeStartDist = 1;

  // Smooth physical layer drag state
  private dragLayerOriginIdx: number | null = null;
  private dragLayerTargetIdx: number | null = null;
  private dragLayerStartY = 0;
  private dragLayerRowStep = 38;
  private dragLayerRowEl: HTMLElement | null = null;

  // Photoshop-style brush eraser state
  private activeErasePaths: EraserPath[] = [];
  private offscreenCanvas = document.createElement("canvas");

  // Photoshop-style Zoom (Alt + Wheel) & Pan (Space / Middle-click drag)
  private zoomFactor = 1;
  private panX = 0;
  private panY = 0;
  private isSpaceDown = false;
  private isPanning = false;
  private panStartClient: Point = { x: 0, y: 0 };

  private undoStack: EditorSnapshot[] = [];
  private redoStack: EditorSnapshot[] = [];

  // Multi-photo independent tabs (Photoshop-style)
  private photos: {
    id: number;
    name: string;
    base: ImageData;
    items: AnnotationItem[];
    undoStack: EditorSnapshot[];
    redoStack: EditorSnapshot[];
  }[] = [];
  private activePhotoId = 0;
  private nextPhotoId = 1;
  private splitPhotoIds: number[] = [];

  private readonly cropDimColor: string;
  private readonly accentColor: string;
  private readonly accentSoftColor: string;
  private readonly glassPillColor: string;
  private readonly handleFillColor: string;
  private readonly onToast: (msg: string, isError?: boolean) => void;

  constructor(onToast: (msg: string, isError?: boolean) => void) {
    this.onToast = onToast;
    const css = getComputedStyle(document.documentElement);
    this.cropDimColor = css.getPropertyValue("--crop-dim").trim();
    this.accentColor = css.getPropertyValue("--accent").trim();
    this.accentSoftColor = css.getPropertyValue("--accent-soft").trim();
    this.glassPillColor = css.getPropertyValue("--glass-pill-bg").trim();
    this.handleFillColor = css.getPropertyValue("--handle-fill").trim();

    this.initPalette();
    this.initTextWidget();
    this.initEmojiPopover();
    this.bindToolbar();
    this.bindCanvasEvents();
    this.bindLayersDragEvents();
    this.bindShortcuts();
    window.addEventListener("resize", () => this.fitCanvasToStage());
  }

  hasImage(): boolean {
    return this.baseCanvas.width > 0 && this.baseCanvas.height > 0;
  }

  /** Load the latest captured screenshot from the Rust backend as a new independent photo tab (or reset if resetAll is true). */
  async loadFromBackend(resetAll = false): Promise<void> {
    if (resetAll) {
      this.photos = [];
      this.splitPhotoIds = [];
      this.activePhotoId = 0;
      this.nextPhotoId = 1;
    } else if (this.hasImage() && this.activePhotoId > 0) {
      this.syncActivePhotoSlot();
      if (!this.splitPhotoIds.includes(this.activePhotoId)) {
        this.splitPhotoIds.push(this.activePhotoId);
      }
    }
    const info = await invoke<{ width: number; height: number }>("get_editor_image_info");
    const buffer = await invoke<ArrayBuffer>("get_editor_image_pixels");
    const imageData = new ImageData(new Uint8ClampedArray(buffer), info.width, info.height);

    const id = this.nextPhotoId++;
    const name = `Capture ${id}`;
    this.photos.push({
      id,
      name,
      base: imageData,
      items: [],
      undoStack: [],
      redoStack: [],
    });
    this.activePhotoId = id;
    this.splitPhotoIds = this.photos.filter((p) => p.id !== id).map((p) => p.id);

    this.items = [];
    this.draft = null;
    this.cropDraft = null;
    this.selectedIndex = null;
    this.undoStack = [];
    this.redoStack = [];
    this.zoomFactor = 1;
    this.panX = 0;
    this.panY = 0;
    this.baseWasCropped = false;
    this.closeOcrPanel();
    this.hidePopovers();
    this.closeTextWidget(false);
    this.applyBaseImage(imageData);
    this.updateHistoryButtons();
    this.renderAll();
    this.renderPhotoTabs();
  }

  private syncActivePhotoSlot(): void {
    const slot = this.photos.find((p) => p.id === this.activePhotoId);
    if (!slot || !this.hasImage()) return;
    slot.base = this.baseCtx.getImageData(0, 0, this.baseCanvas.width, this.baseCanvas.height);
    slot.items = structuredClone(this.items);
    slot.undoStack = [...this.undoStack];
    slot.redoStack = [...this.redoStack];
  }

  switchPhoto(id: number): void {
    if (id === this.activePhotoId) return;
    const prevActive = this.activePhotoId;
    this.commitTextWidget();
    this.syncActivePhotoSlot();
    const target = this.photos.find((p) => p.id === id);
    if (!target) return;
    if (this.splitPhotoIds.includes(id) && prevActive > 0) {
      this.splitPhotoIds = this.splitPhotoIds.map((x) => (x === id ? prevActive : x));
    }
    this.activePhotoId = id;
    this.items = structuredClone(target.items);
    this.undoStack = [...target.undoStack];
    this.redoStack = [...target.redoStack];
    this.draft = null;
    this.cropDraft = null;
    this.selectedIndex = null;
    this.zoomFactor = 1;
    this.panX = 0;
    this.panY = 0;
    this.closeOcrPanel();
    this.hidePopovers();
    this.applyBaseImage(target.base);
    this.updateHistoryButtons();
    this.renderAll();
    this.renderPhotoTabs();
  }

  deletePhoto(id: number): void {
    const idx = this.photos.findIndex((p) => p.id === id);
    if (idx < 0) return;
    this.photos.splice(idx, 1);
    if (this.photos.length === 0) {
      this.activePhotoId = 0;
      this.baseCanvas.width = 0;
      this.baseCanvas.height = 0;
      this.annotCanvas.width = 0;
      this.annotCanvas.height = 0;
      this.items = [];
      this.renderPhotoTabs();
      document.querySelector<HTMLButtonElement>("#btn-back-dock")?.click();
      return;
    }
    this.splitPhotoIds = this.splitPhotoIds.filter((sid) => sid !== id);
    if (this.activePhotoId === id) {
      const next = this.photos[Math.min(idx, this.photos.length - 1)];
      this.activePhotoId = next.id;
      this.splitPhotoIds = this.splitPhotoIds.filter((sid) => sid !== this.activePhotoId);
      this.items = structuredClone(next.items);
      this.undoStack = [...next.undoStack];
      this.redoStack = [...next.redoStack];
      this.selectedIndex = null;
      this.applyBaseImage(next.base);
      this.updateHistoryButtons();
      this.renderAll();
    }
    this.renderPhotoTabs();
    this.renderSplitBoard();
  }

  private toggleSplitPhoto(id: number): void {
    if (id === this.activePhotoId) return;
    if (this.splitPhotoIds.includes(id)) {
      this.splitPhotoIds = this.splitPhotoIds.filter((sid) => sid !== id);
    } else {
      this.splitPhotoIds.push(id);
    }
    this.renderPhotoTabs();
    this.fitCanvasToStage();
  }

  private startActiveBoardDrag(e: MouseEvent): void {
    const board = this.canvasBoard;
    const sid = this.activePhotoId;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let hoveredBoard: HTMLElement | null = null;

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > 6) {
        moved = true;
        board.classList.add("liquid-dragging");
        board.style.zIndex = "40";
      }
      if (moved) {
        const tilt = Math.max(-6, Math.min(6, dx * 0.04));
        board.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.04) rotate(${tilt.toFixed(2)}deg)`;

        board.style.pointerEvents = "none";
        const elUnder = document.elementFromPoint(me.clientX, me.clientY);
        board.style.pointerEvents = "";
        const candidate = elUnder?.closest<HTMLElement>(".canvas-board");
        if (hoveredBoard && hoveredBoard !== candidate) {
          hoveredBoard.classList.remove("liquid-drop-target");
        }
        if (candidate && candidate !== board) {
          candidate.classList.add("liquid-drop-target");
          hoveredBoard = candidate;
        } else {
          hoveredBoard = null;
        }
      }
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      board.classList.remove("liquid-dragging");
      board.style.transform = "";
      board.style.zIndex = "";
      if (hoveredBoard) {
        hoveredBoard.classList.remove("liquid-drop-target");
      }

      const targetId = hoveredBoard ? Number(hoveredBoard.dataset.photoId) : NaN;
      if (moved && !Number.isNaN(targetId) && targetId !== sid) {
        const fromIdx = this.photos.findIndex((p) => p.id === sid);
        const toIdx = this.photos.findIndex((p) => p.id === targetId);
        if (fromIdx >= 0 && toIdx >= 0) {
          this.animateLiquidFlip(() => {
            const [item] = this.photos.splice(fromIdx, 1);
            this.photos.splice(toIdx, 0, item);
            this.renderPhotoTabs();
            this.renderSplitBoard();
          });
        }
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  private renderSplitBoard(): void {
    const listEl = document.querySelector<HTMLDivElement>("#split-boards-list");
    if (!listEl) return;

    this.splitPhotoIds = this.splitPhotoIds.filter(
      (sid) => sid !== this.activePhotoId && this.photos.some((p) => p.id === sid),
    );

    if (this.splitPhotoIds.length === 0) {
      listEl.classList.add("hidden");
      listEl.innerHTML = "";
      this.stage.classList.remove("split-active");
      this.canvasBoard.style.order = "";
      return;
    }

    listEl.classList.remove("hidden");
    listEl.innerHTML = "";
    this.stage.classList.add("split-active");

    this.canvasBoard.dataset.photoId = String(this.activePhotoId);
    const activeIdx = this.photos.findIndex((p) => p.id === this.activePhotoId);
    this.canvasBoard.style.order = String(activeIdx >= 0 ? activeIdx : 0);

    const rect = this.stage.getBoundingClientRect();
    const totalItems = 1 + this.splitPhotoIds.length;
    const cols = totalItems <= 2 ? totalItems : totalItems <= 4 ? 2 : 3;
    const rows = Math.ceil(totalItems / cols);
    const maxW = Math.max(110, (rect.width - 48 - (cols - 1) * 20) / cols);
    const maxH = Math.max(100, (rect.height - 48 - (rows - 1) * 20) / rows);

    for (const sid of this.splitPhotoIds) {
      const slotIdx = this.photos.findIndex((p) => p.id === sid);
      const slot = slotIdx >= 0 ? this.photos[slotIdx] : undefined;
      if (!slot) continue;

      const board = document.createElement("div");
      board.className = "canvas-board split-board";
      board.dataset.photoId = String(sid);
      board.style.order = String(slotIdx);
      board.title = t("editor.boardClickHint");

      const badge = document.createElement("div");
      badge.className = "split-board-badge glass";

      const titleSpan = document.createElement("span");
      titleSpan.textContent = slot.name;

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "photo-tab-close";
      closeBtn.title = t("editor.unsplitTitle");
      closeBtn.textContent = "✕";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.splitPhotoIds = this.splitPhotoIds.filter((x) => x !== sid);
        this.renderPhotoTabs();
        this.fitCanvasToStage();
      });

      badge.appendChild(titleSpan);
      badge.appendChild(closeBtn);

      const canvas = document.createElement("canvas");
      canvas.width = slot.base.width;
      canvas.height = slot.base.height;
      const ctx = canvas.getContext("2d")!;
      ctx.putImageData(slot.base, 0, 0);
      for (const item of slot.items) {
        this.drawItem(ctx, item);
      }

      const scale = Math.min(1, maxW / Math.max(1, slot.base.width), maxH / Math.max(1, slot.base.height));
      const cssW = Math.max(90, Math.round(slot.base.width * scale));
      const cssH = Math.max(70, Math.round(slot.base.height * scale));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      board.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        let moved = false;
        let hoveredBoard: HTMLElement | null = null;

        const onMove = (me: MouseEvent) => {
          const dx = me.clientX - startX;
          const dy = me.clientY - startY;
          if (!moved && Math.hypot(dx, dy) > 6) {
            moved = true;
            board.classList.add("liquid-dragging");
            board.style.zIndex = "40";
          }
          if (moved) {
            const tilt = Math.max(-6, Math.min(6, dx * 0.04));
            board.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.04) rotate(${tilt.toFixed(2)}deg)`;

            board.style.pointerEvents = "none";
            const elUnder = document.elementFromPoint(me.clientX, me.clientY);
            board.style.pointerEvents = "";
            const candidate = elUnder?.closest<HTMLElement>(".canvas-board");
            if (hoveredBoard && hoveredBoard !== candidate) {
              hoveredBoard.classList.remove("liquid-drop-target");
            }
            if (candidate && candidate !== board) {
              candidate.classList.add("liquid-drop-target");
              hoveredBoard = candidate;
            } else {
              hoveredBoard = null;
            }
          }
        };

        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          board.classList.remove("liquid-dragging");
          board.style.transform = "";
          board.style.zIndex = "";
          if (hoveredBoard) {
            hoveredBoard.classList.remove("liquid-drop-target");
          }

          if (!moved) {
            this.switchPhoto(sid);
            this.fitCanvasToStage();
            return;
          }

          const targetId = hoveredBoard ? Number(hoveredBoard.dataset.photoId) : NaN;
          if (!Number.isNaN(targetId) && targetId !== sid) {
            const fromIdx = this.photos.findIndex((p) => p.id === sid);
            const toIdx = this.photos.findIndex((p) => p.id === targetId);
            if (fromIdx >= 0 && toIdx >= 0) {
              this.animateLiquidFlip(() => {
                const [item] = this.photos.splice(fromIdx, 1);
                this.photos.splice(toIdx, 0, item);
                this.renderPhotoTabs();
                this.renderSplitBoard();
              });
            }
          }
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });

      board.appendChild(badge);
      board.appendChild(canvas);
      listEl.appendChild(board);
    }
  }

  /** Smooth Apple Liquid Glass spring FLIP animation for tabs and photo boards. */
  private animateLiquidFlip(mutateDom: () => void): void {
    const selector = ".photo-tab, .canvas-stage.split-active .canvas-board";
    const beforeRects = new Map<string, DOMRect>();
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      const key = `${el.classList.contains("photo-tab") ? "tab" : "board"}-${el.dataset.photoId ?? ""}`;
      if (el.dataset.photoId) {
        beforeRects.set(key, el.getBoundingClientRect());
      }
    });

    mutateDom();

    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      const key = `${el.classList.contains("photo-tab") ? "tab" : "board"}-${el.dataset.photoId ?? ""}`;
      const prev = beforeRects.get(key);
      if (!prev) return;
      const next = el.getBoundingClientRect();
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.hypot(dx, dy) < 2) return;

      el.animate(
        [
          { transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.97)` },
          { transform: "translate3d(0, 0, 0) scale(1)" },
        ],
        {
          duration: 340,
          easing: "cubic-bezier(0.22, 1.2, 0.36, 1)",
        },
      );
    });
  }

  private renderPhotoTabs(): void {
    const list = document.querySelector<HTMLDivElement>("#photo-tabs-list");
    const saveAllBtn = document.querySelector<HTMLButtonElement>("#btn-save-all");
    if (saveAllBtn) {
      saveAllBtn.classList.toggle("hidden", this.photos.length < 2);
      saveAllBtn.textContent = `${t("editor.saveAll")} (${this.photos.length})`;
    }
    if (!list) return;
    list.innerHTML = "";
    for (const slot of this.photos) {
      const tab = document.createElement("div");
      tab.className = `photo-tab${slot.id === this.activePhotoId ? " active" : ""}`;
      tab.dataset.photoId = String(slot.id);
      tab.title = t("editor.tabHint");

      const input = document.createElement("input");
      input.type = "text";
      input.className = "photo-tab-name";
      input.value = slot.name;
      input.readOnly = true;
      input.title = t("editor.inputHint");
      tab.addEventListener("dblclick", (e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        e.stopPropagation();
        input.readOnly = false;
        input.focus();
        input.select();
      });
      input.addEventListener("blur", () => {
        input.readOnly = true;
      });
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" || e.key === "Escape") {
          input.blur();
        }
      });
      input.addEventListener("input", () => {
        slot.name = input.value.trim() || `Capture ${slot.id}`;
        if (this.splitPhotoIds.includes(slot.id)) {
          this.renderSplitBoard();
        }
      });

      tab.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        if (target.closest("button") || !input.readOnly) return;
        e.preventDefault();

        const startX = e.clientX;
        const startY = e.clientY;
        let moved = false;
        let hoveredTab: HTMLElement | null = null;

        const onMove = (me: MouseEvent) => {
          const dx = me.clientX - startX;
          const dy = me.clientY - startY;
          if (!moved && Math.hypot(dx, dy) > 5) {
            moved = true;
            tab.classList.add("dragging", "liquid-dragging");
            tab.style.zIndex = "30";
          }
          if (moved) {
            const tilt = Math.max(-5, Math.min(5, dx * 0.04));
            tab.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.06) rotate(${tilt.toFixed(2)}deg)`;

            tab.style.pointerEvents = "none";
            const elUnder = document.elementFromPoint(me.clientX, me.clientY);
            tab.style.pointerEvents = "";
            const candidate = elUnder?.closest<HTMLElement>(".photo-tab");
            if (hoveredTab && hoveredTab !== candidate) {
              hoveredTab.classList.remove("liquid-drop-target");
            }
            if (candidate && candidate !== tab) {
              candidate.classList.add("liquid-drop-target");
              hoveredTab = candidate;
            } else {
              hoveredTab = null;
            }
          }
        };

        const onUp = (ue: MouseEvent) => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          tab.classList.remove("dragging", "liquid-dragging");
          tab.style.transform = "";
          tab.style.zIndex = "";
          if (hoveredTab) {
            hoveredTab.classList.remove("liquid-drop-target");
          }

          const dx = ue.clientX - startX;
          const dy = ue.clientY - startY;

          if (!moved) {
            this.animateLiquidFlip(() => {
              this.switchPhoto(slot.id);
              this.fitCanvasToStage();
            });
            return;
          }

          // Dragged downward onto workspace -> detach side-by-side (supports 2, 3, 4+ pages!)
          if (dy > 32 && this.photos.length >= 2) {
            this.animateLiquidFlip(() => {
              if (slot.id === this.activePhotoId) {
                const other = this.photos.find((p) => p.id !== slot.id && !this.splitPhotoIds.includes(p.id));
                if (other) this.splitPhotoIds.push(other.id);
              } else if (!this.splitPhotoIds.includes(slot.id)) {
                this.splitPhotoIds.push(slot.id);
              }
              this.renderPhotoTabs();
              this.fitCanvasToStage();
            });
            return;
          }

          // Horizontal reorder if dropped over another tab
          const otherId = hoveredTab ? Number(hoveredTab.dataset.photoId) : NaN;
          if (!Number.isNaN(otherId) && otherId !== slot.id && Math.abs(dx) > 10) {
            const fromIdx = this.photos.findIndex((p) => p.id === slot.id);
            const toIdx = this.photos.findIndex((p) => p.id === otherId);
            if (fromIdx >= 0 && toIdx >= 0) {
              this.animateLiquidFlip(() => {
                const [item] = this.photos.splice(fromIdx, 1);
                this.photos.splice(toIdx, 0, item);
                this.renderPhotoTabs();
                this.renderSplitBoard();
              });
            }
          }
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });

      if (this.photos.length >= 2 && slot.id !== this.activePhotoId) {
        const splitBtn = document.createElement("button");
        splitBtn.type = "button";
        splitBtn.className = `photo-tab-split${this.splitPhotoIds.includes(slot.id) ? " pinned" : ""}`;
        splitBtn.title = t("editor.splitBtnTitle");
        splitBtn.textContent = "⧉";
        splitBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.toggleSplitPhoto(slot.id);
        });
        tab.appendChild(input);
        tab.appendChild(splitBtn);
      } else {
        tab.appendChild(input);
      }

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "photo-tab-close";
      closeBtn.title = t("editor.closeTabTitle");
      closeBtn.textContent = "✕";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.deletePhoto(slot.id);
      });

      tab.appendChild(closeBtn);
      list.appendChild(tab);
    }
  }

  /** Append the latest captured screenshot to the right of the current canvas (side-by-side). */
  async appendFromBackend(): Promise<void> {
    if (!this.hasImage()) {
      await this.loadFromBackend();
      return;
    }
    const info = await invoke<{ width: number; height: number }>("get_editor_image_info");
    const buffer = await invoke<ArrayBuffer>("get_editor_image_pixels");
    const newImageData = new ImageData(new Uint8ClampedArray(buffer), info.width, info.height);

    this.undoStack.push(this.currentSnapshot());
    this.redoStack = [];
    const oldW = this.baseCanvas.width;
    const oldH = this.baseCanvas.height;
    const oldImageData = this.baseCtx.getImageData(0, 0, oldW, oldH);

    const gap = 16;
    const combinedW = oldW + gap + info.width;
    const combinedH = Math.max(oldH, info.height);

    this.baseCanvas.width = combinedW;
    this.baseCanvas.height = combinedH;
    this.annotCanvas.width = combinedW;
    this.annotCanvas.height = combinedH;

    this.baseCtx.clearRect(0, 0, combinedW, combinedH);
    this.baseCtx.putImageData(oldImageData, 0, 0);
    this.baseCtx.putImageData(newImageData, oldW + gap, 0);

    this.dimBadge.textContent = `${combinedW} × ${combinedH}`;
    this.fitCanvasToStage();
    this.updateHistoryButtons();
    this.renderAll();
  }

  private applyBaseImage(imageData: ImageData): void {
    this.baseCanvas.width = imageData.width;
    this.baseCanvas.height = imageData.height;
    this.annotCanvas.width = imageData.width;
    this.annotCanvas.height = imageData.height;
    this.baseCtx.putImageData(imageData, 0, 0);
    this.dimBadge.textContent = `${imageData.width} × ${imageData.height}`;
    this.fitCanvasToStage();
  }

  fitCanvasToStage(): void {
    const w = this.baseCanvas.width;
    const h = this.baseCanvas.height;
    if (!w || !h) return;
    const rect = this.stage.getBoundingClientRect();
    const validSplits = this.splitPhotoIds.filter(
      (sid) => sid !== this.activePhotoId && this.photos.some((p) => p.id === sid),
    );
    const totalItems = 1 + validSplits.length;
    const cols = totalItems <= 2 ? totalItems : totalItems <= 4 ? 2 : 3;
    const rows = Math.ceil(totalItems / cols);
    const availW = Math.max(110, (rect.width - 48 - (cols - 1) * 20) / cols);
    const availH = Math.max(100, (rect.height - 48 - (rows - 1) * 20) / rows);
    const fitScale = Math.min(1, availW / w, availH / h);
    const cssW = Math.max(40, Math.round(w * fitScale));
    const cssH = Math.max(40, Math.round(h * fitScale));
    this.canvasViewport.style.width = `${cssW}px`;
    this.canvasViewport.style.height = `${cssH}px`;
    this.baseCanvas.style.width = `${cssW}px`;
    this.baseCanvas.style.height = `${cssH}px`;
    this.annotCanvas.style.width = `${cssW}px`;
    this.annotCanvas.style.height = `${cssH}px`;
    this.clampPan(cssW, cssH);
    this.canvasPanZoom.style.transform = `translate3d(${Math.round(this.panX)}px, ${Math.round(this.panY)}px, 0) scale(${this.zoomFactor})`;
    this.canvasBoard.style.transform = "";
    if (this.zoomResetBtn) {
      this.zoomResetBtn.textContent = `${Math.round(this.zoomFactor * 100)}%`;
    }
    this.refreshToolCursorVisual();
    this.renderSplitBoard();
  }

  private clampPan(viewW?: number, viewH?: number): void {
    if (this.zoomFactor <= 1) {
      this.panX = 0;
      this.panY = 0;
      return;
    }
    const vw = viewW ?? (this.canvasViewport.clientWidth || 100);
    const vh = viewH ?? (this.canvasViewport.clientHeight || 100);
    const maxPanX = Math.max(0, (vw * (this.zoomFactor - 1)) / 2);
    const maxPanY = Math.max(0, (vh * (this.zoomFactor - 1)) / 2);
    this.panX = Math.max(-maxPanX, Math.min(maxPanX, this.panX));
    this.panY = Math.max(-maxPanY, Math.min(maxPanY, this.panY));
  }

  private setZoom(newZoom: number, anchorClientX?: number, anchorClientY?: number): void {
    const clamped = Math.max(0.5, Math.min(6, newZoom));
    if (Math.abs(clamped - this.zoomFactor) < 0.001) return;

    if (anchorClientX !== undefined && anchorClientY !== undefined) {
      const vpRect = this.canvasViewport.getBoundingClientRect();
      const cx = vpRect.left + vpRect.width / 2 + this.panX;
      const cy = vpRect.top + vpRect.height / 2 + this.panY;
      const ratio = clamped / this.zoomFactor;
      this.panX -= (anchorClientX - cx) * (ratio - 1);
      this.panY -= (anchorClientY - cy) * (ratio - 1);
    }

    if (Math.abs(clamped - 1) < 0.04) {
      this.zoomFactor = 1;
      this.panX = 0;
      this.panY = 0;
    } else {
      this.zoomFactor = clamped;
    }
    this.fitCanvasToStage();
  }

  private resetZoom(): void {
    this.zoomFactor = 1;
    this.panX = 0;
    this.panY = 0;
    this.fitCanvasToStage();
  }

  // ---- Main Toolbar & Contextual Popovers ----

  private initPalette(): void {
    const container = document.querySelector<HTMLDivElement>("#color-swatches")!;
    const customInput = document.querySelector<HTMLInputElement>("#color-custom")!;

    USER_PALETTE.forEach((hex, idx) => {
      const btn = document.createElement("button");
      btn.className = `swatch${idx === 0 ? " active" : ""}`;
      btn.style.backgroundColor = hex;
      btn.title = hex;
      btn.addEventListener("click", () => {
        this.applyColorChoice(hex);
        customInput.value = hex;
        container.querySelectorAll(".swatch").forEach((el) => el.classList.remove("active"));
        btn.classList.add("active");
      });
      container.appendChild(btn);
    });

    customInput.addEventListener("input", () => {
      this.applyColorChoice(customInput.value);
      container.querySelectorAll(".swatch").forEach((el) => el.classList.remove("active"));
    });
    this.updateSizePreview();
  }

  private applyColorChoice(hex: string): void {
    this.color = hex;
    this.textColor = hex;
    this.updateSizePreview();
    this.syncTextWidgetStyle();

    // If a layer with color is currently selected, update its color live!
    if (this.selectedIndex !== null) {
      const item = this.items[this.selectedIndex];
      if (item && "color" in item) {
        this.pushSnapshot();
        item.color = hex;
        this.renderAll();
      }
    }
  }

  private initEmojiPopover(): void {
    EMOJI_LIST.forEach((em, idx) => {
      const btn = document.createElement("button");
      btn.className = `emoji-choice${idx === 0 ? " active" : ""}`;
      btn.textContent = em;
      btn.addEventListener("click", () => {
        this.activeEmoji = em;
        this.emojiPopover
          .querySelectorAll(".emoji-choice")
          .forEach((el) => el.classList.remove("active"));
        btn.classList.add("active");
        this.emojiPopover.classList.add("hidden");
        this.setTool("emoji");
      });
      this.emojiPopover.appendChild(btn);
    });
  }

  private bindToolbar(): void {
    document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.tool as ToolKind;
        const alreadyActive = this.tool === t;
        this.setTool(t);

        if (btn.id === "btn-shape-tool") {
          this.emojiPopover.classList.add("hidden");
          this.sizePopover.classList.add("hidden");
          this.positionPopoverUnderButton(this.shapePopover, btn);
          this.shapePopover.classList.toggle(
            "hidden",
            alreadyActive && !this.shapePopover.classList.contains("hidden"),
          );
        } else if (t === "emoji") {
          this.shapePopover.classList.add("hidden");
          this.sizePopover.classList.add("hidden");
          this.positionPopoverUnderButton(this.emojiPopover, btn);
          this.emojiPopover.classList.toggle(
            "hidden",
            alreadyActive && !this.emojiPopover.classList.contains("hidden"),
          );
        } else if (SIZED_TOOLS.has(t)) {
          this.shapePopover.classList.add("hidden");
          this.emojiPopover.classList.add("hidden");
          this.positionPopoverUnderButton(this.sizePopover, btn);
          if (alreadyActive && !this.sizePopover.classList.contains("hidden")) {
            this.sizePopover.classList.add("hidden");
          } else {
            this.sizePopover.classList.remove("hidden");
          }
        } else {
          this.hidePopovers();
        }
      });

      if (btn.id === "btn-shape-tool") {
        btn.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.emojiPopover.classList.add("hidden");
          this.sizePopover.classList.add("hidden");
          this.positionPopoverUnderButton(this.shapePopover, btn);
          this.shapePopover.classList.toggle("hidden");
        });
      }
    });

    const shapeToolBtn = document.querySelector<HTMLButtonElement>("#btn-shape-tool");
    this.shapePopover?.querySelectorAll<HTMLButtonElement>(".shape-opt").forEach((opt) => {
      opt.addEventListener("click", () => {
        const shape = opt.dataset.shape as ToolKind;
        if (!shape) return;
        this.shapePopover.querySelectorAll(".shape-opt").forEach((o) => o.classList.remove("active"));
        opt.classList.add("active");
        if (shapeToolBtn) {
          shapeToolBtn.dataset.tool = shape;
          const svg = opt.querySelector("svg");
          const curSvg = shapeToolBtn.querySelector("svg");
          if (svg && curSvg) {
            curSvg.innerHTML = svg.innerHTML;
          }
        }
        this.shapePopover.classList.add("hidden");
        this.setTool(shape);
        if (shapeToolBtn) {
          this.positionPopoverUnderButton(this.sizePopover, shapeToolBtn);
          this.sizePopover.classList.remove("hidden");
        }
      });
    });

    this.sizeSlider.addEventListener("input", () => {
      this.setStrokeSize(Number(this.sizeSlider.value));
    });

    document.querySelectorAll<HTMLButtonElement>("#size-popover .preset-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        const val = Number(pill.dataset.size || 4);
        this.setStrokeSize(val);
      });
    });

    this.undoBtn.addEventListener("click", () => this.undo());
    this.redoBtn.addEventListener("click", () => this.redo());

    const toggleEditorToolsBtn = document.querySelector<HTMLButtonElement>("#btn-toggle-editor-tools");
    toggleEditorToolsBtn?.addEventListener("click", () => {
      const nextOpen = this.toolbarWrap.classList.contains("hidden");
      this.setEditorToolsOpen(nextOpen);
    });

    const toggleLayersBtn = document.querySelector<HTMLButtonElement>("#btn-toggle-layers");
    toggleLayersBtn?.addEventListener("click", () => {
      const hidden = this.layersPanel.classList.toggle("hidden");
      toggleLayersBtn.classList.toggle("active", !hidden);
      window.setTimeout(() => this.fitCanvasToStage(), 30);
    });

    this.ocrBtn?.addEventListener("click", () => {
      this.toggleOcr();
    });
    document.querySelector("#btn-ocr-close")?.addEventListener("click", () => {
      this.closeOcrPanel();
    });
    this.ocrModeCopyBtn?.addEventListener("click", () => {
      this.setOcrClickMode("copy");
    });
    this.ocrModeRedactBtn?.addEventListener("click", () => {
      this.setOcrClickMode("redact");
    });
    document.querySelector("#btn-ocr-copy-all")?.addEventListener("click", () => {
      this.copyOcrText(this.ocrTextarea.value, t("toast.ocrCopiedAll"));
    });

    document.querySelector("#btn-copy")?.addEventListener("click", () => {
      this.copyAnnotated();
    });
    document.querySelector("#btn-save")?.addEventListener("click", () => {
      this.saveAnnotated();
    });
    document.querySelector("#btn-send-phone")?.addEventListener("click", () => {
      this.sendToPhone();
    });
    document.querySelector("#btn-stop-phone-share")?.addEventListener("click", () => {
      void this.stopPhoneShare();
    });
    document.querySelector("#btn-hide-phone-share")?.addEventListener("click", () => {
      document.querySelector("#phone-share-panel")?.classList.add("hidden");
    });
    document.querySelector("#btn-open-phone-share")?.addEventListener("click", () => {
      const panel = document.querySelector("#phone-share-panel");
      if (this.phoneSharePollId === null) {
        this.sendToPhone();
      } else {
        panel?.classList.toggle("hidden");
      }
    });
    document.querySelector("#btn-save-all")?.addEventListener("click", () => {
      this.saveAllAnnotated();
    });

    document.querySelector("#btn-zoom-in")?.addEventListener("click", () => {
      this.setZoom(this.zoomFactor * 1.25);
    });
    document.querySelector("#btn-zoom-out")?.addEventListener("click", () => {
      this.setZoom(this.zoomFactor / 1.25);
    });
    this.zoomResetBtn?.addEventListener("click", () => {
      this.resetZoom();
    });
  }

  setEditorToolsOpen(open: boolean): void {
    const toggleEditorToolsBtn = document.querySelector<HTMLButtonElement>("#btn-toggle-editor-tools");
    const toggleLayersBtn = document.querySelector<HTMLButtonElement>("#btn-toggle-layers");
    this.toolbarWrap.classList.toggle("hidden", !open);
    toggleEditorToolsBtn?.classList.toggle("active", open);
    if (!open) {
      this.hidePopovers();
      this.layersPanel.classList.add("hidden");
      toggleLayersBtn?.classList.remove("active");
    } else {
      this.layersPanel.classList.remove("hidden");
      toggleLayersBtn?.classList.add("active");
    }
    window.setTimeout(() => this.fitCanvasToStage(), 30);
  }

  private positionPopoverUnderButton(popover: HTMLElement, btn: HTMLElement): void {
    const wrapRect = this.toolbarWrap.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const centerY = btnRect.top - wrapRect.top + btnRect.height / 2;
    const clampedY = Math.max(36, Math.min(wrapRect.height - 36, centerY));
    popover.style.left = `${wrapRect.width + 8}px`;
    popover.style.top = `${clampedY}px`;
  }

  private hidePopovers(): void {
    this.sizePopover.classList.add("hidden");
    this.emojiPopover.classList.add("hidden");
    this.shapePopover?.classList.add("hidden");
  }

  private setStrokeSize(size: number): void {
    this.strokeSize = Math.max(2, Math.min(24, size));
    this.sizeSlider.value = String(this.strokeSize);
    this.updateSizePreview();
  }

  private updateSizePreview(): void {
    const dot = document.querySelector<HTMLSpanElement>("#size-dot");
    if (dot) {
      const px = Math.max(4, Math.min(20, this.strokeSize));
      dot.style.width = `${px}px`;
      dot.style.height = `${px}px`;
      dot.style.backgroundColor = this.color;
    }
    if (this.sizeValue) {
      this.sizeValue.textContent = `${this.strokeSize} px`;
    }
    this.refreshToolCursorVisual();
  }

  private setTool(tool: ToolKind): void {
    this.commitTextWidget();
    this.tool = tool;
    document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });
    this.refreshToolCursorVisual();
  }

  private nextStepNumber(): number {
    let maxNum = 0;
    for (const item of this.items) {
      if (item.kind === "step" && item.num > maxNum) {
        maxNum = item.num;
      }
    }
    return maxNum + 1;
  }

  private refreshToolCursorVisual(): void {
    if (!this.toolCursor) return;
    const rect = this.annotCanvas.getBoundingClientRect();
    const scale = rect.width > 0 && this.annotCanvas.width > 0 ? rect.width / this.annotCanvas.width : 1;
    const activeBtnSvg =
      document.querySelector<HTMLButtonElement>(`[data-tool="${this.tool}"] svg`)?.outerHTML ?? "";

    if (this.tool === "emoji") {
      const px = Math.max(22, Math.round(Math.max(36, this.strokeSize * 8) * scale));
      this.toolCursor.innerHTML = `<span class="cursor-emoji" style="font-size:${px}px">${this.activeEmoji}</span>`;
      return;
    }

    if (this.tool === "step") {
      const d = Math.max(22, Math.round(Math.max(28, this.strokeSize * 6) * scale));
      const fontPx = Math.max(11, Math.round(d * 0.52));
      const nextNum = this.nextStepNumber();
      this.toolCursor.innerHTML = `<span class="cursor-step" style="width:${d}px;height:${d}px;background:${this.color};font-size:${fontPx}px">${nextNum}</span>`;
      return;
    }

    if (this.tool === "eraser") {
      const d = Math.max(10, Math.round(Math.max(10, this.strokeSize * 3.5) * scale));
      this.toolCursor.innerHTML = `
        <span class="cursor-ring" style="width:${d}px;height:${d}px;background:var(--glass-pill-bg)"></span>
        <span class="cursor-badge" style="color:var(--text-primary)">${activeBtnSvg}</span>
      `;
      return;
    }

    if (this.tool === "pen" || this.tool === "highlighter") {
      const mult = this.tool === "highlighter" ? 3.2 : 1;
      const d = Math.max(6, Math.round(this.strokeSize * mult * scale));
      const alpha = this.tool === "highlighter" ? 0.45 : 0.9;
      this.toolCursor.innerHTML = `
        <span class="cursor-ring" style="width:${d}px;height:${d}px;background:${this.color};opacity:${alpha}"></span>
        <span class="cursor-badge" style="color:${this.color}">${activeBtnSvg}</span>
      `;
      return;
    }

    // Shapes, Text, Blur, Crop: precision dot + tool icon
    const iconColor = this.tool === "blur" || this.tool === "crop" ? "var(--text-primary)" : this.color;
    this.toolCursor.innerHTML = `
      <span class="cursor-ring" style="width:7px;height:7px;background:${iconColor}"></span>
      <span class="cursor-badge" style="color:${iconColor}">${activeBtnSvg}</span>
    `;
  }

  // ---- Rich Movable Text Widget (Font, Color, Size, Drag) ----

  private initTextWidget(): void {
    const swatchRow = document.querySelector<HTMLDivElement>("#text-color-swatches")!;
    USER_PALETTE.slice(0, 6).forEach((hex, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `swatch${idx === 0 ? " active" : ""}`;
      btn.style.backgroundColor = hex;
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        this.textColor = hex;
        this.textColorCustom.value = hex;
        swatchRow.querySelectorAll(".swatch").forEach((el) => el.classList.remove("active"));
        btn.classList.add("active");
        this.syncTextWidgetStyle();
      });
      swatchRow.appendChild(btn);
    });

    this.textColorCustom.addEventListener("input", () => {
      this.textColor = this.textColorCustom.value;
      swatchRow.querySelectorAll(".swatch").forEach((el) => el.classList.remove("active"));
      this.syncTextWidgetStyle();
    });

    this.textFontSelect.addEventListener("change", () => {
      this.textFont = this.textFontSelect.value;
      this.syncTextWidgetStyle();
    });

    document.querySelector("#text-size-down")?.addEventListener("click", () => {
      this.textSize = Math.max(12, this.textSize - 4);
      this.syncTextWidgetStyle();
    });
    document.querySelector("#text-size-up")?.addEventListener("click", () => {
      this.textSize = Math.min(96, this.textSize + 4);
      this.syncTextWidgetStyle();
    });
    document.querySelector("#text-confirm")?.addEventListener("click", () => {
      this.commitTextWidget();
    });

    this.textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.commitTextWidget();
      } else if (e.key === "Escape") {
        this.closeTextWidget(true);
      }
    });

    // Dragging the text widget via its handle
    const handle = document.querySelector<HTMLElement>("#text-drag-handle")!;
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const widgetRect = this.textWidget.getBoundingClientRect();
      this.isDraggingTextWidget = true;
      this.textWidgetDragOffset = {
        x: e.clientX - widgetRect.left,
        y: e.clientY - widgetRect.top,
      };
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isDraggingTextWidget) return;
      const boardRect = this.annotCanvas.getBoundingClientRect();
      const cssX = Math.max(
        0,
        Math.min(boardRect.width - 60, e.clientX - boardRect.left - this.textWidgetDragOffset.x),
      );
      const cssY = Math.max(
        0,
        Math.min(boardRect.height - 30, e.clientY - boardRect.top - this.textWidgetDragOffset.y),
      );
      this.textWidget.style.left = `${cssX}px`;
      this.textWidget.style.top = `${cssY}px`;

      const sx = this.annotCanvas.width / Math.max(1, boardRect.width);
      const sy = this.annotCanvas.height / Math.max(1, boardRect.height);
      const inputOffsetY = this.textInput.offsetTop;
      this.pendingTextPos = {
        x: cssX * sx,
        y: (cssY + inputOffsetY) * sy,
      };
    });

    window.addEventListener("mouseup", () => {
      if (this.isDraggingTextWidget) {
        this.isDraggingTextWidget = false;
        this.textInput.focus();
      }
    });
  }

  private syncTextWidgetStyle(): void {
    const boardRect = this.annotCanvas.getBoundingClientRect();
    const scale = boardRect.width / Math.max(1, this.annotCanvas.width);
    const displayPx = Math.max(13, Math.round(this.textSize * scale));
    this.textInput.style.color = this.textColor;
    this.textInput.style.fontFamily = this.textFont;
    this.textInput.style.fontSize = `${displayPx}px`;
    this.textSizeLabel.textContent = `${Math.round(this.textSize)} px`;

    // If editing an existing text layer, update it live too
    if (this.editingTextIndex !== null && this.items[this.editingTextIndex]?.kind === "text") {
      const item = this.items[this.editingTextIndex];
      if (item.kind === "text") {
        item.color = this.textColor;
        item.font = this.textFont;
        item.size = this.textSize;
      }
    }
  }

  private openTextWidgetAt(canvasPt: Point, existingIdx: number | null = null): void {
    this.commitTextWidget();
    const boardRect = this.annotCanvas.getBoundingClientRect();
    const scaleX = boardRect.width / Math.max(1, this.annotCanvas.width);
    const scaleY = boardRect.height / Math.max(1, this.annotCanvas.height);

    if (existingIdx !== null && this.items[existingIdx]?.kind === "text") {
      const existing = this.items[existingIdx];
      this.editingTextIndex = existingIdx;
      this.pendingTextPos = { ...existing.pos };
      this.textColor = existing.color;
      this.textSize = existing.size;
      this.textFont = existing.font;
      this.textFontSelect.value = existing.font;
      this.textColorCustom.value = existing.color;
      this.textInput.value = existing.text;
    } else {
      this.editingTextIndex = null;
      this.pendingTextPos = canvasPt;
      this.textColor = this.color;
      this.textSize = Math.max(18, this.strokeSize * 5);
      this.textInput.value = "";
    }

    const cssX = Math.max(4, Math.min(boardRect.width - 180, canvasPt.x * scaleX));
    const cssY = Math.max(4, Math.min(boardRect.height - 70, canvasPt.y * scaleY - 38));
    this.textWidget.style.left = `${cssX}px`;
    this.textWidget.style.top = `${cssY}px`;
    this.syncTextWidgetStyle();
    this.textWidget.classList.remove("hidden");
    this.renderAll();
    window.setTimeout(() => {
      this.textInput.focus();
      this.textInput.select();
    }, 15);
  }

  private commitTextWidget(): void {
    if (this.textWidget.classList.contains("hidden") || !this.pendingTextPos) return;
    const value = this.textInput.value.trim();
    const pos = this.pendingTextPos;
    const editIdx = this.editingTextIndex;

    this.closeTextWidget(false);

    if (editIdx !== null && this.items[editIdx]?.kind === "text") {
      if (!value) {
        this.pushSnapshot();
        this.items.splice(editIdx, 1);
        this.selectedIndex = null;
      } else {
        this.pushSnapshot();
        this.items[editIdx] = {
          kind: "text",
          pos,
          text: value,
          color: this.textColor,
          size: this.textSize,
          font: this.textFont,
        };
        this.selectedIndex = editIdx;
      }
      this.renderAll();
      return;
    }

    if (!value) return;
    this.pushSnapshot();
    const newItem: AnnotationItem = {
      kind: "text",
      pos,
      text: value,
      color: this.textColor,
      size: this.textSize,
      font: this.textFont,
    };
    newItem.name = this.nextLayerName(newItem);
    this.items.push(newItem);
    this.selectedIndex = this.items.length - 1;
    this.renderAll();
  }

  private closeTextWidget(restore: boolean): void {
    this.pendingTextPos = null;
    this.editingTextIndex = null;
    this.textInput.value = "";
    this.textWidget.classList.add("hidden");
    if (restore) this.renderAll();
  }

  // ---- History (Undo / Redo) ----

  private pushSnapshot(): void {
    const baseCopy = this.baseCtx.getImageData(
      0,
      0,
      this.baseCanvas.width,
      this.baseCanvas.height,
    );
    this.undoStack.push({
      base: baseCopy,
      items: structuredClone(this.items),
    });
    if (this.undoStack.length > 40) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.updateHistoryButtons();
  }

  private currentSnapshot(): EditorSnapshot {
    return {
      base: this.baseCtx.getImageData(0, 0, this.baseCanvas.width, this.baseCanvas.height),
      items: structuredClone(this.items),
    };
  }

  undo(): void {
    this.commitTextWidget();
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.currentSnapshot());
    this.applyBaseImage(prev.base);
    this.items = prev.items;
    this.selectedIndex = null;
    this.renderAll();
    this.updateHistoryButtons();
  }

  redo(): void {
    this.commitTextWidget();
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.currentSnapshot());
    this.applyBaseImage(next.base);
    this.items = next.items;
    this.selectedIndex = null;
    this.renderAll();
    this.updateHistoryButtons();
  }

  private updateHistoryButtons(): void {
    this.undoBtn.disabled = this.undoStack.length === 0;
    this.redoBtn.disabled = this.redoStack.length === 0;
  }

  // ---- Selection Bounds & Corner Handles (for Emoji, Text, Shapes) ----

  private getItemBounds(item: AnnotationItem): Bounds {
    switch (item.kind) {
      case "emoji": {
        const half = item.size * 0.62;
        return { x: item.pos.x - half, y: item.pos.y - half, w: half * 2, h: half * 2 };
      }
      case "step": {
        const half = item.size * 0.58;
        return { x: item.pos.x - half, y: item.pos.y - half, w: half * 2, h: half * 2 };
      }
      case "text": {
        this.annotCtx.save();
        this.annotCtx.font = `600 ${item.size}px ${item.font}`;
        const metrics = this.annotCtx.measureText(item.text);
        this.annotCtx.restore();
        const w = Math.max(24, metrics.width);
        const h = item.size * 1.2;
        return { x: item.pos.x - 4, y: item.pos.y - 2, w: w + 8, h: h + 4 };
      }
      case "rect":
      case "circle":
      case "triangle":
      case "blur":
      case "line":
      case "arrow": {
        const minX = Math.min(item.start.x, item.end.x);
        const maxX = Math.max(item.start.x, item.end.x);
        const minY = Math.min(item.start.y, item.end.y);
        const maxY = Math.max(item.start.y, item.end.y);
        return { x: minX - 6, y: minY - 6, w: Math.max(12, maxX - minX + 12), h: Math.max(12, maxY - minY + 12) };
      }
      case "pen":
      case "highlighter": {
        const xs = item.points.map((p) => p.x);
        const ys = item.points.map((p) => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        return { x: minX - 6, y: minY - 6, w: Math.max(12, maxX - minX + 12), h: Math.max(12, maxY - minY + 12) };
      }
    }
  }

  private getCornerPoints(b: Bounds): Point[] {
    return [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
      { x: b.x, y: b.y + b.h },
    ];
  }

  private hitCornerHandle(b: Bounds, pt: Point): boolean {
    const scale = this.annotCanvas.width / Math.max(1, this.annotCanvas.getBoundingClientRect().width);
    const hitRadius = Math.max(10, 11 * scale);
    return this.getCornerPoints(b).some((c) => Math.hypot(c.x - pt.x, c.y - pt.y) <= hitRadius);
  }

  private pointInBounds(b: Bounds, pt: Point, pad = 0): boolean {
    return pt.x >= b.x - pad && pt.x <= b.x + b.w + pad && pt.y >= b.y - pad && pt.y <= b.y + b.h + pad;
  }

  // ---- Canvas interaction ----

  private toCanvasPoint(e: MouseEvent): Point {
    const rect = this.annotCanvas.getBoundingClientRect();
    const sx = this.annotCanvas.width / Math.max(1, rect.width);
    const sy = this.annotCanvas.height / Math.max(1, rect.height);
    return {
      x: Math.max(0, Math.min(this.annotCanvas.width, (e.clientX - rect.left) * sx)),
      y: Math.max(0, Math.min(this.annotCanvas.height, (e.clientY - rect.top) * sy)),
    };
  }

  private bindCanvasEvents(): void {
    this.annotCanvas.addEventListener("mouseenter", () => {
      this.refreshToolCursorVisual();
      this.toolCursor.classList.remove("hidden");
    });

    this.annotCanvas.addEventListener("mouseleave", () => {
      this.toolCursor.classList.add("hidden");
      if (this.hoveredOcrLineIdx !== null) {
        this.hoveredOcrLineIdx = null;
        this.renderAnnotations();
      }
    });

    this.annotCanvas.addEventListener("mousemove", (e) => {
      const vpRect = this.canvasViewport.getBoundingClientRect();
      this.toolCursor.style.left = `${e.clientX - vpRect.left}px`;
      this.toolCursor.style.top = `${e.clientY - vpRect.top}px`;

      if (this.isOcrActive && this.ocrLines.length > 0 && this.interactionMode === "none") {
        const pt = this.toCanvasPoint(e);
        const hitIdx = this.hitOcrLine(pt);
        if (hitIdx !== this.hoveredOcrLineIdx) {
          this.hoveredOcrLineIdx = hitIdx;
          this.renderAnnotations();
        }
      }
    });

    // Photoshop-style Alt + Mouse Wheel zoom confined to the active photo viewport
    this.stage.addEventListener(
      "wheel",
      (e) => {
        if (!e.altKey && !e.ctrlKey) return;
        e.preventDefault();
        // If wheeling over a split preview photo, make it the active photo first so we zoom into it!
        const splitEl = (e.target as HTMLElement)?.closest<HTMLElement>(".split-board");
        if (splitEl && splitEl.dataset.photoId) {
          const sid = Number(splitEl.dataset.photoId);
          if (!Number.isNaN(sid) && sid !== this.activePhotoId) {
            this.switchPhoto(sid);
          }
        }
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        this.setZoom(this.zoomFactor * factor, e.clientX, e.clientY);
      },
      { passive: false },
    );

    // Double-click on any text item reopens the rich text widget on that item
    this.annotCanvas.addEventListener("dblclick", (e) => {
      const pt = this.toCanvasPoint(e);
      for (let i = this.items.length - 1; i >= 0; i--) {
        const item = this.items[i];
        if (item.kind === "text" && this.pointInBounds(this.getItemBounds(item), pt)) {
          this.selectedIndex = i;
          this.openTextWidgetAt(item.pos, i);
          return;
        }
      }
    });

    this.annotCanvas.addEventListener("mousedown", (e) => {
      // Hold Alt + Left-click, Space + Left-click, or Middle-click pans inside the zoomed image
      if (e.button === 1 || (e.button === 0 && (this.isSpaceDown || e.altKey))) {
        e.preventDefault();
        this.isPanning = true;
        this.panStartClient = { x: e.clientX - this.panX, y: e.clientY - this.panY };
        return;
      }
      if (e.button !== 0) return;
      this.hidePopovers();
      if (!this.textWidget.classList.contains("hidden")) {
        this.commitTextWidget();
      }

      const pt = this.toCanvasPoint(e);

      // 0. If OCR overlay is active and user clicks on a detected OCR line box
      if (this.isOcrActive && this.ocrLines.length > 0) {
        const hitOcrIdx = this.hitOcrLine(pt);
        if (hitOcrIdx !== null) {
          const line = this.ocrLines[hitOcrIdx];
          if (this.ocrClickMode === "copy") {
            this.copyOcrText(line.text, `Copié : "${line.text.slice(0, 28)}" ✓`);
          } else {
            this.pushSnapshot();
            const padX = 5;
            const padY = 3;
            const blurItem: AnnotationItem = {
              kind: "blur",
              start: { x: Math.max(0, line.x - padX), y: Math.max(0, line.y - padY) },
              end: {
                x: Math.min(this.baseCanvas.width, line.x + line.width + padX),
                y: Math.min(this.baseCanvas.height, line.y + line.height + padY),
              },
              blockSize: Math.max(10, this.strokeSize * 2),
            };
            blurItem.name = this.nextLayerName(blurItem);
            this.items.push(blurItem);
            this.selectedIndex = this.items.length - 1;
            this.renderAll();
            this.onToast(t("toast.textBlurred"));
          }
          return;
        }
      }

      // 1. Check if clicking a corner resize handle or body of the currently selected item
      if (this.selectedIndex !== null && this.items[this.selectedIndex]) {
        const selItem = this.items[this.selectedIndex];
        const b = this.getItemBounds(selItem);

        if (
          (selItem.kind === "emoji" ||
            selItem.kind === "text" ||
            selItem.kind === "step" ||
            selItem.kind === "rect" ||
            selItem.kind === "circle" ||
            selItem.kind === "triangle") &&
          this.hitCornerHandle(b, pt)
        ) {
          this.pushSnapshot();
          this.interactionMode = "resize-item";
          this.resizeCenter = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
          this.resizeStartDist = Math.max(8, Math.hypot(pt.x - this.resizeCenter.x, pt.y - this.resizeCenter.y));
          this.resizeStartSize = selItem.size;
          return;
        }

        if (this.pointInBounds(b, pt) && this.tool !== "eraser" && this.tool !== "crop") {
          this.pushSnapshot();
          this.interactionMode = "move-item";
          this.dragStartPt = pt;
          return;
        }
      }

      // 2. Check if clicking an existing item on the canvas to select/move it
      if (this.tool !== "eraser" && this.tool !== "crop") {
        for (let i = this.items.length - 1; i >= 0; i--) {
          const item = this.items[i];
          const canGrab =
            this.tool === "select" ||
            item.kind === "emoji" ||
            item.kind === "text" ||
            item.kind === "step";
          if (canGrab && this.pointInBounds(this.getItemBounds(item), pt, this.tool === "select" ? 8 : 0)) {
            this.selectedIndex = i;
            this.pushSnapshot();
            this.interactionMode = "move-item";
            this.dragStartPt = pt;
            this.renderAll();
            return;
          }
        }
      }

      this.selectedIndex = null;

      // 3. Tool-specific creation
      if (this.tool === "select") {
        this.renderAll();
        if (this.splitPhotoIds.length > 0) {
          this.startActiveBoardDrag(e);
        }
        return;
      }

      if (this.tool === "text") {
        this.openTextWidgetAt(pt, null);
        return;
      }

      if (this.tool === "step") {
        this.pushSnapshot();
        const num = this.nextStepNumber();
        const baseSize = Math.max(28, this.strokeSize * 6);
        const stepItem: AnnotationItem = {
          kind: "step",
          pos: pt,
          num,
          color: this.color,
          size: baseSize,
          name: `Pastille ${num}`,
        };
        this.items.push(stepItem);
        this.selectedIndex = this.items.length - 1;
        this.interactionMode = "place-emoji";
        this.dragStartPt = pt;
        this.resizeStartSize = baseSize;
        this.renderAll();
        this.refreshToolCursorVisual();
        return;
      }

      if (this.tool === "emoji") {
        this.pushSnapshot();
        const baseSize = Math.max(36, this.strokeSize * 8);
        const emojiItem: AnnotationItem = {
          kind: "emoji",
          pos: pt,
          emoji: this.activeEmoji,
          size: baseSize,
        };
        emojiItem.name = this.nextLayerName(emojiItem);
        this.items.push(emojiItem);
        this.selectedIndex = this.items.length - 1;
        this.interactionMode = "place-emoji";
        this.dragStartPt = pt;
        this.resizeStartSize = baseSize;
        this.renderAll();
        return;
      }

      if (this.tool === "eraser") {
        this.interactionMode = "erase";
        this.startBrushErase(pt);
        return;
      }

      if (this.tool === "crop") {
        this.interactionMode = "crop";
        this.cropDraft = { start: pt, end: pt };
        this.renderAll();
        return;
      }

      this.interactionMode = "draw";
      switch (this.tool) {
        case "pen":
        case "highlighter":
          this.draft = {
            kind: this.tool,
            points: [pt],
            color: this.color,
            size: this.strokeSize,
          };
          break;
        case "line":
        case "arrow":
        case "rect":
        case "circle":
        case "triangle":
          this.draft = {
            kind: this.tool,
            start: pt,
            end: pt,
            color: this.color,
            size: this.strokeSize,
          };
          break;
        case "blur":
          this.draft = {
            kind: "blur",
            start: pt,
            end: pt,
            blockSize: Math.max(8, this.strokeSize * 2),
          };
          break;
      }
      this.renderAll();
    });

    window.addEventListener("mousemove", (e) => {
      if (this.isPanning) {
        this.panX = e.clientX - this.panStartClient.x;
        this.panY = e.clientY - this.panStartClient.y;
        this.clampPan();
        this.canvasPanZoom.style.transform = `translate3d(${Math.round(this.panX)}px, ${Math.round(this.panY)}px, 0) scale(${this.zoomFactor})`;
        return;
      }
      if (this.interactionMode === "none") return;
      const pt = this.toCanvasPoint(e);

      if (this.interactionMode === "resize-item" && this.selectedIndex !== null) {
        const item = this.items[this.selectedIndex];
        if (item && (item.kind === "emoji" || item.kind === "text" || item.kind === "step")) {
          const dist = Math.max(6, Math.hypot(pt.x - this.resizeCenter.x, pt.y - this.resizeCenter.y));
          const ratio = dist / this.resizeStartDist;
          item.size = Math.round(Math.max(14, Math.min(280, this.resizeStartSize * ratio)));
          this.renderAnnotations();
        } else if (
          item &&
          (item.kind === "rect" || item.kind === "circle" || item.kind === "triangle")
        ) {
          const hw = Math.max(12, Math.abs(pt.x - this.resizeCenter.x));
          const hh = Math.max(12, Math.abs(pt.y - this.resizeCenter.y));
          item.start = { x: this.resizeCenter.x - hw, y: this.resizeCenter.y - hh };
          item.end = { x: this.resizeCenter.x + hw, y: this.resizeCenter.y + hh };
          this.renderAnnotations();
        }
        return;
      }

      if (this.interactionMode === "place-emoji" && this.selectedIndex !== null) {
        const item = this.items[this.selectedIndex];
        if (item && (item.kind === "emoji" || item.kind === "step")) {
          const dist = Math.hypot(pt.x - this.dragStartPt.x, pt.y - this.dragStartPt.y);
          if (dist > 6) {
            item.size = Math.round(Math.max(20, Math.min(280, dist * 2)));
            this.renderAnnotations();
          }
        }
        return;
      }

      if (this.interactionMode === "move-item" && this.selectedIndex !== null) {
        const item = this.items[this.selectedIndex];
        if (item) {
          const dx = pt.x - this.dragStartPt.x;
          const dy = pt.y - this.dragStartPt.y;
          this.items[this.selectedIndex] = shiftItem(item, dx, dy);
          this.dragStartPt = pt;
          this.renderAnnotations();
        }
        return;
      }

      if (this.interactionMode === "erase") {
        this.continueBrushErase(pt);
        return;
      }

      if (this.interactionMode === "crop" && this.cropDraft) {
        this.cropDraft.end = pt;
        this.renderAnnotations();
        return;
      }

      if (this.interactionMode === "draw" && this.draft) {
        if (this.draft.kind === "pen" || this.draft.kind === "highlighter") {
          this.draft.points.push(pt);
        } else if (
          this.draft.kind === "line" ||
          this.draft.kind === "arrow" ||
          this.draft.kind === "rect" ||
          this.draft.kind === "circle" ||
          this.draft.kind === "triangle" ||
          this.draft.kind === "blur"
        ) {
          this.draft.end = pt;
        }
        this.renderAnnotations();
      }
    });

    window.addEventListener("mouseup", () => {
      if (this.isPanning) {
        this.isPanning = false;
        return;
      }
      if (this.interactionMode === "none") return;
      const mode = this.interactionMode;
      this.interactionMode = "none";

      if (mode === "crop" && this.cropDraft) {
        this.applyCrop(this.cropDraft.start, this.cropDraft.end);
        this.cropDraft = null;
        this.renderAll();
        return;
      }

      if (mode === "draw" && this.draft) {
        if (
          this.draft.kind === "rect" ||
          this.draft.kind === "circle" ||
          this.draft.kind === "triangle"
        ) {
          const dx = Math.abs(this.draft.end.x - this.draft.start.x);
          const dy = Math.abs(this.draft.end.y - this.draft.start.y);
          if (dx < 12 && dy < 12) {
            const cx = this.draft.start.x;
            const cy = this.draft.start.y;
            this.draft.start = { x: cx - 32, y: cy - 32 };
            this.draft.end = { x: cx + 32, y: cy + 32 };
          }
        }
        this.pushSnapshot();
        this.draft.name = this.nextLayerName(this.draft);
        this.items.push(this.draft);
        this.selectedIndex = this.items.length - 1;
        this.draft = null;
        this.renderAll();
        return;
      }

      if (mode === "erase") {
        this.activeErasePaths = [];
      }

      this.renderAll();
    });
  }

  // ---- Layers Panel (Smooth Physical Drag-to-reorder + Select + Edit + Delete) ----

  private bindLayersDragEvents(): void {
    window.addEventListener("mousemove", (e) => {
      if (this.dragLayerOriginIdx === null || !this.dragLayerRowEl) return;
      const dy = e.clientY - this.dragLayerStartY;
      if (Math.abs(dy) > 3) {
        this.dragLayerRowEl.classList.add("dragging");
      }
      this.dragLayerRowEl.style.transform = `translateY(${dy}px) scale(1.02)`;

      // Visual list is top (items.length - 1) to bottom (0)
      const slotOffset = Math.round(dy / this.dragLayerRowStep);
      const origin = this.dragLayerOriginIdx;
      const target = Math.max(0, Math.min(this.items.length - 1, origin - slotOffset));
      this.dragLayerTargetIdx = target;

      const rows = this.layersList.querySelectorAll<HTMLElement>(".layer-item");
      for (const row of rows) {
        const idx = Number(row.dataset.layerIdx);
        if (idx === origin) continue;
        if (origin > target && idx < origin && idx >= target) {
          // Dragging down visually -> rows between origin and target slide UP
          row.style.transform = `translateY(-${this.dragLayerRowStep}px)`;
        } else if (origin < target && idx > origin && idx <= target) {
          // Dragging up visually -> rows between origin and target slide DOWN
          row.style.transform = `translateY(${this.dragLayerRowStep}px)`;
        } else {
          row.style.transform = "";
        }
      }
    });

    window.addEventListener("mouseup", () => {
      if (this.dragLayerOriginIdx === null) return;
      const origin = this.dragLayerOriginIdx;
      const target = this.dragLayerTargetIdx ?? origin;

      this.dragLayerOriginIdx = null;
      this.dragLayerTargetIdx = null;
      this.dragLayerRowEl = null;

      if (target !== origin) {
        this.pushSnapshot();
        const [moved] = this.items.splice(origin, 1);
        this.items.splice(target, 0, moved);
        this.selectedIndex = target;
      }
      this.renderAll();
    });
  }

  private renderLayersList(): void {
    this.layersCount.textContent = String(this.items.length);
    this.layersList.innerHTML = "";

    if (this.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "layers-empty";
      empty.textContent = "Aucune annotation";
      this.layersList.appendChild(empty);
      return;
    }

    // Render from top-most layer (last in array) to bottom-most layer (index 0)
    for (let idx = this.items.length - 1; idx >= 0; idx--) {
      const item = this.items[idx];
      const isSelected = this.selectedIndex === idx;
      const row = document.createElement("div");
      row.className = `layer-item${isSelected ? " selected" : ""}`;
      row.dataset.layerIdx = String(idx);
      row.title = t("layers.dragTip");

      const info = document.createElement("div");
      info.className = "layer-info";

      const grip = document.createElement("span");
      grip.className = "layer-grip";
      grip.textContent = "⋮⋮";

      const dot = document.createElement("span");
      dot.className = "layer-dot";
      dot.style.backgroundColor = "color" in item ? item.color : this.accentColor;

      const name = document.createElement("span");
      name.className = "layer-name";
      name.textContent = this.describeLayer(item);

      info.appendChild(grip);
      info.appendChild(dot);
      info.appendChild(name);

      const actions = document.createElement("div");
      actions.className = "layer-actions";

      // Edit button if text
      if (item.kind === "text") {
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "layer-btn";
        editBtn.title = t("layers.editTip");
        editBtn.textContent = "✎";
        editBtn.addEventListener("mousedown", (e) => e.stopPropagation());
        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.selectedIndex = idx;
          this.openTextWidgetAt(item.pos, idx);
        });
        actions.appendChild(editBtn);
      }

      // Delete layer (✕)
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "layer-btn delete";
      delBtn.title = t("layers.delTip");
      delBtn.textContent = "✕";
      delBtn.addEventListener("mousedown", (e) => e.stopPropagation());
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.deleteLayer(idx);
      });

      actions.appendChild(delBtn);

      row.appendChild(info);
      row.appendChild(actions);

      row.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        this.selectedIndex = idx;
        this.dragLayerOriginIdx = idx;
        this.dragLayerTargetIdx = idx;
        this.dragLayerStartY = e.clientY;
        this.dragLayerRowStep = row.offsetHeight + 6;
        this.dragLayerRowEl = row;
        this.layersList
          .querySelectorAll(".layer-item")
          .forEach((el) => el.classList.remove("selected"));
        row.classList.add("selected");
        this.renderAnnotations();
      });

      this.layersList.appendChild(row);
    }
  }

  private baseLayerLabel(item: AnnotationItem): string {
    switch (item.kind) {
      case "pen":
        return t("shortcut.action.pen", "Stylo");
      case "highlighter":
        return t("shortcut.action.highlighter", "Surligneur");
      case "line":
        return t("shortcut.action.line", "Ligne");
      case "arrow":
        return t("shortcut.action.arrow", "Flèche");
      case "rect":
        return t("shortcut.action.rect", "Rectangle");
      case "circle":
        return t("shortcut.action.circle", "Rond");
      case "triangle":
        return t("shortcut.action.triangle", "Triangle");
      case "blur":
        return t("shortcut.action.blur", "Floutage");
      case "emoji":
        return `${t("shortcut.action.emoji", "Emoji")} ${item.emoji}`;
      case "step":
        return `${t("shortcut.action.step", "Pastille")} ${item.num}`;
      case "text":
        return `"${item.text.slice(0, 14)}"`;
    }
  }

  private nextLayerName(item: AnnotationItem): string {
    const base = this.baseLayerLabel(item);
    const existingNames = new Set(this.items.map((it) => it.name || this.baseLayerLabel(it)));
    if (!existingNames.has(base)) {
      return base;
    }
    let counter = 1;
    while (existingNames.has(`${base} ${counter}`)) {
      counter++;
    }
    return `${base} ${counter}`;
  }

  private describeLayer(item: AnnotationItem): string {
    if (item.kind === "text") {
      return `"${item.text.slice(0, 14)}"`;
    }
    return item.name || this.baseLayerLabel(item);
  }

  private deleteLayer(idx: number): void {
    if (idx < 0 || idx >= this.items.length) return;
    this.pushSnapshot();
    this.items.splice(idx, 1);
    if (this.selectedIndex === idx) {
      this.selectedIndex = null;
    } else if (this.selectedIndex !== null && this.selectedIndex > idx) {
      this.selectedIndex--;
    }
    this.renderAll();
  }

  // ---- Photoshop-style brush eraser (erases only painted pixels under cursor) ----

  private startBrushErase(pt: Point): void {
    if (this.items.length === 0) return;
    this.pushSnapshot();
    const brushSize = Math.max(10, this.strokeSize * 3.5);
    this.activeErasePaths = [];

    for (const item of this.items) {
      if (!item.erased) {
        item.erased = [];
      }
      const path: EraserPath = { points: [pt], size: brushSize };
      item.erased.push(path);
      this.activeErasePaths.push(path);
    }
    this.renderAnnotations();
  }

  private continueBrushErase(pt: Point): void {
    if (this.activeErasePaths.length === 0) return;
    for (const path of this.activeErasePaths) {
      path.points.push(pt);
    }
    this.renderAnnotations();
  }

  // ---- Undoable crop ----

  private applyCrop(a: Point, b: Point): void {
    const x = Math.round(Math.min(a.x, b.x));
    const y = Math.round(Math.min(a.y, b.y));
    const w = Math.round(Math.abs(b.x - a.x));
    const h = Math.round(Math.abs(b.y - a.y));
    if (w < 12 || h < 12) return;

    this.pushSnapshot();
    const cropped = this.baseCtx.getImageData(x, y, w, h);
    this.items = this.items.map((item) => shiftItem(item, -x, -y));
    this.selectedIndex = null;
    this.baseWasCropped = true;
    this.closeOcrPanel();
    this.applyBaseImage(cropped);
    this.setTool("pen");
  }

  // ---- Native Windows OCR (Extract, Copy & Redact text) ----

  private hitOcrLine(pt: Point): number | null {
    for (let i = 0; i < this.ocrLines.length; i++) {
      const l = this.ocrLines[i];
      if (
        pt.x >= l.x - 4 &&
        pt.x <= l.x + l.width + 4 &&
        pt.y >= l.y - 3 &&
        pt.y <= l.y + l.height + 3
      ) {
        return i;
      }
    }
    return null;
  }

  private setOcrClickMode(mode: "copy" | "redact"): void {
    this.ocrClickMode = mode;
    this.ocrModeCopyBtn.classList.toggle("active", mode === "copy");
    this.ocrModeRedactBtn.classList.toggle("active", mode === "redact");
    document.querySelector("#ocr-segment")?.classList.toggle("redact", mode === "redact");
  }

  private closeOcrPanel(): void {
    this.isOcrActive = false;
    this.ocrLines = [];
    this.hoveredOcrLineIdx = null;
    this.ocrPanel.classList.add("hidden");
    this.ocrBtn?.classList.remove("active");
    window.setTimeout(() => this.fitCanvasToStage(), 30);
    this.renderAnnotations();
  }

  async toggleOcr(): Promise<void> {
    if (this.isOcrActive) {
      this.closeOcrPanel();
      return;
    }
    if (this.photos.length > 1) {
      this.onToast(t("toast.ocrMultiDisabled"), true);
      return;
    }
    if (!this.hasImage()) return;

    this.isOcrActive = true;
    this.ocrBtn?.classList.add("active");
    this.ocrPanel.classList.remove("hidden");
    this.ocrTextarea.value = "Reconnaissance du texte en cours…";
    window.setTimeout(() => this.fitCanvasToStage(), 30);

    try {
      let width = 0;
      let height = 0;
      let rgba: number[] = [];
      if (this.baseWasCropped) {
        width = this.baseCanvas.width;
        height = this.baseCanvas.height;
        rgba = Array.from(this.baseCtx.getImageData(0, 0, width, height).data);
      }

      const res = await invoke<OcrResponse>("recognize_image_text", {
        width,
        height,
        rgba,
      });

      this.ocrLines = res.lines || [];
      this.ocrTextarea.value = res.full_text || "";
      const countEl = document.querySelector<HTMLSpanElement>("#ocr-count");
      if (countEl) countEl.textContent = String(this.ocrLines.length);
      this.renderAnnotations();

      if (this.ocrLines.length === 0) {
        this.onToast(t("toast.ocrNoText"));
      } else {
        this.onToast(
          `${this.ocrLines.length} ${t("toast.ocrLinesDetected")}`,
        );
      }
    } catch (e) {
      this.ocrTextarea.value = "";
      this.onToast(`${t("toast.ocrError")} : ${String(e)}`, true);
    }
  }

  private async copyOcrText(text: string, toastMsg: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      this.onToast(t("toast.ocrNoTextToCopy"));
      return;
    }
    try {
      await invoke("copy_text_to_clipboard", { text: trimmed });
      this.onToast(toastMsg);
    } catch (e) {
      this.onToast(`${t("toast.copyError")} : ${String(e)}`, true);
    }
  }

  // ---- Rendering ----

  private renderAll(): void {
    this.renderAnnotations();
    this.renderLayersList();
    this.refreshToolCursorVisual();
  }

  private renderAnnotations(): void {
    const ctx = this.annotCtx;
    const w = this.annotCanvas.width;
    const h = this.annotCanvas.height;
    ctx.clearRect(0, 0, w, h);

    this.items.forEach((item, idx) => {
      // Hide item on canvas while it is being edited in the live text widget
      if (idx === this.editingTextIndex && !this.textWidget.classList.contains("hidden")) {
        return;
      }
      this.drawItem(ctx, item);
    });

    if (this.draft) {
      this.drawItem(ctx, this.draft);
    }

    // Draw interactive OCR line highlights when OCR panel is open
    if (this.isOcrActive && this.ocrLines.length > 0) {
      const scale =
        this.annotCanvas.width / Math.max(1, this.annotCanvas.getBoundingClientRect().width);
      ctx.save();
      this.ocrLines.forEach((line, idx) => {
        const isHovered = idx === this.hoveredOcrLineIdx;
        const padX = 5;
        const padY = 3;
        const rx = line.x - padX;
        const ry = line.y - padY;
        const rw = line.width + padX * 2;
        const rh = line.height + padY * 2;
        const radius = Math.min(rh / 2, 9 * scale);

        ctx.beginPath();
        ctx.roundRect(rx, ry, rw, rh, radius);
        ctx.fillStyle = isHovered ? this.accentSoftColor : this.glassPillColor;
        ctx.fill();
        // Frosted inner highlight + soft accent outline (liquid glass look)
        ctx.lineWidth = Math.max(1, (isHovered ? 2 : 1) * scale);
        ctx.strokeStyle = isHovered ? this.accentColor : this.handleFillColor;
        ctx.globalAlpha = isHovered ? 1 : 0.55;
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
      ctx.restore();
    }

    // Draw selection frame + 4 corner resize handles for the selected layer
    if (
      this.selectedIndex !== null &&
      this.items[this.selectedIndex] &&
      this.editingTextIndex === null
    ) {
      const selItem = this.items[this.selectedIndex];
      const b = this.getItemBounds(selItem);
      const scale = this.annotCanvas.width / Math.max(1, this.annotCanvas.getBoundingClientRect().width);
      const handleR = Math.max(5, 5.5 * scale);

      ctx.save();
      ctx.strokeStyle = this.accentColor;
      ctx.lineWidth = Math.max(1.5, 1.5 * scale);
      ctx.setLineDash([5 * scale, 4 * scale]);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);

      if (
        selItem.kind === "emoji" ||
        selItem.kind === "text" ||
        selItem.kind === "step" ||
        selItem.kind === "rect" ||
        selItem.kind === "circle" ||
        selItem.kind === "triangle"
      ) {
        for (const c of this.getCornerPoints(b)) {
          ctx.beginPath();
          ctx.arc(c.x, c.y, handleR, 0, Math.PI * 2);
          ctx.fillStyle = this.handleFillColor;
          ctx.fill();
          ctx.strokeStyle = this.accentColor;
          ctx.lineWidth = Math.max(2, 2 * scale);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    if (this.cropDraft) {
      const { start, end } = this.cropDraft;
      const rx = Math.min(start.x, end.x);
      const ry = Math.min(start.y, end.y);
      const rw = Math.abs(end.x - start.x);
      const rh = Math.abs(end.y - start.y);
      ctx.save();
      ctx.fillStyle = this.cropDimColor;
      ctx.fillRect(0, 0, w, h);
      ctx.clearRect(rx, ry, rw, rh);
      for (const item of this.items) {
        this.drawItem(ctx, item);
      }
      ctx.strokeStyle = this.accentColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(rx + 1, ry + 1, Math.max(0, rw - 2), Math.max(0, rh - 2));
      ctx.restore();
    }
  }

  private drawItem(ctx: CanvasRenderingContext2D, item: AnnotationItem): void {
    if (item.erased && item.erased.length > 0) {
      const w = this.baseCanvas.width;
      const h = this.baseCanvas.height;
      if (this.offscreenCanvas.width !== w || this.offscreenCanvas.height !== h) {
        this.offscreenCanvas.width = w;
        this.offscreenCanvas.height = h;
      }
      const offCtx = this.offscreenCanvas.getContext("2d")!;
      offCtx.clearRect(0, 0, w, h);
      this.drawRawItem(offCtx, item);

      offCtx.save();
      offCtx.globalCompositeOperation = "destination-out";
      offCtx.lineCap = "round";
      offCtx.lineJoin = "round";
      for (const erasePath of item.erased) {
        if (erasePath.points.length === 0) continue;
        offCtx.lineWidth = erasePath.size;
        offCtx.beginPath();
        offCtx.moveTo(erasePath.points[0].x, erasePath.points[0].y);
        for (let i = 1; i < erasePath.points.length; i++) {
          offCtx.lineTo(erasePath.points[i].x, erasePath.points[i].y);
        }
        // Single-click dot erase support
        if (erasePath.points.length === 1) {
          offCtx.lineTo(erasePath.points[0].x + 0.1, erasePath.points[0].y);
        }
        offCtx.stroke();
      }
      offCtx.restore();

      ctx.drawImage(this.offscreenCanvas, 0, 0);
      return;
    }

    this.drawRawItem(ctx, item);
  }

  private drawRawItem(ctx: CanvasRenderingContext2D, item: AnnotationItem): void {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    switch (item.kind) {
      case "pen":
      case "highlighter": {
        if (item.points.length === 0) break;
        ctx.strokeStyle = item.color;
        ctx.lineWidth = item.kind === "highlighter" ? item.size * 3.2 : item.size;
        ctx.globalAlpha = item.kind === "highlighter" ? 0.38 : 1;
        ctx.beginPath();
        ctx.moveTo(item.points[0].x, item.points[0].y);
        for (let i = 1; i < item.points.length; i++) {
          const prev = item.points[i - 1];
          const curr = item.points[i];
          const mx = (prev.x + curr.x) / 2;
          const my = (prev.y + curr.y) / 2;
          ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
        }
        const last = item.points[item.points.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
        break;
      }
      case "line": {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = item.size;
        ctx.beginPath();
        ctx.moveTo(item.start.x, item.start.y);
        ctx.lineTo(item.end.x, item.end.y);
        ctx.stroke();
        break;
      }
      case "arrow": {
        ctx.strokeStyle = item.color;
        ctx.fillStyle = item.color;
        ctx.lineWidth = item.size;
        const head = Math.max(12, item.size * 3.5);
        const dx = item.end.x - item.start.x;
        const dy = item.end.y - item.start.y;
        const dist = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        const pullback = Math.min(dist * 0.6, head * 0.72);
        const shaftEndX = item.end.x - pullback * Math.cos(angle);
        const shaftEndY = item.end.y - pullback * Math.sin(angle);
        ctx.beginPath();
        ctx.moveTo(item.start.x, item.start.y);
        ctx.lineTo(shaftEndX, shaftEndY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(item.end.x, item.end.y);
        ctx.lineTo(
          item.end.x - head * Math.cos(angle - Math.PI / 6),
          item.end.y - head * Math.sin(angle - Math.PI / 6),
        );
        ctx.lineTo(
          item.end.x - head * Math.cos(angle + Math.PI / 6),
          item.end.y - head * Math.sin(angle + Math.PI / 6),
        );
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "rect": {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = item.size;
        const x = Math.min(item.start.x, item.end.x);
        const y = Math.min(item.start.y, item.end.y);
        const w = Math.abs(item.end.x - item.start.x);
        const h = Math.abs(item.end.y - item.start.y);
        ctx.strokeRect(x, y, w, h);
        break;
      }
      case "circle": {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = item.size;
        const cx = (item.start.x + item.end.x) / 2;
        const cy = (item.start.y + item.end.y) / 2;
        const rx = Math.abs(item.end.x - item.start.x) / 2;
        const ry = Math.abs(item.end.y - item.start.y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "triangle": {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = item.size;
        ctx.lineJoin = "round";
        const x1 = Math.min(item.start.x, item.end.x);
        const x2 = Math.max(item.start.x, item.end.x);
        const y1 = Math.min(item.start.y, item.end.y);
        const y2 = Math.max(item.start.y, item.end.y);
        const midX = (x1 + x2) / 2;
        ctx.beginPath();
        ctx.moveTo(midX, y1);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x1, y2);
        ctx.closePath();
        ctx.stroke();
        break;
      }
      case "text": {
        ctx.fillStyle = item.color;
        ctx.font = `600 ${item.size}px ${item.font}`;
        ctx.textBaseline = "top";
        ctx.fillText(item.text, item.pos.x, item.pos.y);
        break;
      }
      case "emoji": {
        ctx.font = `${item.size}px "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(item.emoji, item.pos.x, item.pos.y);
        break;
      }
      case "step": {
        const radius = item.size / 2;
        ctx.beginPath();
        ctx.arc(item.pos.x, item.pos.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = item.color;
        ctx.fill();
        ctx.lineWidth = Math.max(2, item.size * 0.08);
        ctx.strokeStyle = this.handleFillColor;
        ctx.stroke();

        ctx.fillStyle = this.handleFillColor;
        ctx.font = `700 ${Math.round(item.size * 0.54)}px "Segoe UI Variable", "Segoe UI", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(item.num), item.pos.x, item.pos.y + item.size * 0.03);
        break;
      }
      case "blur": {
        this.drawPixelatedRegion(ctx, item.start, item.end, item.blockSize);
        break;
      }
    }
    ctx.restore();
  }

  private drawPixelatedRegion(
    ctx: CanvasRenderingContext2D,
    a: Point,
    b: Point,
    block: number,
  ): void {
    const x = Math.max(0, Math.floor(Math.min(a.x, b.x)));
    const y = Math.max(0, Math.floor(Math.min(a.y, b.y)));
    const w = Math.min(this.baseCanvas.width - x, Math.ceil(Math.abs(b.x - a.x)));
    const h = Math.min(this.baseCanvas.height - y, Math.ceil(Math.abs(b.y - a.y)));
    if (w < 2 || h < 2) return;

    const sw = Math.max(1, Math.floor(w / block));
    const sh = Math.max(1, Math.floor(h / block));
    const off = document.createElement("canvas");
    off.width = sw;
    off.height = sh;
    const offCtx = off.getContext("2d")!;
    offCtx.imageSmoothingEnabled = true;
    offCtx.drawImage(this.baseCanvas, x, y, w, h, 0, 0, sw, sh);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, sw, sh, x, y, w, h);
  }

  // ---- Export (Copy / Save) ----

  private async mergeToPngBytes(): Promise<{ width: number; height: number; pngBytes: number[] }> {
    this.commitTextWidget();
    const width = this.baseCanvas.width;
    const height = this.baseCanvas.height;
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const outCtx = out.getContext("2d")!;
    outCtx.drawImage(this.baseCanvas, 0, 0);
    for (const item of this.items) {
      this.drawItem(outCtx, item);
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      out.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png");
    });
    const buf = await blob.arrayBuffer();
    return { width, height, pngBytes: Array.from(new Uint8Array(buf)) };
  }

  async copyAnnotated(): Promise<void> {
    if (!this.baseCanvas.width) return;
    try {
      const { width, height, pngBytes } = await this.mergeToPngBytes();
      await invoke("copy_annotated_image", { pngBytes });
      this.onToast(`${t("toast.imageCopied")}  ${width} × ${height}`);
    } catch (e) {
      this.onToast(`${t("toast.copyError")} : ${String(e)}`, true);
    }
  }

  async saveAnnotated(): Promise<void> {
    if (!this.baseCanvas.width) return;
    try {
      const { pngBytes } = await this.mergeToPngBytes();
      const activeName = this.photos.find((p) => p.id === this.activePhotoId)?.name ?? "Glimpse";
      const savedPath = await invoke<string | null>("save_annotated_image", {
        pngBytes,
        defaultName: activeName,
      });
      if (savedPath) {
        this.onToast(t("toast.imageSaved"));
      }
    } catch (e) {
      this.onToast(`${t("toast.saveError")} : ${String(e)}`, true);
    }
  }

  private phoneShareActive = false;
  private phoneSharePollId: number | null = null;

  async sendToPhone(): Promise<void> {
    if (!this.baseCanvas.width) return;
    const button = document.querySelector<HTMLButtonElement>("#btn-send-phone");
    if (!button || button.disabled) return;

    button.disabled = true;
    try {
      const wasActive = this.phoneShareActive;
      const { pngBytes } = await this.mergeToPngBytes();
      const share = await invoke<{
        url: string;
        qrSvg: string;
        fallbackUrl: string | null;
        fallbackQrSvg: string | null;
      }>("start_mobile_share", { pngBytes });
      const panel = document.querySelector<HTMLElement>("#phone-share-panel");
      const qr = document.querySelector<HTMLElement>("#phone-share-qr");
      const link = document.querySelector<HTMLAnchorElement>("#phone-share-link");
      const fallbackButton = document.querySelector<HTMLButtonElement>("#btn-phone-share-fallback");
      if (!panel || !qr || !link || !fallbackButton) throw new Error("Phone sharing panel is unavailable");
      qr.innerHTML = share.qrSvg;
      link.href = share.url;
      link.textContent = share.url;
      fallbackButton.classList.toggle("hidden", !share.fallbackUrl);
      fallbackButton.onclick = () => {
        if (!share.fallbackUrl || !share.fallbackQrSvg) return;
        qr.innerHTML = share.fallbackQrSvg;
        link.href = share.fallbackUrl;
        link.textContent = share.fallbackUrl;
        fallbackButton.classList.add("hidden");
      };
      if (!wasActive) panel.classList.remove("hidden");
      this.phoneShareActive = true;
      document.querySelector("#btn-open-phone-share")?.classList.remove("hidden");
      const connected = await this.refreshPhoneShareStatus();
      if (!connected) {
        this.onToast("Téléphone non connecté — scannez le QR code", true);
      }
      if (this.phoneSharePollId === null) {
        this.phoneSharePollId = window.setInterval(() => {
          void this.refreshPhoneShareStatus();
        }, 3000);
      }
    } catch (error) {
      this.onToast(`${t("toast.phoneSendError")} : ${String(error)}`, true);
    } finally {
      button.disabled = false;
    }
  }

  private async stopPhoneShare(): Promise<void> {
    try {
      await invoke("stop_mobile_share");
      this.phoneShareActive = false;
      document.querySelector("#phone-share-panel")?.classList.add("hidden");
      if (this.phoneSharePollId !== null) {
        window.clearInterval(this.phoneSharePollId);
        this.phoneSharePollId = null;
      }
    } catch (error) {
      this.onToast(`${t("toast.phoneSendError")} : ${String(error)}`, true);
    }
  }

  private async refreshPhoneShareStatus(): Promise<boolean> {
    try {
      const status = await invoke<{ active: boolean; connected: boolean }>("get_mobile_share_status");
      if (!status.active) return false;
      for (const id of ["#phone-share-status-dot", "#phone-share-panel-dot"]) {
        document.querySelector(id)?.classList.toggle("connected", status.connected);
      }
      const label = document.querySelector<HTMLElement>("#phone-share-connection-text");
      if (label) label.textContent = t(status.connected ? "editor.phoneShareConnected" : "editor.phoneShareDisconnected");
      const stopBtn = document.querySelector<HTMLButtonElement>("#btn-stop-phone-share");
      if (stopBtn) stopBtn.disabled = !status.connected;
      return status.connected;
    } catch {
      // The next poll will retry while sharing remains active.
      return false;
    }
  }

  async saveAllAnnotated(): Promise<void> {
    if (this.photos.length === 0) return;
    try {
      this.commitTextWidget();
      this.syncActivePhotoSlot();
      const files: [string, number[]][] = [];
      for (const slot of this.photos) {
        const out = document.createElement("canvas");
        out.width = slot.base.width;
        out.height = slot.base.height;
        const outCtx = out.getContext("2d")!;
        outCtx.putImageData(slot.base, 0, 0);
        for (const item of slot.items) {
          this.drawItem(outCtx, item);
        }
        const blob = await new Promise<Blob>((resolve, reject) => {
          out.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png");
        });
        const buf = await blob.arrayBuffer();
        files.push([slot.name, Array.from(new Uint8Array(buf))]);
      }
      const savedCount = await invoke<number | null>("save_multiple_images", { files });
      if (savedCount) {
        this.onToast(`${savedCount} ${t("toast.imagesSaved")}`);
      }
    } catch (e) {
      this.onToast(`${t("toast.multiSaveError")} : ${String(e)}`, true);
    }
  }

  // ---- Keyboard shortcuts ----

  private customShortcuts: Record<string, string> = {};

  setShortcuts(shortcuts: Record<string, string>): void {
    this.customShortcuts = { ...shortcuts };
  }

  private matchesShortcut(e: KeyboardEvent, action: string, fallback: string): boolean {
    const combo = (this.customShortcuts[action] || fallback).trim().toLowerCase();
    if (!combo) return false;
    const parts = combo.split("+").map((p) => p.trim());
    const needCtrl = parts.includes("ctrl") || parts.includes("cmd");
    const needShift = parts.includes("shift");
    const needAlt = parts.includes("alt");
    const keyPart = parts.find((p) => p !== "ctrl" && p !== "cmd" && p !== "shift" && p !== "alt") ?? "";
    const hasCtrl = e.ctrlKey || e.metaKey;
    return hasCtrl === needCtrl && e.shiftKey === needShift && e.altKey === needAlt && e.key.toLowerCase() === keyPart;
  }

  private bindShortcuts(): void {
    window.addEventListener("keydown", (e) => {
      const activeEl = document.activeElement as HTMLElement | null;
      if (
        activeEl === this.textInput ||
        activeEl === this.textFontSelect ||
        activeEl === this.ocrTextarea ||
        activeEl?.tagName === "INPUT" ||
        activeEl?.tagName === "TEXTAREA" ||
        activeEl?.isContentEditable ||
        document.querySelector(".shortcut-key-btn.recording")
      ) {
        return;
      }

      if (e.code === "Space" && !this.isSpaceDown) {
        e.preventDefault();
        this.isSpaceDown = true;
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && this.selectedIndex !== null) {
        e.preventDefault();
        this.deleteLayer(this.selectedIndex);
        return;
      }

      if (this.matchesShortcut(e, "capture", "Ctrl+Shift+S")) {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>("#btn-new-snip")?.click();
        return;
      }
      if (this.matchesShortcut(e, "newPhoto", "Ctrl+Shift+N")) {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>("#btn-add-photo")?.click();
        return;
      }
      if (this.matchesShortcut(e, "undo", "Ctrl+Z")) {
        e.preventDefault();
        this.undo();
        return;
      }
      if (this.matchesShortcut(e, "redo", "Ctrl+Y")) {
        e.preventDefault();
        this.redo();
        return;
      }
      if (this.matchesShortcut(e, "copy", "Ctrl+C")) {
        e.preventDefault();
        this.copyAnnotated();
        return;
      }
      if (this.matchesShortcut(e, "save", "Ctrl+S")) {
        e.preventDefault();
        this.saveAnnotated();
        return;
      }
      if (this.matchesShortcut(e, "ocr", "O")) {
        e.preventDefault();
        this.toggleOcr();
        return;
      }

      const toolDefaults: [ToolKind, string][] = [
        ["select", "V"],
        ["pen", "P"],
        ["highlighter", "H"],
        ["line", "L"],
        ["arrow", "A"],
        ["rect", "R"],
        ["text", "T"],
        ["emoji", "E"],
        ["step", "N"],
        ["blur", "B"],
        ["eraser", "G"],
        ["crop", "C"],
      ];
      for (const [tool, fallback] of toolDefaults) {
        if (this.matchesShortcut(e, tool, fallback)) {
          e.preventDefault();
          this.setTool(tool);
          return;
        }
      }
    });

    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        this.isSpaceDown = false;
        this.isPanning = false;
      }
    });
  }

  public refreshI18n(): void {
    this.renderPhotoTabs();
    if (this.splitPhotoIds.length > 0) {
      this.renderSplitBoard();
    }
    this.renderLayersList();
  }
}

function shiftItem(item: AnnotationItem, dx: number, dy: number): AnnotationItem {
  const shiftedErased = item.erased?.map((ep) => ({
    size: ep.size,
    points: ep.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  }));

  switch (item.kind) {
    case "pen":
    case "highlighter":
      return {
        ...item,
        erased: shiftedErased,
        points: item.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      };
    case "line":
    case "arrow":
    case "rect":
    case "circle":
    case "triangle":
    case "blur":
      return {
        ...item,
        erased: shiftedErased,
        start: { x: item.start.x + dx, y: item.start.y + dy },
        end: { x: item.end.x + dx, y: item.end.y + dy },
      };
    case "text":
    case "emoji":
    case "step":
      return {
        ...item,
        erased: shiftedErased,
        pos: { x: item.pos.x + dx, y: item.pos.y + dy },
      };
  }
}
