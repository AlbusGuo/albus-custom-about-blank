export type PointerSortStrategy = "horizontal" | "vertical" | "nearest";

export interface PointerSortOptions<T extends HTMLElement | SVGElement> {
  rootEl: Element;
  itemSelector: string;
  handleSelector?: string;
  strategy: PointerSortStrategy | ((sourceEl: T) => PointerSortStrategy);
  movementAxis?: "both" | "horizontal" | "vertical";
  getItems: (sourceEl: T) => T[];
  getId: (itemEl: T) => string;
  onCommit: (orderedIds: string[], sourceId: string) => void;
  scrollEl?: HTMLElement | null;
  toLocalDelta?: (itemEl: T, deltaX: number, deltaY: number) => [number, number];
}

interface PointerSortState<T extends HTMLElement | SVGElement> {
  pointerId: number;
  pointerType: string;
  sourceEl: T;
  sourceId: string;
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastClientY: number;
  initialIndex: number;
  currentIndex: number;
  initialScrollLeft: number;
  initialScrollTop: number;
  items: T[];
  rects: DOMRect[];
  touchReady: boolean;
  active: boolean;
}

const MOUSE_ACTIVATION_DISTANCE = 4;
const TOUCH_ACTIVATION_DELAY = 180;
const TOUCH_CANCEL_DISTANCE = 8;
const SETTLE_DURATION = 160;
const EDGE_SCROLL_DISTANCE = 36;
const MAX_EDGE_SCROLL_STEP = 12;

export class PointerSortController<T extends HTMLElement | SVGElement> {
  private readonly options: PointerSortOptions<T>;
  private state: PointerSortState<T> | null = null;
  private listenerController: AbortController | null = null;
  private touchTimer: number | null = null;
  private updateFrame: number | null = null;
  private settleTimer: number | null = null;

  constructor(options: PointerSortOptions<T>) {
    this.options = options;
    options.rootEl.addEventListener("pointerdown", this.handlePointerDown as EventListener);
  }

  destroy(): void {
    this.options.rootEl.removeEventListener("pointerdown", this.handlePointerDown as EventListener);
    if (this.settleTimer !== null) {
      this.getView().clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    const state = this.state;
    this.stopTracking(false);
    if (state) {
      this.clearVisualState(state);
    }
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.state) {
      return;
    }

    const targetEl = event.target as Element | null;
    if (!targetEl || typeof targetEl.closest !== "function") {
      return;
    }
    const sourceEl = targetEl.closest<T>(this.options.itemSelector);
    if (!sourceEl || !this.options.rootEl.contains(sourceEl)) {
      return;
    }
    if (this.options.handleSelector) {
      const handleEl = targetEl.closest(this.options.handleSelector);
      if (!handleEl || !sourceEl.contains(handleEl)) {
        return;
      }
    }

    const items = this.options.getItems(sourceEl);
    const initialIndex = items.indexOf(sourceEl);
    if (initialIndex < 0 || items.length < 2) {
      return;
    }

    const scrollEl = this.options.scrollEl;
    this.state = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      sourceEl,
      sourceId: this.options.getId(sourceEl),
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      initialIndex,
      currentIndex: initialIndex,
      initialScrollLeft: scrollEl?.scrollLeft ?? 0,
      initialScrollTop: scrollEl?.scrollTop ?? 0,
      items,
      rects: items.map((item) => item.getBoundingClientRect()),
      touchReady: event.pointerType !== "touch",
      active: false,
    };

    this.listenerController = new AbortController();
    const listenerOptions = {
      signal: this.listenerController.signal,
      passive: false,
    };
    const document = sourceEl.ownerDocument;
    document.addEventListener("pointermove", this.handlePointerMove, listenerOptions);
    document.addEventListener("pointerup", this.handlePointerUp, listenerOptions);
    document.addEventListener("pointercancel", this.handlePointerCancel, listenerOptions);
    document.addEventListener("keydown", this.handleKeyDown, {
      signal: this.listenerController.signal,
    });

    if (event.pointerType === "touch") {
      this.touchTimer = this.getView().setTimeout(() => {
        const state = this.state;
        if (!state) {
          return;
        }
        state.touchReady = true;
        this.activate();
        this.scheduleUpdate();
      }, TOUCH_ACTIVATION_DELAY);
    }
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const state = this.state;
    if (!state || event.pointerId !== state.pointerId) {
      return;
    }

    state.lastClientX = event.clientX;
    state.lastClientY = event.clientY;
    const distance = Math.hypot(
      event.clientX - state.startClientX,
      event.clientY - state.startClientY,
    );

    if (state.pointerType === "touch" && !state.touchReady) {
      if (distance > TOUCH_CANCEL_DISTANCE) {
        this.cancel(false);
      }
      return;
    }
    if (!state.active && distance < MOUSE_ACTIVATION_DISTANCE) {
      return;
    }

