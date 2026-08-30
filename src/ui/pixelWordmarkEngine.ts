/**
 * Lightweight pixel wordmark interaction inspired by First Light's
 * MIT-licensed particle wordmark. This implementation is independent and
 * tailored to About Blank's DOM, resource paths, and performance limits.
 */

interface PixelParticle {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  velocityX: number;
  velocityY: number;
  radius: number;
  color: string;
}

const MAX_PARTICLES = 6500;
const MIN_ALPHA = 24;
const BASE_SAMPLE_SPACING = 3.6;
const CANVAS_PADDING = 104;
const SPRING_STRENGTH = 0.045;
const VELOCITY_DAMPING = 0.82;
const REPULSION_RADIUS = 72;
const REPULSION_STRENGTH = 1.45;
const RESIZE_DELAY = 180;

export class PixelWordmarkEngine {
  private particles: PixelParticle[] = [];
  private canvasEl: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private scale = 1;
  private width = 0;
  private height = 0;
  private frame: number | null = null;
  private resizeTimer: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private buildToken = 0;
  private destroyed = false;
  private pointerInside = false;
  private pointerX = -9999;
  private pointerY = -9999;
  private previousPosition = "";
  private hiddenElements: Array<{ element: HTMLElement; visibility: string }> = [];

  constructor(private readonly containerEl: HTMLElement) {}

