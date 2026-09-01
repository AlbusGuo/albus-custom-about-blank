/**
 * Lightweight pixel wordmark interaction inspired by First Light's
 * MIT-licensed particle wordmark. This implementation is independent and
 * tailored to About Blank's DOM, resource paths, and performance limits.
 */

import type {
  ParticleAmbientMotion,
} from "src/settings/settingsSchema";

export interface PixelWordmarkOptions {
  useCustomColor: boolean;
  color: string;
  ambientMotion: ParticleAmbientMotion;
  scale: number;
  spacing: number;
  dotSize: number;
  repulsionRadius: number;
  repulsionStrength: number;
}

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

const MAX_PARTICLES = 10000;
const MIN_ALPHA = 24;
const COLOR_QUANTIZATION_STEP = 32;
const CANVAS_PADDING = 104;
const SPRING_STRENGTH = 0.045;
const VELOCITY_DAMPING = 0.82;
const RESIZE_DELAY = 180;
const SIN_LUT_SIZE = 1024;
const SIN_LUT_SCALE = SIN_LUT_SIZE / (Math.PI * 2);
const SIN_LUT = (() => {
  const table = new Float32Array(SIN_LUT_SIZE);
  for (let index = 0; index < SIN_LUT_SIZE; index += 1) {
    table[index] = Math.sin((index / SIN_LUT_SIZE) * Math.PI * 2);
  }
  return table;
})();

const lutSin = (phase: number): number => {
  return SIN_LUT[(phase * SIN_LUT_SCALE) & (SIN_LUT_SIZE - 1)];
};

const quantizeColorChannel = (channel: number): number => Math.min(
  255,
  Math.round(channel / COLOR_QUANTIZATION_STEP) * COLOR_QUANTIZATION_STEP,
);

const heartbeatShape = (phase: number): number => {
  const first = lutSin(phase);
  const second = lutSin(phase - 0.9);
  const pulse = first > 0 ? first ** 6 : 0;
  const echo = second > 0 ? second ** 6 : 0;
  return pulse + (echo * 0.55);
};

export class PixelWordmarkEngine {
  private readonly interactionEl: HTMLElement;
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