    this.activate();
    event.preventDefault();
    this.scheduleUpdate();
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.state || event.pointerId !== this.state.pointerId) {
      return;
    }
    if (this.state.active) {
      event.preventDefault();
      this.finish();
    } else {
      this.stopTracking();
    }
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    if (this.state && event.pointerId === this.state.pointerId) {
      this.cancel(this.state.active);
    }
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.state) {
      event.preventDefault();
      this.cancel(this.state.active);
    }
  };

  private activate(): void {
    const state = this.state;
    if (!state || state.active) {
      return;
    }
    state.active = true;
    state.sourceEl.classList.add("about-blank-pointer-sort-dragging");
    state.sourceEl.setAttribute("aria-grabbed", "true");
    this.options.rootEl.classList.add("about-blank-pointer-sorting");
  }

  private scheduleUpdate(): void {
    if (this.updateFrame !== null) {
      return;
    }
    this.updateFrame = this.getView().requestAnimationFrame(() => {
      this.updateFrame = null;
      this.updateSorting();
    });
  }

  private updateSorting(): void {
    const state = this.state;
    if (!state?.active) {
      return;
    }

    const scrollDeltaX = (this.options.scrollEl?.scrollLeft ?? 0) - state.initialScrollLeft;
    const scrollDeltaY = (this.options.scrollEl?.scrollTop ?? 0) - state.initialScrollTop;
    const movementAxis = this.options.movementAxis ?? "both";
    const pointerDeltaX = movementAxis === "vertical"
      ? 0
      : state.lastClientX - state.startClientX;
    const pointerDeltaY = movementAxis === "horizontal"
      ? 0
      : state.lastClientY - state.startClientY;
    const sourceRect = state.rects[state.initialIndex];
    const sourceCenterX = sourceRect.left + (sourceRect.width / 2) + pointerDeltaX;
    const sourceCenterY = sourceRect.top + (sourceRect.height / 2) + pointerDeltaY;
    const strategy = typeof this.options.strategy === "function"
      ? this.options.strategy(state.sourceEl)
      : this.options.strategy;

    let targetIndex = state.initialIndex;
    if (strategy === "nearest") {
      let nearestDistance = Number.POSITIVE_INFINITY;
      state.rects.forEach((rect, index) => {
        const centerX = rect.left + (rect.width / 2) - scrollDeltaX;
        const centerY = rect.top + (rect.height / 2) - scrollDeltaY;
        const distance = ((sourceCenterX - centerX) ** 2) + ((sourceCenterY - centerY) ** 2);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          targetIndex = index;
        }
      });
    } else {
      const sourceCenter = strategy === "horizontal" ? sourceCenterX : sourceCenterY;
      targetIndex = state.rects.length - 1;
      for (let index = 0; index < state.rects.length; index += 1) {
        const rect = state.rects[index];
        const targetCenter = strategy === "horizontal"
          ? rect.left + (rect.width / 2) - scrollDeltaX
          : rect.top + (rect.height / 2) - scrollDeltaY;
        if (sourceCenter < targetCenter) {
          targetIndex = index;
          break;
        }
      }
    }
    state.currentIndex = targetIndex;

    const virtualOrder = [...state.items];
    virtualOrder.splice(state.initialIndex, 1);
    virtualOrder.splice(state.currentIndex, 0, state.sourceEl);
    state.items.forEach((item, originalIndex) => {
      if (item === state.sourceEl) {
        this.setTranslation(item, pointerDeltaX + scrollDeltaX, pointerDeltaY + scrollDeltaY);
        return;
      }
      const targetSlot = virtualOrder.indexOf(item);
      const originalRect = state.rects[originalIndex];
      const targetRect = state.rects[targetSlot];
      this.setTranslation(
        item,
        targetRect.left - originalRect.left,
        targetRect.top - originalRect.top,
      );
    });

    if (this.autoScroll()) {
      this.scheduleUpdate();
    }
  }

  private autoScroll(): boolean {
    const state = this.state;
    const scrollEl = this.options.scrollEl;
    if (!state?.active || !scrollEl) {
      return false;
    }
    const rect = scrollEl.getBoundingClientRect();
    const movementAxis = this.options.movementAxis ?? "both";
    const horizontalStep = movementAxis === "vertical"
      ? 0
      : this.getEdgeScrollStep(state.lastClientX, rect.left, rect.right);
    const verticalStep = movementAxis === "horizontal"
      ? 0
      : this.getEdgeScrollStep(state.lastClientY, rect.top, rect.bottom);
    if (horizontalStep === 0 && verticalStep === 0) {
      return false;
    }
    const previousLeft = scrollEl.scrollLeft;
    const previousTop = scrollEl.scrollTop;
    scrollEl.scrollLeft += horizontalStep;
    scrollEl.scrollTop += verticalStep;
    return previousLeft !== scrollEl.scrollLeft || previousTop !== scrollEl.scrollTop;
  }

  private getEdgeScrollStep(pointer: number, start: number, end: number): number {
    if (pointer < start + EDGE_SCROLL_DISTANCE) {
      const strength = Math.min(1, Math.max(0, 1 - ((pointer - start) / EDGE_SCROLL_DISTANCE)));
      return -Math.ceil(MAX_EDGE_SCROLL_STEP * strength);
    }
    if (pointer > end - EDGE_SCROLL_DISTANCE) {
      const strength = Math.min(1, Math.max(0, 1 - ((end - pointer) / EDGE_SCROLL_DISTANCE)));
      return Math.ceil(MAX_EDGE_SCROLL_STEP * strength);
    }
    return 0;
  }

  private finish(): void {
    const state = this.state;
    if (!state) {
      return;
    }
    this.flushUpdateFrame();
    this.updateSorting();
    const changed = state.currentIndex !== state.initialIndex;
    const sourceRect = state.rects[state.initialIndex];
    const targetRect = state.rects[state.currentIndex];
    state.sourceEl.classList.add("about-blank-pointer-sort-settling");
    this.setTranslation(
      state.sourceEl,
      changed ? targetRect.left - sourceRect.left : 0,
      changed ? targetRect.top - sourceRect.top : 0,
    );
    this.suppressClick(state.sourceEl);

    const virtualOrder = [...state.items];
    virtualOrder.splice(state.initialIndex, 1);
    virtualOrder.splice(state.currentIndex, 0, state.sourceEl);
    const orderedIds = virtualOrder.map((item) => this.options.getId(item));
    const sourceId = state.sourceId;
    const delay = this.prefersReducedMotion(state.sourceEl) ? 0 : SETTLE_DURATION;
    this.stopTracking(false);
    this.settleTimer = this.getView().setTimeout(() => {
      this.settleTimer = null;
      this.clearVisualState(state);
      if (changed) {
        this.options.onCommit(orderedIds, sourceId);
      }
    }, delay);
  }

  private cancel(animate: boolean): void {
    const state = this.state;
    if (!state) {
      return;
    }
    this.flushUpdateFrame();
    state.items.forEach((item) => {
      item.classList.add("about-blank-pointer-sort-settling");
      this.setTranslation(item, 0, 0);
    });
    const delay = animate && !this.prefersReducedMotion(state.sourceEl)
      ? SETTLE_DURATION
      : 0;
    this.stopTracking(false);
    this.settleTimer = this.getView().setTimeout(() => {
      this.settleTimer = null;
      this.clearVisualState(state);
    }, delay);
  }

  private stopTracking(clearState: boolean = true): void {
    if (this.touchTimer !== null) {
      this.getView().clearTimeout(this.touchTimer);
      this.touchTimer = null;
    }
    this.flushUpdateFrame();
    this.listenerController?.abort();
    this.listenerController = null;
    if (clearState) {
      this.state = null;
    }
  }

  private flushUpdateFrame(): void {
    if (this.updateFrame !== null) {
      this.getView().cancelAnimationFrame(this.updateFrame);
      this.updateFrame = null;
    }
  }

  private clearVisualState(state: PointerSortState<T>): void {
    state.items.forEach((item) => {
      item.classList.remove(
        "about-blank-pointer-sort-dragging",
        "about-blank-pointer-sort-settling",
      );
      item.removeAttribute("aria-grabbed");
      this.setTranslation(item, 0, 0);
    });
    this.options.rootEl.classList.remove("about-blank-pointer-sorting");
    if (this.state === state) {
      this.state = null;
    }
  }

  private setTranslation(item: T, deltaX: number, deltaY: number): void {
    const movementAxis = this.options.movementAxis ?? "both";
    const constrainedX = movementAxis === "vertical" ? 0 : deltaX;
    const constrainedY = movementAxis === "horizontal" ? 0 : deltaY;
    const [localX, localY] = this.options.toLocalDelta?.(
      item,
      constrainedX,
      constrainedY,
    ) ?? [constrainedX, constrainedY];
    item.style.translate = `${localX}px ${localY}px`;
  }

  private suppressClick(item: T): void {
    if (item.namespaceURI === "http://www.w3.org/2000/svg") {
      const bubble = item.querySelector<HTMLElement>("[data-stat-id]");
      if (bubble) {
        this.suppressClick(bubble as unknown as T);
      }
      return;
    }
    item.dataset.aboutBlankSuppressClick = "true";
    this.getView().setTimeout(() => {
      delete item.dataset.aboutBlankSuppressClick;
    }, 300);
  }

  private getView(): Window {
    return this.options.rootEl.ownerDocument.defaultView ?? window;
  }

  private prefersReducedMotion(item: Element): boolean {
    return item.ownerDocument.defaultView
      ?.matchMedia("(prefers-reduced-motion: reduce)").matches ?? false;
  }
}
