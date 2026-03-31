import {
  type App,
  normalizePath,
  TFile,
} from "obsidian";

// =============================================================================

export class CustomIconManager {
  static readonly FILE_PREFIX = "custom-file:";

  private static instance: CustomIconManager;
  private app: App | null = null;
  private iconContentCache = new Map<string, string | null>();
  private pendingLoads = new Map<string, Promise<string | null>>();

  private constructor() {}

  static getInstance(app?: App): CustomIconManager {
    if (!CustomIconManager.instance) {
      CustomIconManager.instance = new CustomIconManager();
    }

    if (app) {
      CustomIconManager.instance.app = app;
    }

    return CustomIconManager.instance;
  }

  isCustomIcon(iconName: string): boolean {
    return typeof iconName === "string" && iconName.startsWith(CustomIconManager.FILE_PREFIX);
  }

  createIconReference(filePath: string): string {
    return `${CustomIconManager.FILE_PREFIX}${normalizePath(filePath)}`;
  }

  getFilePath(iconName: string): string | null {
    if (!this.isCustomIcon(iconName)) {
      return null;
    }

    return normalizePath(iconName.slice(CustomIconManager.FILE_PREFIX.length));
  }

  getDisplayName(iconName: string): string {
    const filePath = this.getFilePath(iconName);
    if (!filePath) {
      return iconName;
    }

    const segments = filePath.split("/");
    return segments[segments.length - 1] || filePath;
  }

  async getIconsFromFolder(folderPath: string): Promise<string[]> {
    if (!folderPath || !this.app) {
      return [];
    }

    const normalizedFolderPath = normalizePath(folderPath).replace(/\/$/, "");
    try {
      return this.app.vault.getFiles()
        .filter((file) => {
          if (file.extension.toLowerCase() !== "svg") {
            return false;
          }

          const normalizedFilePath = normalizePath(file.path);
          return normalizedFilePath.startsWith(`${normalizedFolderPath}/`);
        })
        .map((file) => this.createIconReference(file.path))
        .sort((left, right) => this.getDisplayName(left).localeCompare(this.getDisplayName(right), "zh-CN"));
    } catch {
      return [];
    }
  }

  clearCache(): void {
    this.iconContentCache.clear();
    this.pendingLoads.clear();
  }

  private async readIconContent(iconName: string): Promise<string | null> {
    const filePath = this.getFilePath(iconName);
    if (!filePath || !this.app) {
      return null;
    }

    const file = this.app.vault.getFileByPath(filePath);
    if (!(file instanceof TFile)) {
      return null;
    }

    try {
      const content = await this.app.vault.cachedRead(file);
      return this.isValidSvgContent(content) ? content : null;
    } catch {
      return null;
    }
  }

  private isValidSvgContent(content: string): boolean {
    if (!content.trim()) {
      return false;
    }

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, "image/svg+xml");
      return doc.querySelector("svg") instanceof SVGElement;
    } catch {
      return false;
    }
  }

  private async ensureIconContent(iconName: string): Promise<string | null> {
    if (this.iconContentCache.has(iconName)) {
      return this.iconContentCache.get(iconName) ?? null;
    }

    const pendingLoad = this.pendingLoads.get(iconName);
    if (pendingLoad) {
      return pendingLoad;
    }

    const loadPromise = this.readIconContent(iconName)
      .then((content) => {
        this.iconContentCache.set(iconName, content);
        this.pendingLoads.delete(iconName);
        return content;
      })
      .catch(() => {
        this.iconContentCache.set(iconName, null);
        this.pendingLoads.delete(iconName);
        return null;
      });

    this.pendingLoads.set(iconName, loadPromise);
    return loadPromise;
  }

  private toSvgDataUri(content: string): string {
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(content)}")`;
  }

  private renderMaskedSvgContent(content: string, containerEl: HTMLElement): boolean {
    try {
      containerEl.empty();
      const maskEl = containerEl.createDiv({ cls: "about-blank-custom-icon-mask about-blank-custom-icon-svg" });
      maskEl.style.setProperty("--about-blank-custom-icon-image", this.toSvgDataUri(content));
      return true;
    } catch {
      return false;
    }
  }

  private renderSvgContent(content: string, containerEl: HTMLElement): boolean {
    try {
      containerEl.empty();

      const parser = new DOMParser();
      const doc = parser.parseFromString(content, "image/svg+xml");
      const svgEl = doc.querySelector("svg");
      if (!(svgEl instanceof SVGElement)) {
        return false;
      }

      const importedSvg = document.importNode(svgEl, true);
      importedSvg.classList.add("about-blank-custom-icon-svg");

      if (!importedSvg.hasAttribute("viewBox")) {
        const width = importedSvg.getAttribute("width");
        const height = importedSvg.getAttribute("height");
        if (width && height) {
          importedSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        } else {
          importedSvg.setAttribute("viewBox", "0 0 24 24");
        }
      }

      containerEl.appendChild(importedSvg);
      return true;
    } catch {
      return false;
    }
  }

  renderIconFromCache(iconName: string, containerEl: HTMLElement, masked = false): boolean {
    const content = this.iconContentCache.get(iconName);
    if (!content) {
      return false;
    }

    return masked
      ? this.renderMaskedSvgContent(content, containerEl)
      : this.renderSvgContent(content, containerEl);
  }

  async renderIcon(iconName: string, containerEl: HTMLElement, masked = false): Promise<boolean> {
    if (this.renderIconFromCache(iconName, containerEl, masked)) {
      return true;
    }

    const content = await this.ensureIconContent(iconName);
    if (!content) {
      return false;
    }

    return masked
      ? this.renderMaskedSvgContent(content, containerEl)
      : this.renderSvgContent(content, containerEl);
  }
}