  constructor(
    private readonly containerEl: HTMLElement,
    private readonly options: PixelWordmarkOptions,
  ) {
    this.interactionEl = containerEl.closest<HTMLElement>(
      ".about-blank-component-stack",
    ) ?? containerEl;
  }

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
    this.interactionEl.addEventListener("pointermove", this.handlePointerMove, {
      passive: true,
    });
    this.interactionEl.addEventListener("pointerleave", this.handlePointerLeave);
    this.containerEl.ownerDocument.addEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.containerEl);
    this.render();
    if (this.options.ambientMotion !== "none") {
      this.ensureFrame();
    }
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
    this.interactionEl.removeEventListener("pointermove", this.handlePointerMove);
    this.interactionEl.removeEventListener("pointerleave", this.handlePointerLeave);
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
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const horizontalPadding = this.getHorizontalPadding();
    const verticalPadding = this.getVerticalPadding();
    const insideParticleSurface = pointerX >= -horizontalPadding
      && pointerX <= this.width + horizontalPadding
      && pointerY >= -verticalPadding
      && pointerY <= this.height + verticalPadding;
    if (!insideParticleSurface) {
      if (this.pointerInside) {
        this.handlePointerLeave();
      }
      return;
    }
    this.pointerInside = true;
    this.pointerX = pointerX;
    this.pointerY = pointerY;
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
    if (this.pointerInside || this.options.ambientMotion !== "none") {
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
    if (this.options.ambientMotion !== "none") {
      this.ensureFrame();
    }
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
      return this.sampleParticles(
        imageData,
        this.options.useCustomColor ? this.options.color : null,
      );
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
    if (
      logoEl.dataset.aboutBlankParticleMask === "true"
      && !this.imageHasVisibleColor(image)
    ) {
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

  private imageHasVisibleColor(image: HTMLImageElement): boolean {
    const sampleCanvas = this.containerEl.ownerDocument.createElement("canvas");
    const sampleSize = 32;
    sampleCanvas.width = sampleSize;
    sampleCanvas.height = sampleSize;
    const context = sampleCanvas.getContext("2d");
    if (!context) {
      return false;
    }
    context.drawImage(image, 0, 0, sampleSize, sampleSize);
    try {
      const { data } = context.getImageData(0, 0, sampleSize, sampleSize);
      let visiblePixels = 0;
      let coloredPixels = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] < MIN_ALPHA) {
          continue;
        }
        visiblePixels += 1;
        const minimum = Math.min(data[index], data[index + 1], data[index + 2]);
        const maximum = Math.max(data[index], data[index + 1], data[index + 2]);
        if (maximum - minimum >= 24) {
          coloredPixels += 1;
        }
      }
      return coloredPixels >= Math.max(2, Math.ceil(visiblePixels * 0.01));
    } catch {
      return false;
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

  private sampleParticles(
    imageData: ImageData,
    colorOverride: string | null,
  ): PixelParticle[] {
    let spacing = this.options.spacing * this.scale;
    let particles = this.collectParticles(imageData, spacing, colorOverride);
    while (particles.length > MAX_PARTICLES) {
      spacing *= 1.35;
      particles = this.collectParticles(imageData, spacing, colorOverride);
    }
    return particles;
  }

  private collectParticles(
    imageData: ImageData,
    spacing: number,
    colorOverride: string | null,
  ): PixelParticle[] {
    const particles: PixelParticle[] = [];
    const sampledColorCache = new Map<number, string>();
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
        let weightedRed = 0;
        let weightedGreen = 0;
        let weightedBlue = 0;
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
            weightedRed += data[index] * alpha;
            weightedGreen += data[index + 1] * alpha;
            weightedBlue += data[index + 2] * alpha;
            activePixels += 1;
          }
        }
        const cellPixels = (endX - startX) * (endY - startY);
        const coverage = alphaSum / Math.max(1, cellPixels * 255);
        if (activePixels === 0 || coverage < 0.025) {
          continue;
        }
        const sourceX = ((weightedX / alphaSum) / this.scale) - CANVAS_PADDING;
        const sourceY = ((weightedY / alphaSum) / this.scale) - CANVAS_PADDING;
        const homeX = (this.width / 2)
          + ((sourceX - (this.width / 2)) * this.options.scale);
        const homeY = (this.height / 2)
          + ((sourceY - (this.height / 2)) * this.options.scale);
        const radius = this.options.dotSize * this.options.scale;
        let color = colorOverride;
        if (!color) {
          const red = quantizeColorChannel(weightedRed / alphaSum);
          const green = quantizeColorChannel(weightedGreen / alphaSum);
          const blue = quantizeColorChannel(weightedBlue / alphaSum);
          const colorKey = (red << 16) | (green << 8) | blue;
          const cachedColor = sampledColorCache.get(colorKey);
          if (cachedColor) {
            color = cachedColor;
          } else {
            color = `rgb(${red} ${green} ${blue})`;
            sampledColorCache.set(colorKey, color);
          }
        }
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
    const horizontalPadding = this.getHorizontalPadding();
    const verticalPadding = this.getVerticalPadding();
    const canvasWidth = this.width + (horizontalPadding * 2);
    const canvasHeight = this.height + (verticalPadding * 2);
    this.canvasEl.width = Math.ceil(canvasWidth * this.scale);
    this.canvasEl.height = Math.ceil(canvasHeight * this.scale);
    this.canvasEl.style.left = `${-horizontalPadding}px`;
    this.canvasEl.style.top = `${-verticalPadding}px`;
    this.canvasEl.style.width = `${canvasWidth}px`;
    this.canvasEl.style.height = `${canvasHeight}px`;
    this.context.setTransform(this.scale, 0, 0, this.scale, 0, 0);
  }

  private getHorizontalPadding(): number {
    return CANVAS_PADDING + (this.width * (this.options.scale - 1) / 2);
  }

  private getVerticalPadding(): number {
    return CANVAS_PADDING + (this.height * (this.options.scale - 1) / 2);
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
    if (this.containerEl.getClientRects().length === 0) {
      return;
    }
    const moving = this.stepParticles();
    this.render();
    if (this.options.ambientMotion !== "none" || this.pointerInside || moving) {
      this.ensureFrame();
    }
  };

  private stepParticles(): boolean {
    let moving = false;
    const radiusSquared = this.options.repulsionRadius * this.options.repulsionRadius;
    this.particles.forEach((particle) => {
      if (this.pointerInside) {
        const deltaX = particle.x - this.pointerX;
        const deltaY = particle.y - this.pointerY;
        const distanceSquared = (deltaX * deltaX) + (deltaY * deltaY);
        if (distanceSquared > 0.001 && distanceSquared < radiusSquared) {
          const distance = Math.sqrt(distanceSquared);
          const ratio = (this.options.repulsionRadius - distance)
            / this.options.repulsionRadius;
          const force = ratio * ratio * this.options.repulsionStrength;
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
    const horizontalPadding = this.getHorizontalPadding();
    const verticalPadding = this.getVerticalPadding();
    context.clearRect(
      0,
      0,
      this.width + (horizontalPadding * 2),
      this.height + (verticalPadding * 2),
    );
    this.renderParticles(
      context,
      horizontalPadding,
      verticalPadding,
    );
  }

  private renderParticles(
    context: CanvasRenderingContext2D,
    horizontalPadding: number,
    verticalPadding: number,
  ): void {
    const motion = this.options.ambientMotion;
    if (motion === "none") {
      this.renderStatic(context, horizontalPadding, verticalPadding);
      return;
    }
    const time = this.getView().performance.now() * 0.001;
    if (motion === "float") {
      const offsetY = lutSin(time * 1.4) * 2.4;
      this.renderWithOffset(
        context,
        horizontalPadding,
        verticalPadding,
        () => [0, offsetY],
      );
      return;
    }
    if (motion === "breathe") {
      this.renderRadialScale(
        context,
        horizontalPadding,
        verticalPadding,
        1 + (lutSin(time * 1.1) * 0.015),
      );
      return;
    }
    if (motion === "pulse") {
      this.renderHeartbeat(context, horizontalPadding, verticalPadding, time);
      return;
    }
    if (motion === "ripple") {
      this.renderRipple(context, horizontalPadding, verticalPadding, time);
      return;
    }
    if (motion === "undulate") {
      const clock = lutSin(time * 1.6) * 2;
      this.renderWithOffset(
        context,
        horizontalPadding,
        verticalPadding,
        (particle) => [
          0,
          clock * lutSin((particle.homeX * 0.026) + (Math.PI / 2)),
        ],
      );
      return;
    }
    this.renderWithOffset(
      context,
      horizontalPadding,
      verticalPadding,
      (particle) => [
        0,
        lutSin(
          (time * 2.4)
          + ((particle.homeX + particle.homeY) * 0.045),
        ) * 1.6,
      ],
    );
  }

  private renderStatic(
    context: CanvasRenderingContext2D,
    horizontalPadding: number,
    verticalPadding: number,
  ): void {
    this.renderWithOffset(
      context,
      horizontalPadding,
      verticalPadding,
      () => [0, 0],
    );
  }

  private renderWithOffset(
    context: CanvasRenderingContext2D,
    horizontalPadding: number,
    verticalPadding: number,
    getOffset: (particle: PixelParticle) => [number, number],
  ): void {
    let currentColor = "";
    this.particles.forEach((particle) => {
      if (particle.color !== currentColor) {
        currentColor = particle.color;
        context.fillStyle = currentColor;
      }
      const [offsetX, offsetY] = getOffset(particle);
      this.drawParticle(
        context,
        particle,
        particle.x + offsetX + horizontalPadding,
        particle.y + offsetY + verticalPadding,
      );
    });
  }

  private renderRadialScale(
    context: CanvasRenderingContext2D,
    horizontalPadding: number,
    verticalPadding: number,
    scale: number,
  ): void {
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const stretch = scale - 1;
    this.renderWithOffset(
      context,
      horizontalPadding,
      verticalPadding,
      (particle) => [
        (particle.x - centerX) * stretch,
        (particle.y - centerY) * stretch,
      ],
    );
  }

  private renderHeartbeat(
    context: CanvasRenderingContext2D,
    horizontalPadding: number,
    verticalPadding: number,
    time: number,
  ): void {
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const maxDistance = Math.max(centerX, centerY, 1);
    this.renderWithOffset(
      context,
      horizontalPadding,
      verticalPadding,
      (particle) => {
        const deltaX = particle.x - centerX;
        const deltaY = particle.y - centerY;
        const distance = Math.sqrt((deltaX * deltaX) + (deltaY * deltaY));
        const envelope = 0.004 + ((distance / maxDistance) * 0.014);
        const stretch = heartbeatShape(
          (time * 5.2) - (distance * 0.008),
        ) * envelope;
        return [deltaX * stretch, deltaY * stretch];
      },
    );
  }

  private renderRipple(
    context: CanvasRenderingContext2D,
    horizontalPadding: number,
    verticalPadding: number,
    time: number,
  ): void {
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    this.renderWithOffset(
      context,
      horizontalPadding,
      verticalPadding,
      (particle) => {
        const deltaX = particle.x - centerX;
        const deltaY = particle.y - centerY;
        const distance = Math.sqrt((deltaX * deltaX) + (deltaY * deltaY));
        if (distance <= 0.001) {
          return [0, 0];
        }
        const offset = lutSin((time * 3) - (distance * 0.05)) * 1.4;
        const ratio = offset / distance;
        return [deltaX * ratio, deltaY * ratio];
      },
    );
  }

  private drawParticle(
    context: CanvasRenderingContext2D,
    particle: PixelParticle,
    x: number,
    y: number,
  ): void {
    const size = particle.radius * 2;
    context.fillRect(
      x - particle.radius,
      y - particle.radius,
      size,
      size,
    );
  }

  private getView(): Window {
    return this.containerEl.ownerDocument.defaultView ?? window;
  }
}