  async build(): Promise<boolean> {
    if (this.destroyed || !this.containerEl.isConnected) {
      return false;
    }
    const particles = await this.createParticles();
    if (this.destroyed || particles.length === 0) {
      return false;
    }
    this.particles = particles;
    this.installCanvas();
    if (!this.canvasEl || !this.context) {
      return false;
    }
    this.hideSources();
    this.containerEl.addEventListener("pointermove", this.handlePointerMove, {
      passive: true,
    });
    this.containerEl.addEventListener("pointerleave", this.handlePointerLeave);
    this.containerEl.ownerDocument.addEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.containerEl);
    this.render();
    return true;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.buildToken += 1;
    const view = this.getView();
    if (this.frame !== null) {
      view.cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    if (this.resizeTimer !== null) {
      view.clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.containerEl.removeEventListener("pointermove", this.handlePointerMove);
    this.containerEl.removeEventListener("pointerleave", this.handlePointerLeave);
    this.containerEl.ownerDocument.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
    this.canvasEl?.remove();
    this.canvasEl = null;
    this.context = null;
    this.restoreSources();
    this.containerEl.style.position = this.previousPosition;
    this.particles = [];
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const rect = this.containerEl.getBoundingClientRect();
    this.pointerInside = true;
    this.pointerX = event.clientX - rect.left;
    this.pointerY = event.clientY - rect.top;
    this.ensureFrame();
  };

  private readonly handlePointerLeave = (): void => {
    this.pointerInside = false;
    this.pointerX = -9999;
    this.pointerY = -9999;
    this.ensureFrame();
  };

  private readonly handleVisibilityChange = (): void => {
    if (this.containerEl.ownerDocument.hidden) {
      if (this.frame !== null) {
        this.getView().cancelAnimationFrame(this.frame);
        this.frame = null;
      }
      return;
    }
    if (this.pointerInside) {
      this.ensureFrame();
    }
  };

  private readonly handleResize = (): void => {
    if (this.destroyed) {
      return;
    }
    const view = this.getView();
    if (this.resizeTimer !== null) {
      view.clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = view.setTimeout(() => {
      this.resizeTimer = null;
      void this.resample();
    }, RESIZE_DELAY);
  };

  private async resample(): Promise<void> {
    const particles = await this.createParticles();
    if (
      this.destroyed
      || particles.length === 0
      || !this.canvasEl
      || !this.context
    ) {
      return;
    }
    this.particles = particles;
    this.resizeCanvas();
    this.render();
  }

  private async createParticles(): Promise<PixelParticle[]> {
    const token = ++this.buildToken;
    const rect = this.containerEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return [];
    }
    const view = this.getView();
    const scale = Math.min(2.5, Math.max(1.5, view.devicePixelRatio || 1));
    const offscreen = this.containerEl.ownerDocument.createElement("canvas");
    offscreen.width = Math.ceil((rect.width + (CANVAS_PADDING * 2)) * scale);
    offscreen.height = Math.ceil((rect.height + (CANVAS_PADDING * 2)) * scale);
    const context = offscreen.getContext("2d");
    if (!context) {
      return [];
    }
    context.scale(scale, scale);
    context.translate(CANVAS_PADDING, CANVAS_PADDING);

    try {
      await this.drawLogo(context, rect);
    } catch {
      // A title can still be rendered when a remote Logo blocks canvas access.
    }
    if (this.destroyed || token !== this.buildToken) {
      return [];
    }
    this.drawTitle(context, rect);

    try {
      const imageData = context.getImageData(
        0,
        0,
        offscreen.width,
        offscreen.height,
      );
      this.scale = scale;
      this.width = rect.width;
      this.height = rect.height;
      return this.sampleParticles(imageData, this.resolveParticleColor());
    } catch {
      return [];
    }
  }

  private async drawLogo(
    context: CanvasRenderingContext2D,
    containerRect: DOMRect,
  ): Promise<void> {
    const logoEl = this.containerEl.querySelector<HTMLElement>(
      ".about-blank-logo",
    );
    const svgEl = logoEl?.querySelector<SVGSVGElement>("svg");
    const source = logoEl?.dataset.aboutBlankParticleSource;
    if (!logoEl || (!svgEl && !source)) {
      return;
    }
    const logoRect = logoEl.getBoundingClientRect();
    if (logoRect.width <= 0 || logoRect.height <= 0) {
      return;
    }
    const image = svgEl
      ? await this.rasterizeSvg(svgEl)
      : await this.loadImage(source as string);
    const scale = Math.min(
      logoRect.width / image.naturalWidth,
      logoRect.height / image.naturalHeight,
    );
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const x = (logoRect.left - containerRect.left) + ((logoRect.width - width) / 2);
    const y = (logoRect.top - containerRect.top) + ((logoRect.height - height) / 2);
    context.drawImage(image, x, y, width, height);
    if (logoEl.dataset.aboutBlankParticleMask === "true") {
      const style = this.getView().getComputedStyle(logoEl);
      const tint = style.backgroundColor === "rgba(0, 0, 0, 0)"
        ? style.color
        : style.backgroundColor;
      context.save();
      context.globalCompositeOperation = "source-in";
      context.fillStyle = tint;
      context.fillRect(x, y, width, height);
      context.restore();
    }
  }

  private drawTitle(
    context: CanvasRenderingContext2D,
    containerRect: DOMRect,
  ): void {
    const titleEl = this.containerEl.querySelector<HTMLElement>(
      ".about-blank-wordmark-title:not([hidden])",
    );
    const text = titleEl?.textContent?.trim();
    if (!titleEl || !text) {
      return;
    }
    const rect = titleEl.getBoundingClientRect();
    const style = this.getView().getComputedStyle(titleEl);
    context.font = [
      style.fontStyle,
      style.fontWeight,
      style.fontSize,
      style.fontFamily,
    ].join(" ");
    context.fillStyle = style.color;
    context.textBaseline = "alphabetic";
    const metrics = context.measureText(text);
    const fontSize = Number.parseFloat(style.fontSize) || 16;
    const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8;
    const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;
    const x = (rect.left - containerRect.left) + ((rect.width - metrics.width) / 2);
    const y = (rect.top - containerRect.top)
      + ((rect.height - ascent - descent) / 2)
      + ascent;
    context.fillText(text, x, y);
  }

  private loadImage(source: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = this.containerEl.ownerDocument.createElement("img");
      if (/^https?:/i.test(source)) {
        image.crossOrigin = "anonymous";
      }
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Logo image failed to load"));
      image.src = source;
    });
  }

  private rasterizeSvg(svgEl: SVGSVGElement): Promise<HTMLImageElement> {
    const rect = svgEl.getBoundingClientRect();
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(rect.width));
    clone.setAttribute("height", String(rect.height));
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    const sourceNodes = [svgEl, ...Array.from(svgEl.querySelectorAll<SVGElement>("*"))];
    const cloneNodes = [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))];
    sourceNodes.forEach((sourceNode, index) => {
      const cloneNode = cloneNodes[index];
      if (!cloneNode) {
        return;
      }
      const style = this.getView().getComputedStyle(sourceNode);
      cloneNode.style.color = style.color;
      if (style.fill && style.fill !== "none") {
        cloneNode.setAttribute("fill", style.fill);
      }
      if (style.stroke && style.stroke !== "none") {
        cloneNode.setAttribute("stroke", style.stroke);
      }
    });
    const serialized = new XMLSerializer().serializeToString(clone);
    return this.loadImage(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`,
    );
  }

  private resolveParticleColor(): string {
    const titleEl = this.containerEl.querySelector<HTMLElement>(
      ".about-blank-wordmark-title:not([hidden])",
    );
    if (titleEl) {
      return this.getView().getComputedStyle(titleEl).color;
    }
    const logoEl = this.containerEl.querySelector<HTMLElement>(
      ".about-blank-logo",
    );
    if (logoEl) {
      const style = this.getView().getComputedStyle(logoEl);
      if (style.backgroundColor !== "rgba(0, 0, 0, 0)") {
        return style.backgroundColor;
      }
      return style.color;
    }
    return this.getView().getComputedStyle(this.containerEl).color;
  }

  private sampleParticles(imageData: ImageData, color: string): PixelParticle[] {
    let spacing = BASE_SAMPLE_SPACING * this.scale;
    let particles = this.collectParticles(imageData, spacing, color);
    while (particles.length > MAX_PARTICLES) {
      spacing *= 1.35;
      particles = this.collectParticles(imageData, spacing, color);
    }
    return particles;
  }

  private collectParticles(
    imageData: ImageData,
    spacing: number,
    color: string,
  ): PixelParticle[] {
    const particles: PixelParticle[] = [];
    const { data, width, height } = imageData;
    for (let cellY = 0; cellY < height; cellY += spacing) {
      const startY = Math.floor(cellY);
      const endY = Math.min(height, Math.max(startY + 1, Math.floor(cellY + spacing)));
      for (let cellX = 0; cellX < width; cellX += spacing) {
        const startX = Math.floor(cellX);
        const endX = Math.min(width, Math.max(startX + 1, Math.floor(cellX + spacing)));
        let alphaSum = 0;
        let weightedX = 0;
        let weightedY = 0;
        let activePixels = 0;
        for (let y = startY; y < endY; y += 1) {
          for (let x = startX; x < endX; x += 1) {
            const index = ((y * width) + x) * 4;
            const alpha = data[index + 3];
            if (alpha < MIN_ALPHA) {
              continue;
            }
            alphaSum += alpha;
            weightedX += x * alpha;
            weightedY += y * alpha;
            activePixels += 1;
          }
        }
        const cellPixels = (endX - startX) * (endY - startY);
        const coverage = alphaSum / Math.max(1, cellPixels * 255);
        if (activePixels === 0 || coverage < 0.025) {
          continue;
        }
        const homeX = ((weightedX / alphaSum) / this.scale) - CANVAS_PADDING;
        const homeY = ((weightedY / alphaSum) / this.scale) - CANVAS_PADDING;
        const radius = Math.min(
          0.92,
          Math.max(0.64, (spacing / this.scale) * 0.24),
        );
        particles.push({
          x: homeX,
          y: homeY,
          homeX,
          homeY,
          velocityX: 0,
          velocityY: 0,
          radius,
          color,
        });
      }
    }
    return particles;
  }

  private installCanvas(): void {
    const canvasEl = this.containerEl.ownerDocument.createElement("canvas");
    canvasEl.className = "about-blank-pixel-wordmark-canvas";
    this.canvasEl = canvasEl;
    this.context = canvasEl.getContext("2d");
    if (!this.context) {
      canvasEl.remove();
      this.canvasEl = null;
      return;
    }
    this.previousPosition = this.containerEl.style.position;
    if (this.getView().getComputedStyle(this.containerEl).position === "static") {
      this.containerEl.style.position = "relative";
    }
    this.containerEl.appendChild(canvasEl);
    this.resizeCanvas();
  }

  private resizeCanvas(): void {
    if (!this.canvasEl || !this.context) {
      return;
    }
    const canvasWidth = this.width + (CANVAS_PADDING * 2);
    const canvasHeight = this.height + (CANVAS_PADDING * 2);
    this.canvasEl.width = Math.ceil(canvasWidth * this.scale);
    this.canvasEl.height = Math.ceil(canvasHeight * this.scale);
    this.canvasEl.style.left = `${-CANVAS_PADDING}px`;
    this.canvasEl.style.top = `${-CANVAS_PADDING}px`;
    this.canvasEl.style.width = `${canvasWidth}px`;
    this.canvasEl.style.height = `${canvasHeight}px`;
    this.context.setTransform(this.scale, 0, 0, this.scale, 0, 0);
  }

  private hideSources(): void {
    const sources = this.containerEl.querySelectorAll<HTMLElement>(
      ".about-blank-logo, .about-blank-wordmark-title:not([hidden])",
    );
    this.hiddenElements = Array.from(sources).map((element) => {
      const visibility = element.style.visibility;
      element.style.visibility = "hidden";
      return { element, visibility };
    });
  }

  private restoreSources(): void {
    this.hiddenElements.forEach(({ element, visibility }) => {
      element.style.visibility = visibility;
    });
    this.hiddenElements = [];
  }

  private ensureFrame(): void {
    if (
      this.destroyed
      || this.frame !== null
      || this.containerEl.ownerDocument.hidden
    ) {
      return;
    }
    this.frame = this.getView().requestAnimationFrame(this.tick);
  }

  private readonly tick = (): void => {
    this.frame = null;
    if (this.destroyed) {
      return;
    }
    const moving = this.stepParticles();
    this.render();
    if (this.pointerInside || moving) {
      this.ensureFrame();
    }
  };

  private stepParticles(): boolean {
    let moving = false;
    const radiusSquared = REPULSION_RADIUS * REPULSION_RADIUS;
    this.particles.forEach((particle) => {
      if (this.pointerInside) {
        const deltaX = particle.x - this.pointerX;
        const deltaY = particle.y - this.pointerY;
        const distanceSquared = (deltaX * deltaX) + (deltaY * deltaY);
        if (distanceSquared > 0.001 && distanceSquared < radiusSquared) {
          const distance = Math.sqrt(distanceSquared);
          const ratio = (REPULSION_RADIUS - distance) / REPULSION_RADIUS;
          const force = ratio * ratio * REPULSION_STRENGTH;
          particle.velocityX += (deltaX / distance) * force;
          particle.velocityY += (deltaY / distance) * force;
        }
      }
      particle.velocityX += (particle.homeX - particle.x) * SPRING_STRENGTH;
      particle.velocityY += (particle.homeY - particle.y) * SPRING_STRENGTH;
      particle.velocityX *= VELOCITY_DAMPING;
      particle.velocityY *= VELOCITY_DAMPING;
      particle.x += particle.velocityX;
      particle.y += particle.velocityY;
      if (
        Math.abs(particle.velocityX) > 0.01
        || Math.abs(particle.velocityY) > 0.01
        || Math.abs(particle.homeX - particle.x) > 0.05
        || Math.abs(particle.homeY - particle.y) > 0.05
      ) {
        moving = true;
      }
    });
    return moving;
  }

  private render(): void {
    const context = this.context;
    if (!context) {
      return;
    }
    context.clearRect(
      0,
      0,
      this.width + (CANVAS_PADDING * 2),
      this.height + (CANVAS_PADDING * 2),
    );
    let currentColor = "";
    this.particles.forEach((particle) => {
      if (particle.color !== currentColor) {
        currentColor = particle.color;
        context.fillStyle = currentColor;
      }
      const size = particle.radius * 2;
      context.fillRect(
        particle.x + CANVAS_PADDING - particle.radius,
        particle.y + CANVAS_PADDING - particle.radius,
        size,
        size,
      );
    });
  }

  private getView(): Window {
    return this.containerEl.ownerDocument.defaultView ?? window;
  }
}
