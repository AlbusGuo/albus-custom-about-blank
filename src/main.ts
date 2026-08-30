import {
  TFile,
  Notice,
  Plugin,
  setIcon,
  setTooltip,
  type WorkspaceLeaf,
  WorkspaceSplit,
} from "obsidian";

import {
  type Action,
  actionPropTypeCheck,
  NEW_ACTION,
  newActionClone,
} from "src/settings/action-basic";

import {
  type PracticalAction,
  toPracticalAction,
} from "src/settings/action-edit";

import {
  editStyles,
} from "src/settings/editStyles";

import {
  type AboutBlankSettings,
  defaultSettingsClone,
  settingsPropTypeCheck,
} from "src/settings/settingsSchema";

import isFalsyString from "src/utils/isFalsyString";

import isPlainObject from "src/utils/isPlainObject";

import {
  findFirstCustomStatCondition,
  getCustomStatFieldValue,
  matchesCustomStatDefinition,
  normalizeCustomStatDefinitions,
  toCustomStatFilterGroup,
} from "src/utils/customStatQuery";

import {
  type DateStatDefinition,
  calcDateStatValue,
  normalizeDateStatDefinitions,
} from "src/settings/dateStatTypes";

import {
  adjustInt,
  loggerOnError,
} from "src/commons";

import {
  CSS_CLASSES,
  DEFAULT_LOGO_SVG,
} from "src/constants";

import {
  UNSAFE_VIEW_TYPES,
  type UnsafeEmptyView,
  type ConstructableWorkspaceSplit,
  type UnsafeStatefulView,
  type UnsafeWorkspaceSplit,
  type UnsafeWorkspaceWithLayoutChange,
} from "src/unsafe";

import { FileListModal } from "src/ui/fileListModal";

import { PointerSortController } from "src/ui/pointerSort";

import { PixelWordmarkEngine } from "src/ui/pixelWordmarkEngine";

import {
  CustomIconsIntegration,
} from "src/integrations/customIconsIntegration";

import {
  LocalHtmlBridge,
} from "src/localHtmlBridge";

import {
  createNewTabLayout,
  getPresetComponentOrder,
  NEW_TAB_LAYOUT_PRESETS,
  normalizeNewTabLayout,
  type NewTabComponentId,
  type NewTabLayoutPreset,
} from "src/newTab/layoutTypes";
// =============================================================================

type StatItemKind = "default" | "file" | "date";
type StatItemFamily = "file" | "date";
type StatItem = {
  id: string;
  label: string;
  value: number | string;
  kind: StatItemKind;
  dateStatType?: string;
  files?: TFile[];
};
type HeatmapDateCountMap = Record<string, number>;
type HeatmapColorSegment = AboutBlankSettings["heatmapColorSegments"][number];
type CustomStat = AboutBlankSettings["customStats"][number];
type FlatHeatmapCellSnapshot = {
  backgroundColor: string;
  hasDate: boolean;
};
type IsometricHeatmapCellSnapshot = {
  cell: SVGGElement;
  color: string;
  height: number;
};

interface ContributionItem {
  date: string;
  weekDay: number;
  month: number;
  monthDate: number;
  year: number;
  count: number;
}

const ISOMETRIC_TILE_HALF_WIDTH = 1.7;
const ISOMETRIC_TILE_HEIGHT = 2;
const ISOMETRIC_MAX_PILLAR_HEIGHT = 6;

export default class AboutBlank extends Plugin {
  settings: AboutBlankSettings;
  customIconsIntegration: CustomIconsIntegration;
  private readonly localHtmlBridge = new LocalHtmlBridge();

  // 性能优化: 类级别的缓存
  private statsCache: StatItem[] | null = null;
  private statsCacheTimestamp: number = 0;
  private readonly STATS_CACHE_DURATION = 5000;
  private statSortControllers = new Map<
    Element,
    PointerSortController<HTMLElement | SVGElement>
  >();

  // 热力图/统计相关缓存
  private heatmapDataCache: { [key: string]: number } | null = null;
  private heatmapYearCache: { [year: number]: { [key: string]: number } } = {};
  private heatmapFilesByDateCache: Map<string, TFile[]> | null = null;
  private heatmapFileIndexSignature = "";
  private globalRenderHeatmap: (() => void) | null = null;
  private globalRenderStatsImmediate: (() => void) | null = null;
  private logoImageReady = false;
  private logoImageSourceUrl = DEFAULT_LOGO_SVG;
  private pixelWordmarkEngines = new Map<HTMLElement, PixelWordmarkEngine>();
  private pixelWordmarkFrames = new Map<HTMLElement, number>();
  private pixelWordmarkSignatures = new WeakMap<HTMLElement, string>();

  // 初始化状态: backBurner 完成后设为 true
  private pluginReady = false;

  // 嵌入式搜索视图的清理列表
  private embeddedSearchCleanups = new Map<
    HTMLElement,
    (detachLeaf: boolean) => void
  >();
  private newTabObserver: MutationObserver | null = null;
  private newTabRenderFrame: number | null = null;
  private newTabDataRenderFrame: number | null = null;
  private newTabSettleFrames = 0;
  private newTabLayoutObservers = new Map<HTMLElement, ResizeObserver>();
  private newTabLayoutFrames = new Map<HTMLElement, number>();
  private newTabLayoutSignatures = new WeakMap<HTMLElement, string>();
  private newTabLayoutActions = new WeakMap<UnsafeEmptyView, HTMLElement>();
  private newTabLayoutActionElements = new Set<HTMLElement>();
  private layoutSwitchInProgress = false;
  private settingsTabRegistrationTimer: number | null = null;
  private settingTab: { refreshIntegratedIconPreviews: () => void } | null = null;

  async onload() {
    try {
      await this.loadSettings();
      this.customIconsIntegration = new CustomIconsIntegration(
        this.app,
        this.manifest.id,
        () => {
          if (this.pluginReady) {
            this.refreshRenderedActionIcons();
            if (this.settings.logoIcon) {
              this.applyLogoSettings();
            }
          }
          this.settingTab?.refreshIntegratedIconPreviews();
        },
      );
      await this.syncCustomIcons();
      this.syncEmptyStateDisplayMode();
      this.app.workspace.onLayoutReady(this.backBurner);

      this.registerEvent(
        this.app.workspace.on("layout-change", this.addButtonsEventHandler),
      );
      this.registerEvent(
        this.app.workspace.on("active-leaf-change", this.addButtonsEventHandler),
      );
      this.registerEvent(
        this.app.workspace.on("file-open", this.addButtonsEventHandler),
      );
      this.registerEvent(
        this.app.workspace.on("css-change", () => {
          this.getOpenNewTabContexts().forEach(({ container }) => {
            this.destroyPixelWordmark(container);
            this.ensurePixelWordmark(container);
          });
        }),
      );
      this.registerEvent(
        this.app.vault.on("delete", () => {
          this.invalidateVaultDerivedCaches();
          this.scheduleNewTabReconcile(4);
        }),
      );
      this.registerEvent(
        this.app.vault.on("create", this.invalidateVaultDerivedCaches),
      );
      this.registerEvent(
        this.app.vault.on("modify", (file) => {
          if (
            this.settings.heatmapDataSource === "file.mtime"
            && file instanceof TFile
            && file.extension === "md"
          ) {
            this.invalidateHeatmapDerivedCaches();
          }
        }),
      );
      editStyles.rewriteCssVars.iconTextGap.set(adjustInt(this.settings.iconTextGap));
      if (this.settings.centerActionListVertically) {
        editStyles.rewriteCssVars.emptyStateContainerMaxHeight.centered();
      }
      if (this.settings.deleteActionListMarginTop) {
        editStyles.rewriteCssVars.emptyStateListMarginTop.centered();
      }

      this.app.workspace.onLayoutReady(this.scheduleSettingsTabRegistration);
    } catch (error) {
      loggerOnError(error, "插件加载失败\n(About Blank)");
    }
  }

  backBurner = () => {
    try {
      // Logo 和热力图依赖 vault 文件索引, 必须在 onLayoutReady 后执行
      this.applyLogoSettings();
      this.applyHeatmapSettings(false);
      this.applyStatsSettings(false);

      // 监听 vault 索引完成事件, 重新生成热力图数据
      this.registerEvent(
        this.app.metadataCache.on('resolved', () => {
          if (
            this.settings.heatmapEnabled
            && this.settings.heatmapDataSource.startsWith("note.")
          ) {
            this.invalidateHeatmapDerivedCaches();
            if (this.getOpenNewTabContexts().length > 0) {
              this.generateHeatmapData();
            } else {
              this.globalRenderHeatmap = null;
            }
          }
        })
      );

      // 标记插件就绪, 渲染所有已等待的新标签页
      this.pluginReady = true;
      this.reconcileAllNewTabs();
      this.setupNewTabObserver();
      this.scheduleNewTabReconcile(2);
    } catch (error) {
      loggerOnError(error, "设置加载失败\n(About Blank)");
    }
  };

  onunload() {
    if (this.settingsTabRegistrationTimer !== null) {
      window.clearTimeout(this.settingsTabRegistrationTimer);
      this.settingsTabRegistrationTimer = null;
    }
    if (this.newTabObserver) {
      this.newTabObserver.disconnect();
      this.newTabObserver = null;
    }
    if (this.newTabRenderFrame !== null) {
      window.cancelAnimationFrame(this.newTabRenderFrame);
      this.newTabRenderFrame = null;
    }
    if (this.newTabDataRenderFrame !== null) {
      window.cancelAnimationFrame(this.newTabDataRenderFrame);
      this.newTabDataRenderFrame = null;
    }
    this.newTabLayoutObservers.forEach((observer) => observer.disconnect());
    this.newTabLayoutObservers.clear();
    this.newTabLayoutFrames.forEach((frame) => window.cancelAnimationFrame(frame));
    this.newTabLayoutFrames.clear();
    this.newTabLayoutActionElements.forEach((actionEl) => actionEl.remove());
    this.newTabLayoutActionElements.clear();
    this.statSortControllers.forEach((controller) => controller.destroy());
    this.statSortControllers.clear();
    this.pixelWordmarkFrames.forEach((frame) => window.cancelAnimationFrame(frame));
    this.pixelWordmarkFrames.clear();
    this.pixelWordmarkEngines.forEach((engine) => engine.destroy());
    this.pixelWordmarkEngines.clear();
    this.localHtmlBridge.close();
    this.customIconsIntegration?.destroy();
    this.settingTab = null;
    // 清理嵌入式搜索视图
    this.cleanupEmbeddedSearches(true);
    // 清理 CSS 变量
    const root = document.documentElement;
    root.style.removeProperty('--about-blank-heatmap-enabled');
    root.style.removeProperty('--about-blank-logo-image');
    root.style.removeProperty('--about-blank-logo-size');
    root.style.removeProperty('--about-blank-logo-position');
    editStyles.rewriteCssVars.iconTextGap.default();
    editStyles.rewriteCssVars.emptyStateContainerMaxHeight.default();
    editStyles.rewriteCssVars.emptyStateListMarginTop.default();
  }

  private scheduleSettingsTabRegistration = (): void => {
    if (this.settingsTabRegistrationTimer !== null) {
      return;
    }
    this.settingsTabRegistrationTimer = window.setTimeout(() => {
      this.settingsTabRegistrationTimer = null;
      void import("src/settings/settingTab")
        .then(({ AboutBlankSettingTab }) => {
          const settingTab = new AboutBlankSettingTab(this.app, this);
          this.settingTab = settingTab;
          this.addSettingTab(settingTab);
        })
        .catch((error: unknown) => {
          loggerOnError(error, "加载设置界面失败\n(About Blank)");
        });
    }, 0);
  };

  // ---------------------------------------------------------------------------

  loadSettings = async () => {
    this.settings = this.sanitizeSettingsShape(await this.loadData());
  };

  saveSettings = async () => {
    this.settings = this.sanitizeSettingsShape(this.settings);
    this.syncEmptyStateDisplayMode();
    await this.saveData(this.settings);
    // 清除热力图缓存, 确保下次渲染使用最新数据
    this.invalidateHeatmapDerivedCaches();
    this.applyLogoSettings();
    this.applyHeatmapSettings();
    this.applyStatsSettings();
    void this.syncCustomIcons();
  };

  // 保存设置但不刷新页面
  saveSettingsSilent = async () => {
    this.settings = this.sanitizeSettingsShape(this.settings);
    this.syncEmptyStateDisplayMode();
    await this.saveData(this.settings);
    void this.syncCustomIcons();
  };

  private syncCustomIcons = (): Promise<void> => {
    if (!this.customIconsIntegration) {
      return Promise.resolve();
    }
    const iconIds = Array.from(new Set(
      [
        ...this.settings.actions.map((action) => action.icon.trim()),
        this.settings.logoIcon.trim(),
      ]
        .filter((iconId) => (
          iconId.length > 0
          && (iconId.startsWith("CI-") || !iconId.includes(":"))
        )),
    )).sort();
    return this.customIconsIntegration
      .syncRequiredIcons(iconIds)
      .catch((error) => {
        loggerOnError(error, "同步 Custom Icons 图标需求失败\n(About Blank)");
      });
  };

  private applyStatsSettings = (renderImmediately = true): void => {
    this.statsCache = null;
    this.getOpenNewTabContexts().forEach(({ container }) => {
      this.destroyStatSortControllersIn(container);
      container.querySelectorAll('.about-blank-stats-bubbles')
        .forEach((element) => element.remove());
    });
    if (!this.settings.showStats) {
      this.globalRenderStatsImmediate = null;
      return;
    }
    this.createStatsBubbles(renderImmediately);
  };

  sanitizeSettingsShape = (loadedSettings: unknown): AboutBlankSettings => {
    const defaults = defaultSettingsClone();
    if (!isPlainObject(loadedSettings)) {
      return defaults;
    }

    const setProp = <T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void => {
      obj[key] = value;
    };
    const sanitizedSettings = { ...defaults } as AboutBlankSettings;
    const loadedSettingsRecord = loadedSettings as Partial<AboutBlankSettings>;
    const settingKeys = Object.keys(defaults) as Array<keyof AboutBlankSettings>;

    settingKeys.forEach((key) => {
      if (key in loadedSettingsRecord) {
        setProp(sanitizedSettings, key, loadedSettingsRecord[key] as AboutBlankSettings[typeof key]);
      }
    });

    sanitizedSettings.customStats = normalizeCustomStatDefinitions(loadedSettingsRecord.customStats);
    sanitizedSettings.dateStats = normalizeDateStatDefinitions(loadedSettingsRecord.dateStats);
    sanitizedSettings.dateStatOrder = Array.isArray(loadedSettingsRecord.dateStatOrder)
      ? loadedSettingsRecord.dateStatOrder.filter((id: unknown) => typeof id === "string")
      : [];
    sanitizedSettings.newTabLayout = normalizeNewTabLayout(
      loadedSettingsRecord.newTabLayout,
      loadedSettingsRecord,
    );
    const legacySettings = loadedSettings;
    const loadedHeatmapSource = legacySettings.heatmapDataSource;
    const legacyFrontmatterField = legacySettings.heatmapFrontmatterField;
    if (loadedHeatmapSource === "fileCreation") {
      sanitizedSettings.heatmapDataSource = "file.ctime";
    } else if (loadedHeatmapSource === "frontmatter") {
      const field = typeof legacyFrontmatterField === "string"
        ? legacyFrontmatterField.trim()
        : "created";
      sanitizedSettings.heatmapDataSource = `note.${field || "created"}`;
    } else if (
      typeof loadedHeatmapSource === "string"
      && (
        loadedHeatmapSource === "file.ctime"
        || loadedHeatmapSource === "file.mtime"
        || loadedHeatmapSource.startsWith("note.")
      )
    ) {
      sanitizedSettings.heatmapDataSource = loadedHeatmapSource;
    } else {
      sanitizedSettings.heatmapDataSource = defaults.heatmapDataSource;
    }
    sanitizedSettings.logoEnabled = true;
    sanitizedSettings.showStats = true;
    sanitizedSettings.searchBoxEnabled = true;
    sanitizedSettings.shortcutListEnabled = true;
    sanitizedSettings.heatmapEnabled = true;
    sanitizedSettings.heatmapStyle = sanitizedSettings.newTabLayout.preset === "isometric"
      ? "isometric"
      : "flat";

    return sanitizedSettings;
  };

  // ---------------------------------------------------------------------------

  private shouldRenderCustomShortcuts = (): boolean => {
    return this.settings.shortcutListEnabled && this.settings.actions.length > 0;
  };

  private syncLegacyComponentFlags = (): void => {
    this.settings.logoEnabled = true;
    this.settings.showStats = true;
    this.settings.searchBoxEnabled = true;
    this.settings.shortcutListEnabled = true;
    this.settings.heatmapEnabled = true;
    this.settings.heatmapStyle = this.settings.newTabLayout.preset === "isometric"
      ? "isometric"
      : "flat";
  };

  private getComponentShell = (
    container: HTMLElement,
    componentId: NewTabComponentId,
  ): HTMLElement | null => {
    return container.querySelector(
      `.about-blank-component[data-component-id="${componentId}"]`,
    );
  };

  private getLogoHost = (container: HTMLElement): HTMLElement | null => {
    return this.getComponentShell(
      container,
      this.settings.newTabLayout.preset === "isometric" ? "search" : "hero",
    );
  };

  private ensureBrandHost = (container: HTMLElement): HTMLElement | null => {
    const logoHost = this.getLogoHost(container);
    if (!logoHost) {
      return null;
    }
    let brandEl = logoHost.querySelector<HTMLElement>(
      ':scope > .about-blank-brand',
    );
    if (!brandEl) {
      brandEl = logoHost.createDiv({ cls: 'about-blank-brand' });
    }
    let titleEl = brandEl.querySelector<HTMLElement>(
      ':scope > .about-blank-wordmark-title',
    );
    if (!titleEl) {
      titleEl = brandEl.createDiv({ cls: 'about-blank-wordmark-title' });
    }
    titleEl.setText(this.settings.wordmarkText);
    titleEl.toggleAttribute('hidden', !this.settings.wordmarkText.trim());
    return brandEl;
  };

  private destroyPixelWordmark = (container: HTMLElement): void => {
    const frame = this.pixelWordmarkFrames.get(container);
    if (frame !== undefined) {
      (container.ownerDocument.defaultView ?? window).cancelAnimationFrame(frame);
      this.pixelWordmarkFrames.delete(container);
    }
    this.pixelWordmarkEngines.get(container)?.destroy();
    this.pixelWordmarkEngines.delete(container);
    this.pixelWordmarkSignatures.delete(container);
  };

  private ensurePixelWordmark = (container: HTMLElement): void => {
    const view = container.ownerDocument.defaultView ?? window;
    if (
      this.settings.newTabLayout.preset !== "classic"
      || view.matchMedia("(prefers-reduced-motion: reduce)").matches
      || view.matchMedia("(hover: none)").matches
    ) {
      this.destroyPixelWordmark(container);
      return;
    }
    const brandEl = this.ensureBrandHost(container);
    if (!brandEl) {
      this.destroyPixelWordmark(container);
      return;
    }
    const signature = [
      this.settings.logoPath,
      this.settings.logoSize,
      this.settings.wordmarkText,
      container.ownerDocument.body.classList.contains("theme-dark") ? "dark" : "light",
    ].join("\u0000");
    if (
      this.pixelWordmarkSignatures.get(container) === signature
      && (
        this.pixelWordmarkEngines.has(container)
        || this.pixelWordmarkFrames.has(container)
      )
    ) {
      return;
    }
    this.destroyPixelWordmark(container);
    this.pixelWordmarkSignatures.set(container, signature);
    const frame = view.requestAnimationFrame(() => {
      this.pixelWordmarkFrames.delete(container);
      if (
        !container.isConnected
        || this.pixelWordmarkSignatures.get(container) !== signature
      ) {
        return;
      }
      const engine = new PixelWordmarkEngine(brandEl);
      this.pixelWordmarkEngines.set(container, engine);
      void engine.build()
        .then((active) => {
          if (
            !active
            || this.pixelWordmarkSignatures.get(container) !== signature
          ) {
            engine.destroy();
            if (this.pixelWordmarkEngines.get(container) === engine) {
              this.pixelWordmarkEngines.delete(container);
              this.pixelWordmarkSignatures.delete(container);
            }
          }
        })
        .catch((error: unknown) => {
          engine.destroy();
          if (this.pixelWordmarkEngines.get(container) === engine) {
            this.pixelWordmarkEngines.delete(container);
            this.pixelWordmarkSignatures.delete(container);
          }
          loggerOnError(error, "构建像素 Logo 失败\n(About Blank)");
        });
    });
    this.pixelWordmarkFrames.set(container, frame);
  };

  private getStatsHost = (container: HTMLElement): HTMLElement | null => {
    if (this.settings.newTabLayout.preset === "isometric") {
      return this.getComponentShell(container, "heatmap");
    }
    return container.querySelector('.about-blank-component-stack');
  };

  private syncComponentStackStructure = (
    container: HTMLElement,
    actionListEl: HTMLElement,
  ): HTMLElement => {
    let stackEl = container.querySelector<HTMLElement>('.about-blank-component-stack');
    if (!stackEl) {
      stackEl = container.createDiv({ cls: 'about-blank-component-stack' });
    }
    NEW_TAB_LAYOUT_PRESETS.forEach((preset) => {
      container.classList.toggle(
        `about-blank-layout-${preset}`,
        preset === this.settings.newTabLayout.preset,
      );
    });
    if (stackEl.dataset.layoutPreset !== this.settings.newTabLayout.preset) {
      stackEl.dataset.layoutPreset = this.settings.newTabLayout.preset;
    }

    const componentIds = getPresetComponentOrder(this.settings.newTabLayout.preset);
    const activeComponentIds = new Set(componentIds);
    Array.from(stackEl.children).forEach((child) => {
      if (!(child instanceof HTMLElement) || !child.classList.contains('about-blank-component')) {
        return;
      }
      const componentId = child.dataset.componentId as NewTabComponentId | undefined;
      if (componentId && !activeComponentIds.has(componentId)) {
        if (componentId === "shortcuts" && child.contains(actionListEl)) {
          container.insertBefore(actionListEl, stackEl.nextSibling);
        }
        child.remove();
      }
    });

    componentIds.forEach((componentId, index) => {
      let componentEl = this.getComponentShell(container, componentId);
      if (!componentEl) {
        componentEl = createDiv({ cls: 'about-blank-component' });
        componentEl.dataset.componentId = componentId;
      }
      componentEl.classList.add(`about-blank-component-${componentId}`);
      const currentElementAtIndex = stackEl?.children.item(index);
      if (stackEl && currentElementAtIndex !== componentEl) {
        stackEl.insertBefore(componentEl, currentElementAtIndex ?? null);
      }
    });

    const searchEl = this.getComponentShell(container, "search");
    const heatmapEl = this.getComponentShell(container, "heatmap");
    const logoHost = this.ensureBrandHost(container);
    const statsHost = this.getStatsHost(container);
    if (logoHost) {
      container.querySelectorAll('.about-blank-logo')
        .forEach((element) => {
          if (element.parentElement !== logoHost) {
            logoHost.appendChild(element);
          }
        });
    }
    if (statsHost) {
      container.querySelectorAll('.about-blank-stats-bubbles')
        .forEach((element) => {
          if (element instanceof HTMLElement && element.parentElement !== statsHost) {
            statsHost.appendChild(element);
          }
        });
    }
    const embeddedSearchEl = container.querySelector('.about-blank-embedded-search');
    if (searchEl && embeddedSearchEl && embeddedSearchEl.parentElement !== searchEl) {
      searchEl.appendChild(embeddedSearchEl);
    }

    const shortcutsEl = this.getComponentShell(container, "shortcuts");
    if (shortcutsEl && actionListEl.parentElement !== shortcutsEl) {
      shortcutsEl.appendChild(actionListEl);
    }

    const heatmapContainer = container.querySelector('.about-blank-heatmap-container');
    if (heatmapEl && heatmapContainer && heatmapContainer.parentElement !== heatmapEl) {
      heatmapEl.appendChild(heatmapContainer);
    }

    return stackEl;
  };

  private ensureLayoutSwitcher = (emptyView: UnsafeEmptyView): void => {
    this.newTabLayoutActionElements.forEach((actionEl) => {
      if (!actionEl.isConnected) {
        this.newTabLayoutActionElements.delete(actionEl);
      }
    });
    const existingAction = this.newTabLayoutActions.get(emptyView);
    if (existingAction?.isConnected) {
      return;
    }
    if (existingAction) {
      this.newTabLayoutActionElements.delete(existingAction);
    }

    const actionEl = emptyView.addAction(
      "layout-template",
      "切换新标签页样式",
      () => {
        void this.toggleLayoutPreset();
      },
    );
    actionEl.addClass("about-blank-layout-switcher-action");
    this.newTabLayoutActions.set(emptyView, actionEl);
    this.newTabLayoutActionElements.add(actionEl);
  };

  private toggleLayoutPreset = async (): Promise<void> => {
    if (this.layoutSwitchInProgress) {
      return;
    }
    this.layoutSwitchInProgress = true;
    const nextPreset: NewTabLayoutPreset =
      this.settings.newTabLayout.preset === "isometric"
        ? "classic"
        : "isometric";
    try {
      await this.applyLayoutPreset(nextPreset);
    } finally {
      this.layoutSwitchInProgress = false;
    }
  };

  private applyLayoutPreset = async (
    preset: NewTabLayoutPreset,
  ): Promise<void> => {
    if (this.settings.newTabLayout.preset === preset) {
      return;
    }

    const previousPreset = this.settings.newTabLayout.preset;
    const contexts = this.getOpenNewTabContexts();
    contexts.forEach(({ container }) => {
      container.classList.add("about-blank-layout-is-switching");
    });
    try {
      this.settings.newTabLayout = createNewTabLayout(preset);
      this.syncLegacyComponentFlags();
      await this.saveSettingsSilent();
      this.refreshAllNewTabs();
    } catch (error) {
      this.settings.newTabLayout = createNewTabLayout(previousPreset);
      this.syncLegacyComponentFlags();
      this.refreshAllNewTabs();
      loggerOnError(error, "切换新标签页布局失败\n(About Blank)");
    } finally {
      window.setTimeout(() => {
        this.getOpenNewTabContexts().forEach(({ container }) => {
          container.classList.remove("about-blank-layout-is-switching");
        });
      }, 260);
    }
  };

  private ensureAdaptiveLayout = (container: HTMLElement): void => {
    if (this.newTabLayoutObservers.has(container)) {
      this.scheduleAdaptiveLayout(container);
      return;
    }

    const observer = new ResizeObserver(() => {
      this.scheduleAdaptiveLayout(container);
    });
    observer.observe(container);
    const stackEl = container.querySelector('.about-blank-component-stack');
    if (stackEl instanceof HTMLElement) {
      observer.observe(stackEl);
    }
    this.newTabLayoutObservers.set(container, observer);
    this.scheduleAdaptiveLayout(container);
  };

  private scheduleAdaptiveLayout = (container: HTMLElement): void => {
    if (this.newTabLayoutFrames.has(container)) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      this.newTabLayoutFrames.delete(container);
      this.updateAdaptiveLayout(container);
    });
    this.newTabLayoutFrames.set(container, frame);
  };

  private updateAdaptiveLayout = (container: HTMLElement): void => {
    const stackEl = container.querySelector<HTMLElement>('.about-blank-component-stack');
    if (!stackEl || !container.isConnected) {
      return;
    }

    const componentIds = getPresetComponentOrder(this.settings.newTabLayout.preset);
    const preset = this.settings.newTabLayout.preset;
    const gap = componentIds.length > 1 ? 8 : 0;
    const availableHeight = Math.max(0, stackEl.clientHeight - gap * Math.max(0, componentIds.length - 1));
    const heights = new Map<NewTabComponentId, { min: number; preferred: number }>();

    componentIds.forEach((componentId) => {
      if (componentId === "hero") {
        if (preset === "isometric") {
          heights.set(componentId, { min: 0, preferred: 0 });
        } else {
          const preferred = Math.min(
            300,
            Math.max(190, Math.min(150, this.settings.logoSize) + 84),
          );
          heights.set(componentId, { min: 170, preferred });
        }
        return;
      }
      if (componentId === "search") {
        heights.set(
          componentId,
          preset === "isometric"
            ? { min: 78, preferred: 86 }
            : { min: 68, preferred: 76 },
        );
        return;
      }
      if (componentId === "shortcuts") {
        const componentEl = this.getComponentShell(container, componentId);
        const measuredHeight = componentEl?.querySelector('.empty-state-action-list')?.scrollHeight ?? 72;
        heights.set(componentId, {
          min: 58,
          preferred: Math.min(132, Math.max(72, measuredHeight + 12)),
        });
        return;
      }
      heights.set(
        componentId,
        preset === "isometric"
          ? { min: 360, preferred: 560 }
          : { min: 130, preferred: 170 },
      );
    });

    const allocations = new Map<NewTabComponentId, number>();
    let totalPreferred = 0;
    let totalMinimum = 0;
    componentIds.forEach((componentId) => {
      const sizing = heights.get(componentId);
      if (!sizing) {
        return;
      }
      allocations.set(componentId, sizing.preferred);
      totalPreferred += sizing.preferred;
      totalMinimum += sizing.min;
    });

    let overflow = Math.max(0, totalPreferred - availableHeight);
    const shrinkOrder: NewTabComponentId[] = ["hero", "shortcuts", "heatmap", "search"];
    shrinkOrder.forEach((componentId) => {
      if (overflow <= 0 || !allocations.has(componentId)) {
        return;
      }
      const sizing = heights.get(componentId);
      const currentHeight = allocations.get(componentId);
      if (!sizing || currentHeight === undefined) {
        return;
      }
      const reduction = Math.min(overflow, currentHeight - sizing.min);
      allocations.set(componentId, currentHeight - reduction);
      overflow -= reduction;
    });

    const needsScrollFallback = totalMinimum > availableHeight;
    const isCompact = totalPreferred > availableHeight;
    const resolvedHeights = componentIds.map((componentId) => {
      const sizing = heights.get(componentId);
      const height = needsScrollFallback ? sizing?.min : allocations.get(componentId);
      return [componentId, height === undefined ? null : Math.round(height)] as const;
    });
    const layoutSignature = [
      preset,
      needsScrollFallback ? 'scroll' : 'fit',
      isCompact ? 'compact' : 'regular',
      ...resolvedHeights.map(([componentId, height]) => `${componentId}:${height ?? 'auto'}`),
    ].join('|');
    if (this.newTabLayoutSignatures.get(container) === layoutSignature) {
      return;
    }
    this.newTabLayoutSignatures.set(container, layoutSignature);

    stackEl.classList.toggle('about-blank-component-stack-needs-scroll', needsScrollFallback);
    container.classList.toggle('about-blank-layout-is-compact', isCompact);

    resolvedHeights.forEach(([componentId, height]) => {
      const componentEl = this.getComponentShell(container, componentId);
      if (!componentEl || height === null) {
        return;
      }
      componentEl.style.setProperty('--about-blank-component-height', `${height}px`);
    });
    const classicStatsEl = preset === "classic"
      ? stackEl.querySelector<HTMLElement>(
        ':scope > .about-blank-stats-bubbles',
      )
      : null;
    if (classicStatsEl) {
      this.destroyStatSortControllersIn(classicStatsEl);
      classicStatsEl.remove();
      (container.ownerDocument.defaultView ?? window).requestAnimationFrame(() => {
        if (container.isConnected) {
          this.globalRenderStatsImmediate?.();
        }
      });
    }
  };

  private getOpenNewTabContexts = (): Array<{
    emptyView: UnsafeEmptyView;
    actionListEl: HTMLElement;
    container: HTMLElement;
  }> => {
    const contexts: Array<{
      emptyView: UnsafeEmptyView;
      actionListEl: HTMLElement;
      container: HTMLElement;
    }> = [];

    this.app.workspace.getLeavesOfType(UNSAFE_VIEW_TYPES.empty).forEach((leaf) => {
      if (leaf.isDeferred) {
        return;
      }
      const emptyView = leaf.view as UnsafeEmptyView;
      const actionListEl = emptyView.actionListEl;
      const container = actionListEl?.closest('.empty-state-container');
      if (actionListEl && container instanceof HTMLElement) {
        contexts.push({ emptyView, actionListEl, container });
      }
    });
    return contexts;
  };

  private syncEmptyStateDisplayMode = (): void => {
    editStyles.rewriteCssVars.emptyStateDisplay.hide();
  };

  private getDefaultActionElements = (actionListEl: HTMLElement): HTMLElement[] => {
    return Array.from(actionListEl.children).filter((child): child is HTMLElement => {
      return child instanceof HTMLElement && !child.classList.contains(CSS_CLASSES.aboutBlankContainer);
    });
  };

  private syncActionListPresentation = (emptyView: UnsafeEmptyView, actionListEl: HTMLElement): void => {
    const shouldShowShortcutSection = this.shouldRenderCustomShortcuts();

    actionListEl.toggleAttribute('hidden', !shouldShowShortcutSection);

    if (shouldShowShortcutSection) {
      emptyView.emptyTitleEl.classList.add(CSS_CLASSES.visible);
    } else {
      emptyView.emptyTitleEl.classList.remove(CSS_CLASSES.visible);
    }

    actionListEl.classList.toggle('about-blank-card-grid', shouldShowShortcutSection);

    this.getDefaultActionElements(actionListEl).forEach((actionEl) => {
      actionEl.classList.remove(CSS_CLASSES.visible);
      actionEl.setAttribute('hidden', 'true');
    });
  };

  private cleanupRenderedNewTab = (emptyView: UnsafeEmptyView, container: HTMLElement | null): void => {
    const actionListEl = emptyView.actionListEl;
    if (!actionListEl) {
      return;
    }

    if (container) {
      this.destroyPixelWordmark(container);
    }

    const componentStack = container?.querySelector('.about-blank-component-stack');
    if (container) {
      this.newTabLayoutObservers.get(container)?.disconnect();
      this.newTabLayoutObservers.delete(container);
      const layoutFrame = this.newTabLayoutFrames.get(container);
      if (layoutFrame !== undefined) {
        window.cancelAnimationFrame(layoutFrame);
        this.newTabLayoutFrames.delete(container);
      }
      this.newTabLayoutSignatures.delete(container);
    }
    if (componentStack?.contains(actionListEl) && componentStack.parentElement) {
      componentStack.parentElement.insertBefore(actionListEl, componentStack);
    }
    actionListEl.classList.remove('about-blank-card-grid');
    Array.from(actionListEl.children).forEach((child) => {
      const actionEl = child as HTMLElement;
      if (actionEl.classList.contains(CSS_CLASSES.aboutBlankContainer)) {
        actionEl.remove();
        return;
      }
      actionEl.removeAttribute('hidden');
      actionEl.classList.remove(CSS_CLASSES.visible);
    });

    emptyView.emptyTitleEl?.classList.remove(CSS_CLASSES.visible);

    container?.classList.remove('about-blank-managed');
    container?.classList.remove(
      'about-blank-stats-bubble-mode',
      'about-blank-loading',
      'about-blank-layout-pending',
      'about-blank-ready',
    );
    container?.querySelector('.about-blank-loader')?.remove();
    container?.querySelectorAll('.about-blank-logo').forEach((el) => el.remove());
    container?.querySelectorAll('.about-blank-embedded-search').forEach((el) => el.remove());
    container?.querySelectorAll('.about-blank-heatmap-container').forEach((el) => el.remove());
    if (container) {
      this.destroyStatSortControllersIn(container);
    }
    container?.querySelectorAll('.about-blank-stats-bubbles').forEach((el) => el.remove());
    componentStack?.remove();
  };

  private cleanupEmbeddedSearches = (detachLeaves: boolean): void => {
    this.embeddedSearchCleanups.forEach((cleanup) => cleanup(detachLeaves));
    this.embeddedSearchCleanups.clear();
  };

  private pruneDetachedNewTabResources = (): void => {
    this.newTabLayoutObservers.forEach((observer, container) => {
      if (container.isConnected) {
        return;
      }
      observer.disconnect();
      this.newTabLayoutObservers.delete(container);
      const frame = this.newTabLayoutFrames.get(container);
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
        this.newTabLayoutFrames.delete(container);
      }
      this.newTabLayoutSignatures.delete(container);
    });
    this.embeddedSearchCleanups.forEach((cleanup, host) => {
      if (!host.isConnected) {
        cleanup(true);
      }
    });
    this.statSortControllers.forEach((controller, rootEl) => {
      if (!rootEl.isConnected) {
        controller.destroy();
        this.statSortControllers.delete(rootEl);
      }
    });
    this.pixelWordmarkEngines.forEach((engine, container) => {
      if (!container.isConnected) {
        engine.destroy();
        this.pixelWordmarkEngines.delete(container);
        this.pixelWordmarkSignatures.delete(container);
      }
    });
    this.pixelWordmarkFrames.forEach((frame, container) => {
      if (!container.isConnected) {
        window.cancelAnimationFrame(frame);
        this.pixelWordmarkFrames.delete(container);
        this.pixelWordmarkSignatures.delete(container);
      }
    });
  };

  private parseFrontmatterDate = (value: unknown): Date | null => {
    if (!(typeof value === "string" || typeof value === "number" || value instanceof Date)) {
      return null;
    }

    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }

    return parsedDate;
  };

  private invalidateVaultDerivedCaches = (): void => {
    this.statsCache = null;
    this.invalidateHeatmapDerivedCaches();
  };

  private invalidateHeatmapDerivedCaches = (): void => {
    this.heatmapDataCache = null;
    this.heatmapFilesByDateCache = null;
    this.heatmapFileIndexSignature = "";
    this.heatmapYearCache = {};
  };

  private getHeatmapDateForFile = (file: TFile): Date | null => {
    const cache = this.app.metadataCache.getFileCache(file);
    return this.parseFrontmatterDate(
      getCustomStatFieldValue(
        { file, cache },
        this.settings.heatmapDataSource,
      ),
    );
  };

  private toHeatmapDateString = (date: Date): string | null => {
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return new Date(Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    )).toISOString().split('T')[0];
  };

  private getHeatmapFilesByDate = (): Map<string, TFile[]> => {
    const signature = this.settings.heatmapDataSource;
    if (
      this.heatmapFilesByDateCache
      && this.heatmapFileIndexSignature === signature
    ) {
      return this.heatmapFilesByDateCache;
    }

    const filesByDate = new Map<string, TFile[]>();
    this.app.vault.getMarkdownFiles().forEach((file) => {
      const fileDate = this.getHeatmapDateForFile(file);
      const dateString = fileDate ? this.toHeatmapDateString(fileDate) : null;
      if (!dateString) {
        return;
      }
      const files = filesByDate.get(dateString);
      if (files) {
        files.push(file);
      } else {
        filesByDate.set(dateString, [file]);
      }
    });

    this.heatmapFilesByDateCache = filesByDate;
    this.heatmapFileIndexSignature = signature;
    return filesByDate;
  };

  private createHeatmapYearData = (year: number): HeatmapDateCountMap => {
    const dateCountMap: HeatmapDateCountMap = {};
    const currentDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year, 11, 31));
    while (currentDate <= endDate) {
      dateCountMap[currentDate.toISOString().split('T')[0]] = 0;
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    const yearPrefix = `${year}-`;
    this.getHeatmapFilesByDate().forEach((files, dateString) => {
      if (dateString.startsWith(yearPrefix)) {
        dateCountMap[dateString] = files.length;
      }
    });
    return dateCountMap;
  };

  // ---------------------------------------------------------------------------

  refreshAllNewTabs = (): void => {
    this.syncEmptyStateDisplayMode();
    const activeLeaf = this.app.workspace.getMostRecentLeaf();
    const emptyLeaves = this.app.workspace.getLeavesOfType(UNSAFE_VIEW_TYPES.empty);
    if (emptyLeaves.length === 0) {
      return;
    }

    // 清理所有嵌入搜索视图
    this.cleanupEmbeddedSearches(true);

    emptyLeaves.forEach((leaf) => {
      const emptyView = leaf.view as UnsafeEmptyView;
      const actionListEl = emptyView.actionListEl;
      const container = actionListEl?.closest('.empty-state-container');
      this.cleanupRenderedNewTab(emptyView, container instanceof HTMLElement ? container : null);
    });

    // 如果插件就绪, 重新渲染所有标签页
    if (this.pluginReady) {
      emptyLeaves.forEach((leaf) => {
        const emptyView = leaf.view as UnsafeEmptyView;
        const actionListEl = emptyView.actionListEl;
        if (!actionListEl) return;
        const container = actionListEl.closest('.empty-state-container');
        this.renderNewTabContent(emptyView, container instanceof HTMLElement ? container : null);
      });
    }

    this.restoreActiveLeaf(activeLeaf);
  };

  private restoreActiveLeaf = (leaf: WorkspaceLeaf | null): void => {
    if (!leaf || this.app.workspace.getMostRecentLeaf() === leaf) {
      return;
    }

    window.setTimeout(() => {
      try {
        this.app.workspace.setActiveLeaf(leaf, { focus: false });
      } catch (error) {
        loggerOnError(error, "恢复活动视图失败\n(About Blank)");
      }
    }, 0);
  };

  private addButtonsEventHandler = (): void => {
    this.scheduleNewTabReconcile(2);
  };

  private addButtonsToNewTab = (emptyView: UnsafeEmptyView): void => {
    try {
      const emptyActionListEl = emptyView.actionListEl;
      const childElements = emptyActionListEl
        ? Array.from(emptyActionListEl.children) as HTMLElement[]
        : null;
      if (!emptyActionListEl || !childElements || !emptyActionListEl.isConnected) {
        return;
      }

      const container = emptyActionListEl.closest('.empty-state-container');
      if (!(container instanceof HTMLElement)) {
        return;
      }

      if (!this.pluginReady) {
        // 插件尚未就绪: 显示进度条, 等待 backBurner 完成后统一渲染
        if (container && !container.classList.contains('about-blank-loading')) {
          container.classList.add('about-blank-loading');
          const loader = document.createElement('div');
          loader.className = 'about-blank-loader';
          const loaderBar = loader.createEl('div', { cls: 'about-blank-loader-bar' });
          loaderBar.createEl('div', { cls: 'about-blank-loader-bar-fill' });
          container.appendChild(loader);
        }
        return;
      }

      // 插件就绪: 一次性渲染所有内容
      this.renderNewTabContent(emptyView, container);
    } catch (error) {
      loggerOnError(error, "在空文件视图 (新标签页) 中添加按钮失败\n(About Blank)");
    }
  };

  private reconcileAllNewTabs = (): void => {
    if (!this.pluginReady) {
      return;
    }
    this.pruneDetachedNewTabResources();

    this.app.workspace.getLeavesOfType(UNSAFE_VIEW_TYPES.empty).forEach((leaf) => {
      if (!leaf.isDeferred) {
        this.addButtonsToNewTab(leaf.view as UnsafeEmptyView);
      }
    });
  };

  private scheduleNewTabDataRender = (): void => {
    if (this.newTabDataRenderFrame !== null) {
      return;
    }
    this.newTabDataRenderFrame = window.requestAnimationFrame(() => {
      this.newTabDataRenderFrame = null;
      if (this.settings.heatmapEnabled) {
        if (this.heatmapDataCache) {
          this.globalRenderHeatmap?.();
        } else {
          this.generateHeatmapData();
        }
      }
      if (this.settings.showStats) {
        this.globalRenderStatsImmediate?.();
      }
    });
  };

  private scheduleNewTabReconcile = (settleFrames = 0): void => {
    this.newTabSettleFrames = Math.max(this.newTabSettleFrames, settleFrames);
    if (this.newTabRenderFrame !== null) {
      return;
    }

    this.newTabRenderFrame = window.requestAnimationFrame(() => {
      this.newTabRenderFrame = null;
      this.reconcileAllNewTabs();

      if (this.newTabSettleFrames > 0) {
        this.newTabSettleFrames -= 1;
        this.scheduleNewTabReconcile();
      }
    });
  };

  private setupNewTabObserver = (): void => {
    this.newTabObserver?.disconnect();
    this.newTabObserver = new MutationObserver((mutations) => {
      let shouldReconcile = false;
      const emptyViewStructuralSelector = [
        '.empty-state-container',
        '.workspace-leaf-content[data-type="empty"]',
      ].join(', ');
      const actionListSelector = '.empty-state-action-list';
      const managedRootSelector = [
        '.about-blank-component-stack',
        '.about-blank-embedded-search',
        actionListSelector,
      ].join(', ');
      const structuralSelector = `${emptyViewStructuralSelector}, ${managedRootSelector}`;

      for (const mutation of mutations) {
        if (mutation.type !== 'childList') {
          continue;
        }

        const target = mutation.target instanceof HTMLElement
          ? mutation.target
          : mutation.target.parentElement;
        const targetIsActionList = target?.matches(actionListSelector) ?? false;
        const changedNodes = [
          ...Array.from(mutation.addedNodes),
          ...Array.from(mutation.removedNodes),
        ];

        if (
          target?.closest('.empty-state-container.about-blank-managed')
          && !targetIsActionList
          && !changedNodes.some((node) => (
            node instanceof HTMLElement
            && (
              node.matches(structuralSelector)
              || node.querySelector(structuralSelector)
            )
          ))
        ) {
          continue;
        }

        const hasStructuralChange = changedNodes.some((node) => (
          node instanceof HTMLElement
          && (
            node.matches(structuralSelector)
            || node.querySelector(structuralSelector)
          )
        ));

        if (targetIsActionList || hasStructuralChange) {
          shouldReconcile = true;
          break;
        }
      }

      if (shouldReconcile) {
        this.scheduleNewTabReconcile(2);
      }
    });

    this.newTabObserver.observe(this.app.workspace.containerEl, {
      childList: true,
      subtree: true,
    });
  };

  // 统一渲染: Logo + 统计 + 搜索框 + 按钮 + 热力图, 按用户要求从上到下排列
  private renderNewTabContent = (emptyView: UnsafeEmptyView, container: HTMLElement | null): void => {
    const emptyActionListEl = emptyView.actionListEl;
    if (!emptyActionListEl) return;

    const heatmapComponent = container
      ? this.getComponentShell(container, "heatmap")
      : null;
    const needsIsometricFirstPaint = Boolean(
      container
      && this.settings.newTabLayout.preset === "isometric"
      && (
        !heatmapComponent
        || !heatmapComponent.style.getPropertyValue('--about-blank-component-height')
      ),
    );
    if (needsIsometricFirstPaint && container) {
      this.newTabLayoutObservers.get(container)?.disconnect();
      this.newTabLayoutObservers.delete(container);
      const pendingLayoutFrame = this.newTabLayoutFrames.get(container);
      if (pendingLayoutFrame !== undefined) {
        window.cancelAnimationFrame(pendingLayoutFrame);
        this.newTabLayoutFrames.delete(container);
      }
      this.newTabLayoutSignatures.delete(container);
      container.classList.remove('about-blank-ready');
      container.classList.add('about-blank-layout-pending');
    }

    container?.classList.add('about-blank-managed');
    if (container) {
      this.syncComponentStackStructure(container, emptyActionListEl);
      this.ensureLayoutSwitcher(emptyView);
      this.ensureAdaptiveLayout(container);
    }

    this.syncActionListPresentation(emptyView, emptyActionListEl);

    const childElements = Array.from(emptyActionListEl.children) as HTMLElement[];
    const hasCustomShortcuts = childElements.some((element) => (
      element.classList.contains(CSS_CLASSES.aboutBlankContainer)
    ));

    // 1. 应用 Logo 样式 (顶部)
    this.applyLogoClassToContainer(emptyActionListEl);

    // 2. 嵌入搜索框 (统计下方, 按钮上方)
    if (this.settings.searchBoxEnabled) {
      this.createEmbeddedSearch(emptyActionListEl, emptyView);
    }

    // 3. 添加按钮 (搜索框下方)
    if (this.shouldRenderCustomShortcuts() && !hasCustomShortcuts) {
      const practicalActions: PracticalAction[] = this.settings.actions
        .map((action) => toPracticalAction(this.app, action, this.localHtmlBridge))
        .filter((action) => action !== undefined);
      this.addActionButtonsAsCards(emptyActionListEl, practicalActions);
    }

    // 4. 在同一绘制周期渲染热力图和统计项
    if (
      this.settings.heatmapEnabled
      || (
        this.settings.showStats
        && this.globalRenderStatsImmediate
        && !container?.querySelector('.about-blank-stats-bubbles')
      )
    ) {
      this.scheduleNewTabDataRender();
    }

    // 渲染完成: 移除加载动画, 淡入显示
    if (container) {
      container.classList.remove('about-blank-loading');
      const loaderEl = container.querySelector('.about-blank-loader');
      if (loaderEl) loaderEl.remove();
      this.syncComponentStackStructure(container, emptyActionListEl);
      if (container.classList.contains('about-blank-layout-pending')) {
        requestAnimationFrame(() => {
          if (!container.isConnected) {
            return;
          }
          this.updateAdaptiveLayout(container);
          this.syncComponentStackStructure(container, emptyActionListEl);
          requestAnimationFrame(() => {
            if (!container.isConnected) {
              return;
            }
            container.classList.remove('about-blank-layout-pending');
            container.classList.add('about-blank-ready');
          });
        });
      } else {
        container.classList.add('about-blank-ready');
        requestAnimationFrame(() => {
          if (container.isConnected) {
            this.syncComponentStackStructure(container, emptyActionListEl);
          }
        });
      }
    }
  };

  // 卡片网格样式按钮
  private addActionButtonsAsCards = (actionListEl: HTMLElement, actions: PracticalAction[]): void => {
    // 为 action list 添加卡片网格标记
    actionListEl.classList.add('about-blank-card-grid');

    actions.forEach((action) => {
      const card = actionListEl.createEl(
        "div",
        {
          cls: `about-blank-card-item ${CSS_CLASSES.visible} ${CSS_CLASSES.aboutBlankContainer}`,
        },
        (elem: Element) => {
          elem.addEventListener("click", () => {
            void action.callback();
          });
        },
      );

      card.setAttribute('aria-label', action.name);
      card.removeAttribute('title');

      const iconEl = card.createEl("div", { cls: "about-blank-card-icon" });
      this.renderActionIcon(iconEl, action.icon);

      card.createEl("div", {
        cls: "about-blank-card-label",
        text: action.name,
      });
    });
  };

  private renderActionIcon = (iconEl: HTMLElement, iconName: string): void => {
    iconEl.empty();
    if (isFalsyString(iconName)) {
      return;
    }

    if (this.customIconsIntegration.renderIcon(iconEl, iconName)) {
      return;
    }

    try {
      setIcon(iconEl, iconName);
      if (!iconEl.querySelector("svg")) {
        setIcon(iconEl, "help-circle");
      }
    } catch {
      setIcon(iconEl, "help-circle");
    }
  };

  private refreshRenderedActionIcons = (): void => {
    const actions = this.settings.actions
      .map((action) => toPracticalAction(this.app, action, this.localHtmlBridge))
      .filter((action) => action !== undefined);
    this.getOpenNewTabContexts().forEach(({ actionListEl }) => {
      const cards = Array.from(
        actionListEl.querySelectorAll<HTMLElement>('.about-blank-card-item'),
      );
      cards.forEach((card, index) => {
        const action = actions[index];
        const iconEl = card.querySelector<HTMLElement>('.about-blank-card-icon');
        if (action && iconEl) {
          this.renderActionIcon(iconEl, action.icon);
        }
      });
    });
  };

  // 嵌入搜索框到新标签页 (Float Search 原生搜索引擎)
  //
  // DOM 结构:
  //   .about-blank-embedded-search        ← 占位器 (56px 流式布局)
  //     .about-blank-search-panel         ← 绝对定位面板 (56px 折叠 / 420px 展开)
  //       workspace-split > ... > search  ← Obsidian 原生搜索视图
  //
  private createEmbeddedSearch = (actionListEl: HTMLElement, _emptyView: UnsafeEmptyView): void => {
    try {
      const container = actionListEl.closest('.empty-state-container');
      const searchComponent = container instanceof HTMLElement
        ? this.getComponentShell(container, "search")
        : null;
      const existingSearch = searchComponent?.querySelector('.about-blank-embedded-search');
      if (existingSearch) {
        return;
      }
      if (!searchComponent) {
        return;
      }
      const componentStack = searchComponent.closest('.about-blank-component-stack');
      const ownerDocument = searchComponent.ownerDocument;
      const ownerWindow = ownerDocument.defaultView ?? window;
      const previousActiveLeaf = this.app.workspace.getMostRecentLeaf();

      // 占位器 (固定 56px, 参与文档流)
      const placeholderEl = document.createElement("div");
      placeholderEl.className = "about-blank-embedded-search";

      // 绝对定位面板 (内含 workspace, 提供真实高度)
      const panelEl = document.createElement("div");
      panelEl.className = "about-blank-search-panel";
      placeholderEl.appendChild(panelEl);

      searchComponent.appendChild(placeholderEl);

      // --- Float Search 引擎: WorkspaceSplit + 原生搜索视图 ---
      const rootSplit = new (WorkspaceSplit as unknown as ConstructableWorkspaceSplit)(
        this.app.workspace, "vertical",
      ) as unknown as UnsafeWorkspaceSplit;
      const workspaceWithLayoutChange = this.app.workspace as unknown as UnsafeWorkspaceWithLayoutChange;
      rootSplit.getRoot = () => workspaceWithLayoutChange.rootSplit;
      rootSplit.getContainer = () => workspaceWithLayoutChange.rootSplit;

      panelEl.appendChild(rootSplit.containerEl);

      const leaf = this.app.workspace.createLeafInParent(rootSplit as WorkspaceSplit, 0);
      leaf.setPinned(true);
      let disposed = false;
      let inputWatchTimer: number | null = null;
      let nativeInput: HTMLInputElement | null = null;
      let onDocClick: ((event: MouseEvent) => void) | null = null;
      const searchBoundsEl = container instanceof HTMLElement ? container : searchComponent;
      const expandedSearchHeight = 420;
      const searchBoundaryGap = 12;

      const updateSearchPanelPlacement = () => {
        const boundsRect = searchBoundsEl.getBoundingClientRect();
        const placeholderRect = placeholderEl.getBoundingClientRect();
        const viewportBottom = Math.min(
          boundsRect.bottom,
          ownerWindow.innerHeight,
        );
        const availableHeightBelow = Math.floor(
          viewportBottom - placeholderRect.top - searchBoundaryGap,
        );
        const opensUpward = availableHeightBelow < expandedSearchHeight;
        const panelTop = opensUpward
          ? placeholderRect.bottom - boundsRect.top - expandedSearchHeight
          : placeholderRect.top - boundsRect.top;
        const panelLeft = Math.max(
          0,
          Math.min(
            placeholderRect.left - boundsRect.left,
            boundsRect.width - placeholderRect.width,
          ),
        );
        placeholderEl.classList.toggle("opens-upward", opensUpward);
        panelEl.classList.toggle("opens-upward", opensUpward);
        panelEl.style.setProperty(
          "--about-blank-search-panel-top",
          `${panelTop}px`,
        );
        panelEl.style.setProperty(
          "--about-blank-search-panel-left",
          `${panelLeft}px`,
        );
        panelEl.style.setProperty(
          "--about-blank-search-panel-width",
          `${placeholderRect.width}px`,
        );
      };
      const expandSearchPanel = () => {
        updateSearchPanelPlacement();
        placeholderEl.classList.add("is-expanded");
        panelEl.classList.add("is-expanded");
        if (panelEl.parentElement !== searchBoundsEl) {
          searchBoundsEl.appendChild(panelEl);
        }
        componentStack?.classList.add("about-blank-search-is-expanded");
      };
      const collapseSearchPanel = () => {
        panelEl.classList.remove("is-expanded", "opens-upward");
        panelEl.style.removeProperty("--about-blank-search-panel-top");
        panelEl.style.removeProperty("--about-blank-search-panel-left");
        panelEl.style.removeProperty("--about-blank-search-panel-width");
        if (panelEl.parentElement !== placeholderEl) {
          placeholderEl.appendChild(panelEl);
        }
        placeholderEl.classList.remove("is-expanded");
        placeholderEl.classList.remove("opens-upward");
        componentStack?.classList.remove("about-blank-search-is-expanded");
      };
      const onSearchViewportResize = () => {
        if (placeholderEl.classList.contains("is-expanded")) {
          updateSearchPanelPlacement();
        }
      };
      ownerWindow.addEventListener("resize", onSearchViewportResize);
      ownerDocument.addEventListener("scroll", onSearchViewportResize, true);
      const cleanupEmbeddedSearch = (detachLeaf: boolean) => {
        if (disposed) {
          return;
        }
        disposed = true;
        this.embeddedSearchCleanups.delete(placeholderEl);
        if (inputWatchTimer !== null) {
          ownerWindow.clearTimeout(inputWatchTimer);
          inputWatchTimer = null;
        }
        if (onDocClick) {
          ownerDocument.removeEventListener("click", onDocClick, true);
        }
        panelEl.removeEventListener("focusin", expandSearchPanel);
        panelEl.removeEventListener("pointerdown", expandSearchPanel);
        nativeInput?.removeEventListener("focus", expandSearchPanel);
        ownerWindow.removeEventListener("resize", onSearchViewportResize);
        ownerDocument.removeEventListener("scroll", onSearchViewportResize, true);
        componentStack?.classList.remove("about-blank-search-is-expanded");
        if (detachLeaf) {
          leaf.detach();
        }
        panelEl.remove();
        placeholderEl.remove();
      };
      this.embeddedSearchCleanups.set(placeholderEl, cleanupEmbeddedSearch);

      void leaf.setViewState({
        type: "search",
        active: false,
        state: { query: "", triggerBySelf: true },
      }).then(() => {
        if (disposed) {
          return;
        }
        workspaceWithLayoutChange.onLayoutChange();
        ownerWindow.setTimeout(() => {
          if (disposed) {
            return;
          }
          const searchView = leaf.view as UnsafeStatefulView | null;
          if (searchView) {
            void Promise.resolve(searchView.setState(
              { query: "", triggerBySelf: true },
              { history: false },
            )).catch((error: unknown) => {
              loggerOnError(error, "同步嵌入搜索状态失败\n(About Blank)");
            });
          }
          this.restoreActiveLeaf(previousActiveLeaf);
        }, 0);
      }).catch((error: unknown) => {
        this.restoreActiveLeaf(previousActiveLeaf);
        cleanupEmbeddedSearch(true);
        loggerOnError(error, "初始化嵌入搜索视图失败\n(About Blank)");
      });

      // 监听原生搜索输入框, 控制展开/折叠
      const watchNativeInput = () => {
        if (disposed) {
          return;
        }
        if (!placeholderEl.isConnected) {
          cleanupEmbeddedSearch(true);
          return;
        }
        nativeInput = panelEl.querySelector<HTMLInputElement>('.search-input-container input');
        if (!nativeInput) {
          inputWatchTimer = ownerWindow.setTimeout(watchNativeInput, 100);
          return;
        }
        inputWatchTimer = null;

        // 光标进入输入框前后都立即展开, 避免折叠态下出现已聚焦但仍未展开的瞬间.
        panelEl.addEventListener("focusin", expandSearchPanel);
        panelEl.addEventListener("pointerdown", expandSearchPanel);
        nativeInput.addEventListener("focus", expandSearchPanel);

        if (ownerDocument.activeElement === nativeInput) {
          expandSearchPanel();
        }

        // 点击面板外部收起
        onDocClick = (event: MouseEvent) => {
          const target = event.target as Node;
          if (placeholderEl.contains(target) || panelEl.contains(target)) {
            return;
          }
          const panelRect = panelEl.getBoundingClientRect();
          const clickedInsidePanelBounds = event.clientX >= panelRect.left
            && event.clientX <= panelRect.right
            && event.clientY >= panelRect.top
            && event.clientY <= panelRect.bottom;
          if (clickedInsidePanelBounds) {
            return;
          }
          const targetElement = target instanceof Element ? target : target.parentElement;
          if (targetElement?.closest(
            '.suggestion-container, .search-suggest-container, .menu, .popover',
          )) {
            return;
          }
          collapseSearchPanel();
        };
        ownerDocument.addEventListener("click", onDocClick, true);
      };
      inputWatchTimer = ownerWindow.setTimeout(watchNativeInput, 300);
    } catch (error) {
      loggerOnError(error, "嵌入搜索框失败\n(About Blank)");
    }
  };

  // ---------------------------------------------------------------------------

  cleanUpSettings = (): void => {
    const normalizeResults = this.normalizeSettings();
    const results = [...normalizeResults];
    if (0 < results.length) {
      const resultsMessage =
        `"类型/属性检查": ${normalizeResults.length} 已修复`;
      const descMessage =
        "查看控制台获取更多详情. 设置尚未保存, 重新加载 Obsidian 以放弃更改.";
      new Notice(`${resultsMessage}\n\n${descMessage}\n\n**点击关闭**`, 0);
      // 静默处理结果
      return;
    }
      new Notice("未发现设置错误");
  };

  normalizeSettings = (): unknown[] => {
    const results: unknown[] = [];
    const setProp = <T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void => {
      obj[key] = value;
    };

    const normalizeActions = (actions: Action[]): Action[] => {
      return actions.flatMap((action) => {
        if (!isPlainObject(action)) {
          const newAction = newActionClone();
          results.push(
            new Map<string, unknown>([
              ["errorType", "action itself type error"],
              ["before", action],
              ["after", newAction],
            ]),
          );
          return newAction;
        }
        const legacyContent = action.content as unknown as Record<string, unknown>;
        if (isPlainObject(action.content) && legacyContent.kind === "group") {
          results.push(
            new Map<string, unknown>([
              ["errorType", "removed legacy grouped action"],
              ["actionName", action.name],
              ["actionContent", action.content],
            ]),
          );
          return [];
        }
        const actionKeys = Object.keys(NEW_ACTION) as Array<keyof Action>;
        actionKeys.forEach((key) => {
          if (!actionPropTypeCheck[key](action[key])) {
            const newAction = newActionClone();
            results.push(
              new Map<string, unknown>([
                ["errorType", "action's property type error"],
                ["actionName", action.name],
                ["actionContentKind", action.content.kind],
                ["actionContent", action.content],
                ["fixedKey", key],
                ["before", action[key]],
                ["after", newAction[key]],
              ]),
            );
            setProp(action, key, newAction[key]);
          }
        });
        return action;
      });
    };

    const defaultSettings = defaultSettingsClone();
    const settingsKeys = Object.keys(defaultSettings) as Array<keyof AboutBlankSettings>;
    settingsKeys.forEach((key) => {
      if (!settingsPropTypeCheck[key](this.settings[key])) {
        results.push(
          new Map<string, unknown>([
            ["errorType", "settings property type error"],
            ["fixedKey", key],
            ["before", this.settings[key]],
            ["after", defaultSettings[key]],
          ]),
        );
        setProp(this.settings, key, defaultSettings[key]);
      }
    });

    this.settings.actions = normalizeActions(this.settings.actions);
    this.settings.customStats = normalizeCustomStatDefinitions(this.settings.customStats);
    this.settings.dateStats = normalizeDateStatDefinitions(this.settings.dateStats);

    return results;
  };

  applyHeatmapSettings = (renderImmediately = true): void => {
    try {
      const root = document.documentElement;
      
      // Set heatmap enabled
      root.style.setProperty('--about-blank-heatmap-enabled', this.settings.heatmapEnabled ? 'block' : 'none');
      
      if (this.settings.heatmapEnabled) {
        if (renderImmediately && this.getOpenNewTabContexts().length > 0) {
          this.generateHeatmapData();
        } else if (renderImmediately) {
          this.globalRenderHeatmap = null;
        }
      } else {
        // Remove heatmap containers when disabled
        this.getOpenNewTabContexts().forEach(({ container }) => {
          container.querySelectorAll('.about-blank-heatmap-container')
            .forEach((heatmapContainer) => heatmapContainer.remove());
        });
      }
    } catch (error) {
      loggerOnError(error, "应用热力图设置失败\n(About Blank)");
    }
  };

  // 获取指定日期的文件列表
  getFilesForDate = (dateStr: string): TFile[] => {
    return [...(this.getHeatmapFilesByDate().get(dateStr) ?? [])];
  };

  generateHeatmapData = (): void => {
    try {
      const year = new Date().getFullYear();
      const dateCountMap = this.createHeatmapYearData(year);
      this.heatmapYearCache[year] = dateCountMap;
      this.renderHeatmap(dateCountMap);
    } catch (error) {
      loggerOnError(error, "生成热力图数据失败\n(About Blank)");
    }
  };

  renderHeatmap = (dateCountMap: HeatmapDateCountMap): void => {
    try {
      const year = new Date().getFullYear();
      const colorSegments = this.settings.heatmapColorSegments;
      
      // 缓存数据供后续使用
      this.heatmapDataCache = dateCountMap;
      
      const renderHeatmapInAllLeaves = () => {
        this.getOpenNewTabContexts().forEach(({ container }) => {
          const componentShell = this.getComponentShell(container, "heatmap");
          if (!componentShell) {
            return;
          }

          // 查找或创建热力图容器
          let heatmapContainer = componentShell.querySelector<HTMLElement>(
            '.about-blank-heatmap-container',
          );
          if (!heatmapContainer) {
            heatmapContainer = componentShell.createDiv({
              cls: 'about-blank-heatmap-container',
            });
          }

          // 性能优化: 检查是否已经有内容, 避免重复渲染
          if (heatmapContainer.children.length > 0) return;
          
          // 创建热力图内容
          this.createHeatmapContent(heatmapContainer, year, colorSegments, dateCountMap);
        });
      };
      
      // 性能优化: 立即渲染
      renderHeatmapInAllLeaves();
      
      // 设置全局热力图渲染函数, 供后续调用
      this.globalRenderHeatmap = renderHeatmapInAllLeaves;
      
    } catch (error) {
      loggerOnError(error, "渲染热力图失败\n(About Blank)");
    }
  };

  // 辅助方法: 生成贡献数据
  generateContributionData = (dateCountMap: HeatmapDateCountMap): ContributionItem[] => {
    const contributionData: ContributionItem[] = [];
    
    // 获取所有日期并排序
    const sortedDates = Object.keys(dateCountMap).sort();
    
    if (sortedDates.length === 0) {
      return contributionData;
    }
    
    // 获取开始和结束日期
    const startDate = new Date(sortedDates[0]);
    const endDate = new Date(sortedDates[sortedDates.length - 1]);
    
    // 生成从开始到结束的每一天的数据
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const date = new Date(dateStr);
      
      contributionData.push({
        date: dateStr,
        weekDay: date.getDay(), // 0=周日, 1=周一, ..., 6=周六
        month: date.getMonth(),
        monthDate: date.getDate(),
        year: date.getFullYear(),
        count: dateCountMap[dateStr] || 0,
      });
      
      // 移到下一天
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return contributionData;
  };

  // 辅助方法: 渲染星期指示器
  renderWeekIndicator = (weekdayContainer: HTMLElement) => {
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    
    for (let i = 0; i < 7; i++) {
      const weekdayCell = weekdayContainer.createEl('div', { cls: 'about-blank-heatmap-week-indicator' });
      
      // 显示所有周标签
      weekdayCell.textContent = weekdays[i];
    }
  };

  private getCustomStatItemId = (stat: CustomStat, index: number): string => {
    const stableId = stat.filters.id.trim();
    return stableId ? `custom-${stableId}` : `custom-${index}`;
  };

  private getDateStatItemId = (stat: DateStatDefinition, index: number): string => {
    const stableId = stat.id.trim();
    return stableId ? `date-${stableId}` : `date-${index}`;
  };

  syncStatDefinitionOrder = (kind: "custom" | "date"): void => {
    if (this.settings.statOrder.length === 0) {
      return;
    }
    const desiredIds = kind === "custom"
      ? this.settings.customStats.map((stat, index) => this.getCustomStatItemId(stat, index))
      : this.settings.dateStats.map((stat, index) => this.getDateStatItemId(stat, index));
    const desiredIdSet = new Set(desiredIds);
    let desiredIndex = 0;
    const nextOrder = this.resolveLegacyStatOrder(this.settings.statOrder).map((id) => {
      if (!desiredIdSet.has(id)) {
        return id;
      }
      const desiredId = desiredIds[desiredIndex];
      desiredIndex += 1;
      return desiredId;
    });
    while (desiredIndex < desiredIds.length) {
      nextOrder.push(desiredIds[desiredIndex]);
      desiredIndex += 1;
    }
    this.settings.statOrder = Array.from(new Set(nextOrder));
    this.settings.dateStatOrder = [];
  };

  private getStatFamily = (stat: StatItem): StatItemFamily => {
    return stat.kind === "date" ? "date" : "file";
  };

  private getStatClassNames = (stat: StatItem): string[] => {
    return [
      `is-${stat.kind}-stat`,
      `is-${this.getStatFamily(stat)}-family`,
    ];
  };

  private groupOrderedStatsByFamily = (
    orderedStats: Array<StatItem | undefined>,
  ): Record<StatItemFamily, StatItem[]> => {
    const groupedStats: Record<StatItemFamily, StatItem[]> = {
      file: [],
      date: [],
    };
    orderedStats.forEach((stat) => {
      if (stat) {
        groupedStats[this.getStatFamily(stat)].push(stat);
      }
    });
    return groupedStats;
  };

  private addStatFileListInteraction = (
    element: HTMLElement,
    stat: StatItem,
  ): void => {
    if (stat.kind !== "file" || !stat.files) {
      return;
    }

    const openFiles = (): void => {
      if (element.dataset.aboutBlankSuppressClick === 'true') {
        return;
      }
      new FileListModal(
        this.app,
        stat.label,
        stat.files ?? [],
        '没有符合该统计条件的文件',
      ).open();
    };
    element.classList.add('is-clickable-file-stat');
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    setTooltip(element, '查看匹配文件', { placement: 'top' });
    element.addEventListener('click', openFiles);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openFiles();
      }
    });
  };

  private resolveLegacyStatOrder = (order: string[]): string[] => {
    const legacyIdMap = new Map<string, string>();
    this.settings.customStats.forEach((stat, index) => {
      legacyIdMap.set(`custom-${index}`, this.getCustomStatItemId(stat, index));
    });
    this.settings.dateStats.forEach((stat, index) => {
      legacyIdMap.set(`date-${index}`, this.getDateStatItemId(stat, index));
    });

    return Array.from(new Set(order.map((id) => legacyIdMap.get(id) ?? id)));
  };

  private destroyStatSortControllersIn = (container: Element): void => {
    this.statSortControllers.forEach((controller, rootEl) => {
      if (rootEl === container || container.contains(rootEl)) {
        controller.destroy();
        this.statSortControllers.delete(rootEl);
      }
    });
  };

  private rerenderStats = (): void => {
    this.getOpenNewTabContexts().forEach(({ container }) => {
      this.destroyStatSortControllersIn(container);
      container.querySelectorAll('.about-blank-stats-bubbles')
        .forEach((element) => element.remove());
    });
    this.globalRenderStatsImmediate?.();
  };

  private commitStatPointerOrder = (
    familyOrder: string[],
    sourceId: string,
  ): void => {
    const allStats = this.statsCache ?? [];
    const statsById = new Map(allStats.map((stat) => [stat.id, stat]));
    const sourceStat = statsById.get(sourceId);
    if (!sourceStat) {
      return;
    }
    const fullOrder = this.resolveLegacyStatOrder([
      ...this.settings.statOrder,
      ...this.settings.dateStatOrder,
    ]);
    const persistedIds = new Set(fullOrder);
    const currentStats = [
      ...fullOrder
        .map((id) => statsById.get(id))
        .filter((stat): stat is StatItem => stat !== undefined),
      ...allStats.filter((stat) => !persistedIds.has(stat.id)),
    ];
    const family = this.getStatFamily(sourceStat);
    let familyIndex = 0;
    this.settings.statOrder = currentStats.map((stat) => {
      if (this.getStatFamily(stat) !== family) {
        return stat.id;
      }
      const nextId = familyOrder[familyIndex];
      familyIndex += 1;
      return nextId ?? stat.id;
    });
    this.settings.dateStatOrder = [];
    this.rerenderStats();
    void this.saveSettingsSilent().catch((error) => {
      loggerOnError(error, "保存统计项目顺序失败\n(About Blank)");
    });
  };

  private setupStatPointerSort = (
    rootEl: HTMLElement | SVGSVGElement,
  ): void => {
    this.statSortControllers.get(rootEl)?.destroy();
    const isIsometric = rootEl.namespaceURI === "http://www.w3.org/2000/svg";
    const itemSelector = isIsometric
      ? ".about-blank-stat-platform[data-stat-id]"
      : ".about-blank-stats-bubbles > [data-stat-id]";
    const getItems = (sourceEl: HTMLElement | SVGElement) => {
      const family = sourceEl.getAttribute("data-stat-family");
      return Array.from(rootEl.querySelectorAll<HTMLElement | SVGElement>(itemSelector))
        .filter((item) => item.getAttribute("data-stat-family") === family)
        .sort((left, right) => {
          return Number(left.getAttribute("data-stat-order"))
            - Number(right.getAttribute("data-stat-order"));
        });
    };
    const sortableItems = rootEl.querySelectorAll(itemSelector);
    if (sortableItems.length < 2) {
      return;
    }

    const controller = new PointerSortController<HTMLElement | SVGElement>({
      rootEl,
      itemSelector,
      strategy: "nearest",
      getItems,
      getId: (itemEl) => itemEl.getAttribute("data-stat-id") ?? "",
      toLocalDelta: isIsometric
        ? (itemEl, deltaX, deltaY) => {
          const matrix = (itemEl as SVGGraphicsElement).getScreenCTM();
          if (!matrix) {
            return [deltaX, deltaY];
          }
          const determinant = (matrix.a * matrix.d) - (matrix.b * matrix.c);
          if (Math.abs(determinant) <= Number.EPSILON) {
            return [deltaX, deltaY];
          }
          return [
            ((matrix.d * deltaX) - (matrix.c * deltaY)) / determinant,
            ((-matrix.b * deltaX) + (matrix.a * deltaY)) / determinant,
          ];
        }
        : undefined,
      onCommit: (orderedIds, sourceId) => {
        this.commitStatPointerOrder(orderedIds, sourceId);
      },
    });
    this.statSortControllers.set(rootEl, controller);
  };

  // 创建统计气泡
  createStatsBubbles = (renderImmediately = true): void => {
    try {
      // 检查是否启用统计
      if (!this.settings.showStats) {
        // 移除所有现有的统计气泡和内联统计条
        this.getOpenNewTabContexts().forEach((context) => {
          this.destroyStatSortControllersIn(context.container);
          context.container.querySelectorAll('.about-blank-stats-bubbles')
            .forEach((element) => element.remove());
        });
        return;
      }
      
      // 使用类级别缓存, 避免重复计算
      const getStatsData = () => {
        const now = Date.now();
        if (this.statsCache && (now - this.statsCacheTimestamp) < this.STATS_CACHE_DURATION) {
          return this.statsCache;
        }

        const loadedFiles = this.app.vault.getFiles();
        const customStats = this.settings.customStats || [];
        const fileContexts = customStats.length > 0
          ? loadedFiles.map((file) => ({
            file,
            cache: this.app.metadataCache.getFileCache(file),
          }))
          : [];
        
        // 基础统计项目 (根据开关过滤)
        const baseStats: StatItem[] = [];
        if (this.settings.showFileCount) {
          baseStats.push({
            id: 'file-count',
            label: "文件数量",
            value: loadedFiles.length,
            kind: "default",
          });
        }
        if (this.settings.showStorageSize) {
          const totalBytes = loadedFiles.reduce((total, file) => total + file.stat.size, 0);
          const totalGB = totalBytes / (1024 * 1024 * 1024);
          baseStats.push({
            id: 'storage-size',
            label: "存储空间",
            value: `${totalGB.toFixed(2)}G`,
            kind: "default",
          });
        }

        // 自定义统计项目
        const customStatsItems: StatItem[] = customStats.map((stat, index) => {
          const matchingFiles = fileContexts
            .filter((context) => matchesCustomStatDefinition(context, stat))
            .map((context) => context.file);
          return {
            id: this.getCustomStatItemId(stat, index),
            label: stat.displayName || findFirstCustomStatCondition(toCustomStatFilterGroup(stat))?.value || `文件统计${index + 1}`,
            value: matchingFiles.length,
            kind: "file",
            files: matchingFiles,
          };
        });

        // 日期统计项目
        const dateStatsItems: StatItem[] = (this.settings.dateStats || []).map((stat, index) => ({
          id: this.getDateStatItemId(stat, index),
          label: stat.title || `日期统计${index + 1}`,
          value: calcDateStatValue(stat),
          kind: "date",
          dateStatType: stat.type,
        }));

        // 合并所有统计项目并缓存
        this.statsCache = [...baseStats, ...customStatsItems, ...dateStatsItems];
        this.statsCacheTimestamp = now;
        return this.statsCache;
      };
      
      const renderStatsInAllLeavesImpl = () => {
        // 性能优化: 批量查询所有需要的元素
        const contexts = this.getOpenNewTabContexts();
        if (contexts.length === 0) return;
        
        // 获取统计数据 (使用类级别缓存)
        const allStats = getStatsData();

        // 获取排序后的统计项目 (所有统计混合排序)
        const getOrderedStats = (): StatItem[] => {
          // 合并两种排序: 常规统计用 statOrder, 日期统计用 dateStatOrder
          const regularIds = this.settings.statOrder || [];
          const dateIds = this.settings.dateStatOrder || [];
          const fullOrder = this.resolveLegacyStatOrder([...regularIds, ...dateIds]);

          if (fullOrder.length === 0) {
            return allStats;
          }

          const statsById = new Map(allStats.map((stat) => [stat.id, stat]));
          const ordered = fullOrder
            .map((id) => statsById.get(id))
            .filter((stat): stat is StatItem => stat !== undefined);

          const orderedIds = new Set(fullOrder);
          const newStats = allStats.filter((stat) => !orderedIds.has(stat.id));
          return [...ordered, ...newStats];
        };

        const orderedStats = getOrderedStats();

        this.renderStatsBubbleMode(
          contexts.map((context) => context.container),
          orderedStats,
        );
      };
      
      this.globalRenderStatsImmediate = renderStatsInAllLeavesImpl;
      if (renderImmediately) {
        renderStatsInAllLeavesImpl();
      }
      
    } catch (error) {
      loggerOnError(error, "渲染统计气泡失败\n(About Blank)");
    }
  };

  private renderStatsBubbleMode = (
    containers: HTMLElement[],
    orderedStats: Array<StatItem | undefined>,
  ): void => {
    containers.forEach((container) => {
      container.classList.add('about-blank-stats-bubble-mode');
      const statsHost = this.getStatsHost(container);
      if (!statsHost || statsHost.querySelector('.about-blank-stats-bubbles')) {
        return;
      }

      const preset = this.settings.newTabLayout.preset;
      if (preset === "isometric") {
        const svgEl = statsHost.querySelector('.about-blank-heatmap-isometric-svg');
        if (svgEl instanceof SVGSVGElement) {
          this.renderIsometricStatsLayer(svgEl, orderedStats);
        }
        return;
      }

      const heroHeight = Math.max(statsHost.clientHeight, 160);
      const logoCenterY = heroHeight / 2;
      const statsContainer = statsHost.createEl('div', {
        cls: [
          'about-blank-stats-bubbles',
          `about-blank-stats-${preset}`,
        ],
      });
      const familyStats = this.groupOrderedStatsByFamily(orderedStats);
      const placements = new Map<string, {
        isLeft: boolean;
        columnIndex: number;
        rowIndex: number;
        top: number;
      }>();
      (["file", "date"] as const).forEach((family) => {
        const items = familyStats[family];
        const estimatedBubbleHeight = family === "file" ? 34 : 38;
        const rowGap = 14;
        const rowPitch = estimatedBubbleHeight + rowGap;
        const availableHeight = Math.max(
          estimatedBubbleHeight,
          heroHeight - 16,
        );
        const rowsPerColumn = Math.max(
          1,
          Math.floor((availableHeight + rowGap) / rowPitch),
        );
        const firstColumnCount = Math.min(rowsPerColumn, items.length);
        const occupiedHeight = firstColumnCount > 0
          ? (firstColumnCount * estimatedBubbleHeight)
            + ((firstColumnCount - 1) * rowGap)
          : 0;
        const startY = Math.max(
          8,
          Math.min(
            heroHeight - occupiedHeight - 8,
            logoCenterY - (occupiedHeight / 2),
          ),
        );

        items.forEach((stat, familyIndex) => {
          const columnIndex = Math.floor(familyIndex / rowsPerColumn);
          const rowIndex = familyIndex % rowsPerColumn;
          placements.set(stat.id, {
            isLeft: family === "file",
            columnIndex,
            rowIndex,
            top: startY + (rowIndex * rowPitch),
          });
        });
      });

      const fragment = document.createDocumentFragment();

      orderedStats.forEach((stat, statOrderIndex) => {
        if (!stat) return;

        const placement = placements.get(stat.id);
        if (!placement) {
          return;
        }
        const {
          isLeft,
          columnIndex,
          rowIndex,
          top,
        } = placement;

        const bubble = document.createElement('div');
        bubble.className = isLeft ? 'about-blank-stats-bubble-left' : 'about-blank-stats-bubble-right';
        bubble.classList.add(...this.getStatClassNames(stat));
        if (stat.dateStatType) {
          bubble.classList.add('is-date-stat', stat.dateStatType === 'anniversary' ? 'is-anniversary' : 'is-countdown');
        }
        bubble.setAttribute('data-column', columnIndex.toString());
        bubble.setAttribute('data-row', rowIndex.toString());
        bubble.style.setProperty(
          '--about-blank-stat-column-offset',
          `${columnIndex * 126}px`,
        );
        bubble.setAttribute('data-stat-id', stat.id);
        bubble.setAttribute('data-stat-family', this.getStatFamily(stat));
        bubble.setAttribute('data-stat-order', statOrderIndex.toString());
        bubble.style.top = `${top}px`;

        const label = document.createElement('div');
        label.className = 'about-blank-stats-bubble-label';
        label.textContent = stat.label;

        const value = document.createElement('div');
        value.className = 'about-blank-stats-bubble-value';
        value.textContent = stat.value.toString();

        bubble.appendChild(label);
        bubble.appendChild(value);
        this.addStatFileListInteraction(bubble, stat);

        fragment.appendChild(bubble);
      });

      statsContainer.appendChild(fragment);
      this.setupStatPointerSort(statsContainer);
    });
  };

  private renderIsometricStatsLayer = (
    svgEl: SVGSVGElement,
    orderedStats: Array<StatItem | undefined>,
  ): void => {
    const stats = orderedStats.filter((stat): stat is StatItem => stat !== undefined);
    if (stats.length === 0) {
      return;
    }

    const weekCount = Math.max(1, Number(svgEl.dataset.weekCount) || 53);
    const localWidth = 100;
    const localHeight = 44;
    const familyStats = this.groupOrderedStatsByFamily(orderedStats);
    const heatmapPlatformColors = this.settings.heatmapColorSegments
      .filter((segment) => segment.max > 0)
      .map((segment) => segment.color);
    const familyIndices = {
      file: 0,
      date: 0,
    };
    const point = (value: { x: number; y: number }): string => (
      `${value.x.toFixed(3)},${value.y.toFixed(3)}`
    );

    stats.forEach((stat) => {
      const family = this.getStatFamily(stat);
      const isFileFamily = family === "file";
      const familyIndex = familyIndices[family]++;
      const platformWeekSpan = isFileFamily ? 6.2 : 5.4;
      const platformDaySpan = isFileFamily ? 3.2 : 2.8;
      const platformHeight = 2.2;
      const rowSpacing = isFileFamily ? 4.2 : 4;
      const nearestRowDay = isFileFamily ? 10.5 : -4.7;
      const preferredWeekGap = isFileFamily ? 0.7 : 1.4;
      const usableWeekSpan = Math.max(platformWeekSpan, weekCount - 3);
      const itemsPerRow = Math.max(
        1,
        Math.floor(
          (usableWeekSpan + preferredWeekGap)
          / (platformWeekSpan + preferredWeekGap),
        ),
      );
      const rowIndex = Math.floor(familyIndex / itemsPerRow);
      const positionInRow = familyIndex % itemsPerRow;
      const rowStartIndex = rowIndex * itemsPerRow;
      const itemsInRow = Math.min(
        itemsPerRow,
        familyStats[family].length - rowStartIndex,
      );
      const weekVector = {
        x: ISOMETRIC_TILE_HALF_WIDTH * platformWeekSpan,
        y: platformWeekSpan,
      };
      const dayVector = {
        x: -ISOMETRIC_TILE_HALF_WIDTH * platformDaySpan,
        y: platformDaySpan,
      };
      const rowFootprint = (itemsInRow * platformWeekSpan)
        + (Math.max(0, itemsInRow - 1) * preferredWeekGap);
      const rowStartWeek = Math.max(1.5, (weekCount - rowFootprint) / 2);
      const week = rowStartWeek
        + (positionInRow * (platformWeekSpan + preferredWeekGap));
      const day = isFileFamily
        ? nearestRowDay + (rowIndex * rowSpacing)
        : nearestRowDay - (rowIndex * rowSpacing);
      const originX = (week - day) * ISOMETRIC_TILE_HALF_WIDTH;
      const originY = week
        + day
        + ISOMETRIC_MAX_PILLAR_HEIGHT
        - platformHeight;
      const topPoint = {
        x: originX + ISOMETRIC_TILE_HALF_WIDTH,
        y: originY,
      };
      const rightPoint = {
        x: topPoint.x + weekVector.x,
        y: topPoint.y + weekVector.y,
      };
      const leftPoint = {
        x: topPoint.x + dayVector.x,
        y: topPoint.y + dayVector.y,
      };
      const bottomPoint = {
        x: rightPoint.x + dayVector.x,
        y: rightPoint.y + dayVector.y,
      };
      const lowerLeftPoint = {
        x: leftPoint.x,
        y: leftPoint.y + platformHeight,
      };
      const lowerRightPoint = {
        x: rightPoint.x,
        y: rightPoint.y + platformHeight,
      };
      const lowerBottomPoint = {
        x: bottomPoint.x,
        y: bottomPoint.y + platformHeight,
      };
      const platformEl = createSvg('g', {
        cls: [
          'about-blank-stats-bubbles',
          'about-blank-stat-platform',
        ],
        attr: {
          'data-stat-id': stat.id,
          'data-stat-family': family,
          'data-stat-order': familyIndex.toString(),
          'data-stat-row': rowIndex.toString(),
          'data-stat-column': positionInRow.toString(),
          'data-isometric-plane': isFileFamily ? 'foreground' : 'background',
          'data-isometric-depth': lowerBottomPoint.y.toFixed(3),
        },
      });
      platformEl.classList.add(
        ...this.getStatClassNames(stat),
        isFileFamily
          ? 'about-blank-stat-platform-left'
          : 'about-blank-stat-platform-right',
      );
      const platformColor = heatmapPlatformColors[
        familyIndex % Math.max(1, heatmapPlatformColors.length)
      ];
      if (isFileFamily && platformColor) {
        platformEl.style.setProperty(
          '--about-blank-stat-platform-accent',
          platformColor,
        );
      }
      if (stat.dateStatType) {
        platformEl.classList.add(
          'is-date-stat',
          stat.dateStatType === 'anniversary' ? 'is-anniversary' : 'is-countdown',
        );
      }

      platformEl.append(
        createSvg('path', {
          cls: 'about-blank-stat-platform-left-face',
          attr: {
            d: `M${point(leftPoint)} L${point(bottomPoint)} L${point(lowerBottomPoint)} L${point(lowerLeftPoint)} Z`,
          },
        }),
        createSvg('path', {
          cls: 'about-blank-stat-platform-right-face',
          attr: {
            d: `M${point(bottomPoint)} L${point(rightPoint)} L${point(lowerRightPoint)} L${point(lowerBottomPoint)} Z`,
          },
        }),
        createSvg('path', {
          cls: 'about-blank-stat-platform-top',
          attr: {
            d: `M${point(topPoint)} L${point(rightPoint)} L${point(bottomPoint)} L${point(leftPoint)} Z`,
          },
        }),
      );

      const contentEl = createSvg('foreignObject', {
        cls: 'about-blank-stat-platform-content',
        attr: {
          x: '0',
          y: '0',
          width: localWidth.toString(),
          height: localHeight.toString(),
          transform: `matrix(${[
            weekVector.x / localWidth,
            weekVector.y / localWidth,
            dayVector.x / localHeight,
            dayVector.y / localHeight,
            topPoint.x,
            topPoint.y,
          ].map((value) => value.toFixed(6)).join(' ')})`,
        },
      });
      const bubble = document.createElement('div');
      bubble.className = isFileFamily
        ? 'about-blank-stats-bubble-left'
        : 'about-blank-stats-bubble-right';
      bubble.classList.add(...this.getStatClassNames(stat));
      if (stat.dateStatType) {
        bubble.classList.add(
          'is-date-stat',
          stat.dateStatType === 'anniversary' ? 'is-anniversary' : 'is-countdown',
        );
      }
      bubble.setAttribute('data-stat-id', stat.id);
      bubble.setAttribute('data-stat-family', family);

      const label = document.createElement('div');
      label.className = 'about-blank-stats-bubble-label';
      label.textContent = stat.label;
      const value = document.createElement('div');
      value.className = 'about-blank-stats-bubble-value';
      value.textContent = stat.value.toString();
      bubble.append(label, value);
      this.addStatFileListInteraction(bubble, stat);

      contentEl.appendChild(bubble);
      platformEl.appendChild(contentEl);
      svgEl.appendChild(platformEl);
    });

    this.sortIsometricScene(svgEl);
    this.setupStatPointerSort(svgEl);
  };

  private sortIsometricScene = (svgEl: SVGSVGElement): void => {
    const scenePlaneOrder = {
      background: 0,
      annotations: 1,
      heatmap: 2,
      foreground: 3,
    } as const;
    const getPlaneOrder = (element: SVGElement): number => {
      const plane = element.dataset.isometricPlane as keyof typeof scenePlaneOrder;
      return scenePlaneOrder[plane] ?? scenePlaneOrder.heatmap;
    };

    Array.from(svgEl.children)
      .filter((element): element is SVGElement => (
        element instanceof SVGElement
        && element.dataset.isometricDepth !== undefined
      ))
      .sort((first, second) => {
        const planeDifference = getPlaneOrder(first) - getPlaneOrder(second);
        if (planeDifference !== 0) {
          return planeDifference;
        }
        return Number(first.dataset.isometricDepth) - Number(second.dataset.isometricDepth);
      })
      .forEach((element) => svgEl.appendChild(element));
  };

  private shouldReduceHeatmapMotion = (element: Element): boolean => {
    return element.ownerDocument.defaultView
      ?.matchMedia('(prefers-reduced-motion: reduce)')
      .matches ?? false;
  };

  private getIsometricCellPositionKey = (cell: SVGGElement): string => {
    return `${cell.dataset.weekIndex ?? ''}:${cell.dataset.dayIndex ?? ''}`;
  };

  private captureIsometricHeatmap = (
    heatmapContainer: HTMLElement,
  ): Map<string, IsometricHeatmapCellSnapshot> => {
    const snapshots = new Map<string, IsometricHeatmapCellSnapshot>();
    heatmapContainer.querySelectorAll<SVGGElement>(
      '.about-blank-heatmap-isometric-cell[data-week-index][data-day-index]',
    ).forEach((cell) => {
      const block = cell.querySelector<SVGGElement>(
        '.about-blank-heatmap-isometric-block',
      );
      if (!block) return;
      const height = Number(block.dataset.pillarHeight);
      snapshots.set(this.getIsometricCellPositionKey(cell), {
        cell,
        color: cell.style.getPropertyValue(
          '--about-blank-heatmap-isometric-color',
        ),
        height: Number.isFinite(height) ? height : 0,
      });
    });
    return snapshots;
  };

  private captureFlatHeatmap = (
    heatmapContainer: HTMLElement,
  ): FlatHeatmapCellSnapshot[] => {
    return Array.from(
      heatmapContainer.querySelectorAll<HTMLElement>(
        '.about-blank-heatmap-column:not(:first-child) '
        + '.about-blank-heatmap-cell',
      ),
    ).map((cell) => ({
      backgroundColor: window.getComputedStyle(cell).backgroundColor,
      hasDate: cell.dataset.date !== undefined,
    }));
  };

  private morphIsometricHeatmap = async (
    heatmapContainer: HTMLElement,
    snapshots: Map<string, IsometricHeatmapCellSnapshot>,
  ): Promise<void> => {
    const svgEl = heatmapContainer.querySelector<SVGSVGElement>(
      '.about-blank-heatmap-isometric-svg',
    );
    if (!svgEl) {
      return;
    }

    type MorphEntry = {
      cell: SVGGElement;
      top: SVGPathElement;
      sides: SVGGElement | null;
      previousHeight: number;
      nextHeight: number;
      previousColor: string;
      nextColor: string;
      colorStep: number;
      mode: 'grow' | 'shrink' | 'fade-in' | 'fade-out';
    };
    const entries: MorphEntry[] = [];
    const remainingSnapshots = new Map(snapshots);
    let hasGhosts = false;
    const appendGhostEntry = (
      snapshot: IsometricHeatmapCellSnapshot,
      nextHeight: number,
      mode: 'shrink' | 'fade-out',
    ): void => {
      const ghost = snapshot.cell;
      ghost.querySelector('.about-blank-heatmap-isometric-hitbox')?.remove();
      ghost.addClass('about-blank-heatmap-isometric-morph-ghost');
      svgEl.appendChild(ghost);
      const block = ghost.querySelector<SVGGElement>(
        '.about-blank-heatmap-isometric-block',
      );
      const top = block?.querySelector<SVGPathElement>(
        '.about-blank-heatmap-isometric-top',
      );
      if (!block || !top) {
        ghost.remove();
        return;
      }
      hasGhosts = true;
      entries.push({
        cell: ghost,
        top,
        sides: block.querySelector<SVGGElement>(
          '.about-blank-heatmap-isometric-sides',
        ),
        previousHeight: snapshot.height,
        nextHeight,
        previousColor: snapshot.color,
        nextColor: snapshot.color,
        colorStep: -1,
        mode,
      });
    };

    svgEl.querySelectorAll<SVGGElement>(
      '.about-blank-heatmap-isometric-cell[data-week-index][data-day-index]',
    ).forEach((cell) => {
      const key = this.getIsometricCellPositionKey(cell);
      const previous = snapshots.get(key);
      remainingSnapshots.delete(key);
      const block = cell.querySelector<SVGGElement>(
        '.about-blank-heatmap-isometric-block',
      );
      const top = block?.querySelector<SVGPathElement>(
        '.about-blank-heatmap-isometric-top',
      );
      if (!block || !top) {
        return;
      }

      const nextHeight = Number(block.dataset.pillarHeight) || 0;
      const previousHeight = previous?.height ?? 0;
      const nextColor = cell.style.getPropertyValue(
        '--about-blank-heatmap-isometric-color',
      );
      const heightDifference = nextHeight - previousHeight;

      if (
        Math.abs(heightDifference) <= 0.001
        && previous
        && previous.color === nextColor
      ) {
        return;
      }

      if (heightDifference < -0.001 && previous) {
        appendGhostEntry(previous, nextHeight, 'shrink');
        return;
      }

      if (
        Math.abs(heightDifference) <= 0.001
        && previous
        && previous.color !== nextColor
      ) {
        appendGhostEntry(previous, nextHeight, 'fade-out');
        return;
      }

      entries.push({
        cell,
        top,
        sides: block.querySelector<SVGGElement>(
          '.about-blank-heatmap-isometric-sides',
        ),
        previousHeight,
        nextHeight,
        previousColor: previous?.color || nextColor,
        nextColor,
        colorStep: -1,
        mode: heightDifference > 0.001 ? 'grow' : 'fade-in',
      });
    });

    remainingSnapshots.forEach((snapshot) => {
      appendGhostEntry(
        snapshot,
        0,
        snapshot.height > 0.001 ? 'shrink' : 'fade-out',
      );
    });
    if (hasGhosts) {
      this.sortIsometricScene(svgEl);
    }

    if (entries.length === 0) {
      return;
    }

    const duration = 420;
    const frameInterval = (1000 / 60) - 1;
    await new Promise<void>((resolve) => {
      let startedAt = 0;
      let lastRenderedAt = 0;
      const renderFrame = (timestamp: number): void => {
        if (!heatmapContainer.isConnected) {
          entries.forEach((entry) => {
            if (entry.mode === 'shrink' || entry.mode === 'fade-out') {
              entry.cell.remove();
            }
          });
          resolve();
          return;
        }
        if (startedAt === 0) startedAt = timestamp;
        const linearProgress = Math.min(1, (timestamp - startedAt) / duration);
        if (
          linearProgress < 1
          && timestamp - lastRenderedAt < frameInterval
        ) {
          window.requestAnimationFrame(renderFrame);
          return;
        }
        lastRenderedAt = timestamp;
        const progress = (
          linearProgress
          * linearProgress
          * (3 - (2 * linearProgress))
        );
        entries.forEach((entry) => {
          if (entry.mode === 'grow') {
            const heightDifference = entry.nextHeight - entry.previousHeight;
            entry.top.style.transform = (
              `translateY(${heightDifference * (1 - progress)}px)`
            );
            if (entry.sides && entry.nextHeight > 0.001) {
              const initialScale = Math.max(
                0.001,
                entry.previousHeight / entry.nextHeight,
              );
              entry.sides.style.transform = (
                `scaleY(${initialScale + ((1 - initialScale) * progress)})`
              );
            }
          } else if (entry.mode === 'shrink') {
            const heightDifference = entry.previousHeight - entry.nextHeight;
            entry.top.style.transform = (
              `translateY(${heightDifference * progress}px)`
            );
            if (entry.sides && entry.previousHeight > 0.001) {
              const finalScale = Math.max(
                0.001,
                entry.nextHeight / entry.previousHeight,
              );
              entry.sides.style.transform = (
                `scaleY(${1 - ((1 - finalScale) * progress)})`
              );
            }
            const opacity = linearProgress < 0.72
              ? 1
              : Math.max(0, (1 - linearProgress) / 0.28);
            entry.cell.style.opacity = opacity.toFixed(3);
          } else if (entry.mode === 'fade-in') {
            entry.cell.style.opacity = progress.toFixed(3);
          } else {
            entry.cell.style.opacity = (1 - progress).toFixed(3);
          }
          if (
            entry.mode === 'grow'
            && entry.previousColor !== entry.nextColor
          ) {
            const colorStep = Math.min(6, Math.round(progress * 6));
            if (colorStep !== entry.colorStep) {
              entry.colorStep = colorStep;
              const nextWeight = Math.round((colorStep / 6) * 100);
              entry.cell.style.setProperty(
                '--about-blank-heatmap-isometric-color',
                `color-mix(in srgb, ${entry.previousColor} `
                + `${100 - nextWeight}%, ${entry.nextColor})`,
              );
            }
          }
        });
        if (linearProgress < 1) {
          window.requestAnimationFrame(renderFrame);
          return;
        }
        entries.forEach((entry) => {
          if (entry.mode === 'shrink' || entry.mode === 'fade-out') {
            entry.cell.remove();
            return;
          }
          entry.top.style.removeProperty('transform');
          entry.sides?.style.removeProperty('transform');
          entry.cell.style.removeProperty('opacity');
          entry.cell.style.setProperty(
            '--about-blank-heatmap-isometric-color',
            entry.nextColor,
          );
        });
        resolve();
      };
      window.requestAnimationFrame(renderFrame);
    });
  };

  private morphFlatHeatmap = async (
    heatmapContainer: HTMLElement,
    snapshots: FlatHeatmapCellSnapshot[],
  ): Promise<void> => {
    const cells = Array.from(
      heatmapContainer.querySelectorAll<HTMLElement>(
        '.about-blank-heatmap-column:not(:first-child) '
        + '.about-blank-heatmap-cell',
      ),
    );
    const emptyCell = cells.find((cell) => cell.dataset.date === undefined)
      ?? cells.find((cell) => cell.classList.contains('empty'));
    const emptyColor = emptyCell
      ? window.getComputedStyle(emptyCell).backgroundColor
      : 'transparent';
    const animations = cells.map((cell, index) => {
      const previous = snapshots[index];
      const previousHasDate = previous?.hasDate ?? false;
      const nextHasDate = cell.dataset.date !== undefined;
      const previousColor = previous?.backgroundColor ?? emptyColor;
      const nextColor = window.getComputedStyle(cell).backgroundColor;
      let keyframes: Keyframe[];

      if (!previousHasDate && nextHasDate) {
        keyframes = [
          {
            backgroundColor: previousColor,
            transform: 'scale(0.18)',
            opacity: 0.2,
          },
          {
            backgroundColor: nextColor,
            transform: 'scale(1)',
            opacity: 1,
          },
        ];
      } else if (previousHasDate && !nextHasDate) {
        keyframes = [
          {
            backgroundColor: previousColor,
            transform: 'scale(1)',
            opacity: 1,
            offset: 0,
          },
          {
            backgroundColor: nextColor,
            transform: 'scale(0.18)',
            opacity: 0,
            offset: 0.62,
          },
          {
            backgroundColor: nextColor,
            transform: 'scale(1)',
            opacity: 1,
            offset: 1,
          },
        ];
      } else {
        keyframes = [
          { backgroundColor: previousColor },
          { backgroundColor: nextColor },
        ];
      }

      return cell.animate(keyframes, {
        duration: 440,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      });
    });
    await Promise.allSettled(animations.map((animation) => animation.finished));
  };

  changeHeatmapYear = async (
    heatmapContainer: HTMLElement,
    newYear: number,
    colorSegments: HeatmapColorSegment[],
  ): Promise<void> => {
    if (heatmapContainer.dataset.yearTransitioning === 'true') {
      return;
    }
    heatmapContainer.dataset.yearTransitioning = 'true';

    try {
      if (!this.heatmapYearCache) {
        this.heatmapYearCache = {};
      }
      const yearCache = this.heatmapYearCache;
      if (!yearCache[newYear]) {
        yearCache[newYear] = this.createHeatmapYearData(newYear);
      }

      const isIsometric = this.settings.heatmapStyle === 'isometric';
      const reduceMotion = this.shouldReduceHeatmapMotion(heatmapContainer);
      const isometricSnapshots = !reduceMotion && isIsometric
        ? this.captureIsometricHeatmap(heatmapContainer)
        : null;
      const flatSnapshots = !reduceMotion && !isIsometric
        ? this.captureFlatHeatmap(heatmapContainer)
        : null;
      const previousIsometricSvg = isIsometric
        ? heatmapContainer.querySelector<SVGSVGElement>(
          '.about-blank-heatmap-isometric-svg',
        )
        : null;
      const previousWeekCount = previousIsometricSvg?.dataset.weekCount;
      if (previousIsometricSvg) {
        this.destroyStatSortControllersIn(previousIsometricSvg);
      }
      const retainedStats = previousIsometricSvg && this.settings.showStats
        ? Array.from(previousIsometricSvg.querySelectorAll<SVGElement>(
          ':scope > .about-blank-stats-bubbles',
        ))
        : [];
      retainedStats.forEach((element) => element.remove());

      heatmapContainer.empty();
      this.createHeatmapContent(
        heatmapContainer,
        newYear,
        colorSegments,
        yearCache[newYear],
      );
      if (this.settings.showStats && isIsometric) {
        const nextIsometricSvg = heatmapContainer.querySelector<SVGSVGElement>(
          '.about-blank-heatmap-isometric-svg',
        );
        if (
          nextIsometricSvg
          && retainedStats.length > 0
          && previousWeekCount === nextIsometricSvg.dataset.weekCount
        ) {
          nextIsometricSvg.append(...retainedStats);
          this.sortIsometricScene(nextIsometricSvg);
          this.setupStatPointerSort(nextIsometricSvg);
        } else {
          this.globalRenderStatsImmediate?.();
        }
      }
      if (isometricSnapshots) {
        await this.morphIsometricHeatmap(
          heatmapContainer,
          isometricSnapshots,
        );
      } else if (flatSnapshots) {
        await this.morphFlatHeatmap(heatmapContainer, flatSnapshots);
      }
    } catch (error) {
      loggerOnError(error, "切换热力图年份失败\n(About Blank)");
    } finally {
      delete heatmapContainer.dataset.yearTransitioning;
    }
  };

  createHeatmapContent = (
    heatmapContainer: HTMLElement,
    year: number,
    colorSegments: HeatmapColorSegment[],
    dateCountMap: HeatmapDateCountMap,
  ): void => {
    try {
      const isIsometric = this.settings.heatmapStyle === 'isometric';
      heatmapContainer.classList.toggle('about-blank-heatmap-isometric', isIsometric);
      const controlsContainer = heatmapContainer.createEl('div', { cls: 'about-blank-heatmap-controls' });
      
      const prevButton = controlsContainer.createEl('button', {
        cls: 'clickable-icon about-blank-heatmap-year-button about-blank-heatmap-year-prev',
        attr: {
          'aria-label': '上一年',
        },
      });
      setIcon(prevButton, 'chevron-left');
      prevButton.addEventListener('click', () => {
        void this.changeHeatmapYear(heatmapContainer, year - 1, colorSegments);
      });
      
      const yearDisplay = controlsContainer.createEl('div', { cls: 'about-blank-heatmap-year-display' });
      yearDisplay.textContent = year.toString();
      
      const nextButton = controlsContainer.createEl('button', {
        cls: 'clickable-icon about-blank-heatmap-year-button about-blank-heatmap-year-next',
        attr: {
          'aria-label': '下一年',
        },
      });
      setIcon(nextButton, 'chevron-right');
      nextButton.addEventListener('click', () => {
        void this.changeHeatmapYear(heatmapContainer, year + 1, colorSegments);
      });
      
      const chartsEl = heatmapContainer.createEl('div', { cls: 'about-blank-heatmap-charts' });
      const contributionData = this.generateContributionData(dateCountMap);
      const maxContributionCount = Math.max(
        0,
        ...contributionData.map((item) => item.count),
      );
      
      if (contributionData.length > 0) {
        const firstDate = new Date(contributionData[0].date);
        const weekDayOfFirstDate = firstDate.getDay();
        const firstHoleCount = weekDayOfFirstDate;
        
        for (let i = 0; i < firstHoleCount; i++) {
          contributionData.unshift({
            date: "$HOLE$",
            weekDay: -1,
            month: -1,
            monthDate: -1,
            year: -1,
            count: 0,
          });
        }
      }

      if (isIsometric) {
        this.renderIsometricHeatmap(
          chartsEl,
          contributionData,
          maxContributionCount,
        );
        return;
      }

      const weekTextColumns = chartsEl.createEl('div', { cls: 'about-blank-heatmap-column' });
      this.renderWeekIndicator(weekTextColumns);
      chartsEl.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const cell = target.closest<HTMLElement>(
          '.about-blank-heatmap-cell.clickable[data-date]',
        );
        const date = cell?.dataset.date;
        if (!date) {
          return;
        }
        new FileListModal(
          this.app,
          date,
          this.getFilesForDate(date),
          '该日期没有文件',
        ).open();
      });
      
      let columnEl: HTMLElement | null = null;
      const months = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
      for (let i = 0; i < contributionData.length; i++) {
        if (i % 7 === 0) {
          columnEl = chartsEl.createEl('div', { cls: 'about-blank-heatmap-column' });
        }
        
        const contributionItem = contributionData[i];
        
        if (contributionItem.monthDate === 1 && columnEl) {
          const monthCell = columnEl.createEl('div', { cls: 'about-blank-heatmap-month-indicator' });
          monthCell.textContent = months[contributionItem.month];
        }
        
        if (columnEl) {
          const cellEl = columnEl.createEl('div', { cls: 'about-blank-heatmap-cell' });
          if (contributionItem.date === "$HOLE$") {
            cellEl.dataset.level = '0';
            continue;
          }

          const { count, date } = contributionItem;
          cellEl.dataset.level = count === 0 ? '0' : this.getHeatmapLevel(count);
          cellEl.dataset.date = date;
          cellEl.dataset.count = count.toString();
          cellEl.style.backgroundColor = this.getHeatmapColor(count);
          cellEl.addClass('clickable');
          if (count === 0) {
            cellEl.addClass('empty');
          }
          setTooltip(cellEl, `${date}, ${count} 个文件`, { placement: 'top' });
        }
      }
    } catch (error) {
      loggerOnError(error, "创建热力图内容失败\n(About Blank)");
    }
  };

  private renderIsometricHeatmap = (
    chartsEl: HTMLElement,
    contributionData: ContributionItem[],
    maxCount: number,
  ): void => {
    const tileHalfWidth = ISOMETRIC_TILE_HALF_WIDTH;
    const tileWidth = tileHalfWidth * 2;
    const tileHeight = ISOMETRIC_TILE_HEIGHT;
    const maxPillarHeight = ISOMETRIC_MAX_PILLAR_HEIGHT;
    const weekCount = Math.max(1, Math.ceil(contributionData.length / 7));
    const padding = 3;
    const minX = -6 * tileHalfWidth - 7;
    const maxX = (weekCount - 1) * tileHalfWidth + tileWidth + 8;
    const minY = -padding;
    const maxY = weekCount - 1
      + 6
      + tileHeight
      + maxPillarHeight
      + padding
      + 2;

    const svgEl = createSvg('svg', {
      cls: 'about-blank-heatmap-isometric-svg',
      attr: {
        viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`,
        preserveAspectRatio: 'xMidYMid meet',
        role: 'img',
        'data-week-count': weekCount.toString(),
      },
    });
    const getTooltipTarget = (event: Event): HTMLElement | null => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return null;
      }
      const tooltipTarget = target.closest('.about-blank-heatmap-isometric-tooltip-target');
      return tooltipTarget instanceof HTMLElement ? tooltipTarget : null;
    };
    const openFilesForTarget = (tooltipTarget: HTMLElement): void => {
      const date = tooltipTarget.dataset.date;
      if (!date) {
        return;
      }
      const files = this.getFilesForDate(date);
      new FileListModal(this.app, date, files, '该日期没有文件').open();
    };
    svgEl.addEventListener('click', (event) => {
      const tooltipTarget = getTooltipTarget(event);
      if (tooltipTarget) {
        openFilesForTarget(tooltipTarget);
      }
    });
    svgEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      const tooltipTarget = getTooltipTarget(event);
      if (tooltipTarget) {
        event.preventDefault();
        openFilesForTarget(tooltipTarget);
      }
    });

    const appendTimeLabel = (
      label: string,
      week: number,
      day: number,
      type: 'month' | 'weekday',
    ): void => {
      const centerX = ((week - day) * tileHalfWidth) + tileHalfWidth;
      const centerY = week + day + maxPillarHeight + (tileHeight / 2);
      const labelEl = createSvg('text', {
        cls: [
          'about-blank-heatmap-isometric-time-label',
          `about-blank-heatmap-isometric-${type}-label`,
        ],
        attr: {
          transform: `matrix(${tileHalfWidth} 1 ${-tileHalfWidth} 1 ${centerX} ${centerY})`,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          'aria-hidden': 'true',
          'data-isometric-plane': 'annotations',
          'data-isometric-depth': (
            week + day + maxPillarHeight + tileHeight
          ).toString(),
        },
      });
      labelEl.textContent = label;
      svgEl.appendChild(labelEl);
    };

    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    weekdays.forEach((weekday, dayIndex) => {
      appendTimeLabel(weekday, -1.8, dayIndex, 'weekday');
    });

    contributionData.forEach((item, index) => {
      if (item.date !== '$HOLE$' && item.monthDate === 1) {
        appendTimeLabel(
          (item.month + 1).toString(),
          Math.floor(index / 7),
          -1.1,
          'month',
        );
      }
    });

    contributionData.forEach((item, index) => {
      if (item.date === '$HOLE$') {
        return;
      }

      const weekIndex = Math.floor(index / 7);
      const dayIndex = index % 7;
      const ratio = item.count > 0 && maxCount > 0 ? item.count / maxCount : 0;
      const pillarHeight = ratio * maxPillarHeight;
      const x = weekIndex * tileHalfWidth - dayIndex * tileHalfWidth;
      const y = weekIndex + dayIndex + (1 - ratio) * maxPillarHeight;
      const color = item.count === 0
        ? 'var(--background-secondary-alt)'
        : this.getHeatmapColor(item.count);
      const groupEl = createSvg('g', {
        cls: 'about-blank-heatmap-isometric-cell',
        attr: {
          transform: `translate(${x} ${y})`,
          'data-date': item.date,
          'data-count': item.count.toString(),
          'data-week-index': weekIndex.toString(),
          'data-day-index': dayIndex.toString(),
          'data-isometric-plane': 'heatmap',
          'data-isometric-depth': (
            weekIndex + dayIndex + maxPillarHeight + tileHeight
          ).toString(),
        },
      });
      groupEl.style.setProperty('--about-blank-heatmap-isometric-color', color);

      const blockEl = createSvg('g', {
        cls: 'about-blank-heatmap-isometric-block',
        attr: {
          'data-pillar-height': pillarHeight.toFixed(3),
        },
      });
      const topFace = createSvg('path', {
        cls: 'about-blank-heatmap-isometric-top',
        attr: {
          d: `M${tileHalfWidth},${tileHeight} 0,1 ${tileHalfWidth},0 ${tileWidth},1 Z`,
        },
      });
      if (pillarHeight > 0) {
        const sideFaces = createSvg('g', {
          cls: 'about-blank-heatmap-isometric-sides',
        });
        const leftFace = createSvg('path', {
          cls: 'about-blank-heatmap-isometric-left',
          attr: {
            d: `M0,1 ${tileHalfWidth},${tileHeight} ${tileHalfWidth},${tileHeight + pillarHeight} 0,${1 + pillarHeight} Z`,
          },
        });
        const rightFace = createSvg('path', {
          cls: 'about-blank-heatmap-isometric-right',
          attr: {
            d: `M${tileHalfWidth},${tileHeight} ${tileWidth},1 ${tileWidth},${1 + pillarHeight} ${tileHalfWidth},${tileHeight + pillarHeight} Z`,
          },
        });
        sideFaces.append(leftFace, rightFace);
        blockEl.appendChild(sideFaces);
      }
      blockEl.appendChild(topFace);
      groupEl.appendChild(blockEl);

      const tooltipHitbox = createSvg('foreignObject', {
        cls: 'about-blank-heatmap-isometric-hitbox',
        attr: {
          x: '0',
          y: '0',
          width: tileWidth.toString(),
          height: (tileHeight + pillarHeight).toString(),
        },
      });
      const tooltipTarget = createDiv({
        cls: 'about-blank-heatmap-isometric-tooltip-target',
      });
      tooltipTarget.setAttribute('role', 'button');
      tooltipTarget.setAttribute('tabindex', '0');
      tooltipTarget.setAttribute('data-date', item.date);
      tooltipTarget.setAttribute('data-count', item.count.toString());
      setTooltip(
        tooltipTarget,
        `${item.date}, ${item.count} 个文件`,
        { placement: 'top' },
      );
      tooltipHitbox.appendChild(tooltipTarget);
      groupEl.appendChild(tooltipHitbox);
      svgEl.appendChild(groupEl);
    });

    this.sortIsometricScene(svgEl);
    chartsEl.appendChild(svgEl);
  };

  getHeatmapLevel = (count: number): string => {
    const colorSegments = this.settings.heatmapColorSegments;
    
    if (!colorSegments || colorSegments.length === 0) {
      return '0';
    }
    
    // 找到匹配的颜色段
    for (let i = 0; i < colorSegments.length; i++) {
      const segment = colorSegments[i];
      if (count >= segment.min && count <= segment.max) {
        return (i + 1).toString(); // 返回段索引+1, 0表示无数据
      }
    }
    
    // 如果超出所有段, 返回最高级别
    return colorSegments.length.toString();
  };

  getHeatmapColor = (count: number): string => {
    const colorSegments = this.settings.heatmapColorSegments;
    
    if (!colorSegments || colorSegments.length === 0) {
      return 'var(--background-primary)';
    }
    
    for (const segment of colorSegments) {
      if (count >= segment.min && count <= segment.max) {
        return segment.color;
      }
    }
    
    return colorSegments[0].color;
  };

  // 为特定容器应用 Logo 样式类 (用于新打开的标签页)
  private applyLogoClassToContainer = (actionListEl: HTMLElement): void => {
    const container = actionListEl.closest('.empty-state-container');
    if (!(container instanceof HTMLElement)) return;
    const logoHost = this.ensureBrandHost(container);
    if (!logoHost) return;
    const logoEl = logoHost.querySelector<HTMLElement>('.about-blank-logo');
    const shouldShowLogo = this.settings.logoEnabled && this.logoImageReady;
    const isIsometric = this.settings.newTabLayout.preset === "isometric";

    container.classList.toggle('logo-top', shouldShowLogo);
    container.classList.toggle('logo-original', shouldShowLogo && isIsometric);
    container.classList.toggle('logo-mask', shouldShowLogo && !isIsometric);

    if (!shouldShowLogo) {
      logoEl?.remove();
      this.destroyPixelWordmark(container);
      return;
    }

    const nextLogoEl = logoEl ?? document.createElement('div');
    nextLogoEl.className = 'about-blank-logo';
    this.syncLogoElementStyle(nextLogoEl);
    if (logoHost.firstElementChild !== nextLogoEl) {
      logoHost.insertBefore(nextLogoEl, logoHost.firstChild);
    }
    this.ensurePixelWordmark(container);
  };

  private syncLogoElementStyle = (logoEl: HTMLElement): void => {
    logoEl.empty();
    logoEl.removeClass('about-blank-logo-custom-icon');
    logoEl.style.backgroundColor = 'transparent';
    logoEl.style.backgroundImage = 'none';
    if (
      this.settings.logoIcon
      && this.customIconsIntegration.renderIcon(
        logoEl,
        this.settings.logoIcon,
      )
    ) {
      logoEl.addClass('about-blank-logo-custom-icon');
      delete logoEl.dataset.aboutBlankParticleSource;
      logoEl.dataset.aboutBlankParticleMask = "false";
      return;
    }
    logoEl.dataset.aboutBlankParticleSource = this.logoImageSourceUrl;
    logoEl.dataset.aboutBlankParticleMask = String(
      this.settings.newTabLayout.preset === "classic",
    );
    if (this.settings.newTabLayout.preset === "classic") {
      logoEl.style.backgroundColor = 'var(--icon-color)';
      logoEl.style.backgroundImage = 'none';
      return;
    }

    logoEl.style.backgroundColor = 'transparent';
    logoEl.style.backgroundImage = 'var(--about-blank-logo-image)';
  };

  private getLocalLogoResourceUrl = (filePath: string): string => {
    const normalizedPath = filePath.replace(/\\/g, "/");
    const encodedPath = encodeURI(normalizedPath)
      .replace(/#/g, "%23")
      .replace(/\?/g, "%3F");
    return `app://local/${encodedPath}`;
  };

  applyLogoSettings = (): void => {
    try {
      const root = document.documentElement;
      
      // Set logo image
      let logoUrl: string;
      let rawImageUrl: string | null = null; // 用于预加载的原始图片URL
      let particleImageUrl = DEFAULT_LOGO_SVG;
      if (this.settings.logoEnabled && this.settings.logoPath) {
        // Convert file path to URL format
        if (this.settings.logoPath.startsWith('http')) {
          rawImageUrl = this.settings.logoPath;
          particleImageUrl = this.settings.logoPath;
          logoUrl = `url("${this.settings.logoPath}")`;
        } else if (this.settings.logoPath.startsWith('data:image')) {
          // data URI 不需要预加载
          particleImageUrl = this.settings.logoPath;
          logoUrl = `url("${this.settings.logoPath}")`;
        } else if (this.settings.logoPath.startsWith('app://')) {
          rawImageUrl = this.settings.logoPath;
          particleImageUrl = this.settings.logoPath;
          logoUrl = `url("${rawImageUrl}")`;
        } else {
          // Handle Obsidian relative paths
          try {
            const file = this.app.vault.getAbstractFileByPath(this.settings.logoPath);
            if (file) {
              // 使用Obsidian的资源路径API
              const resourcePath = this.app.vault.getResourcePath(file as TFile);
              rawImageUrl = resourcePath;
              particleImageUrl = resourcePath;
              logoUrl = `url("${resourcePath}")`;
            } else {
              // Fallback for relative paths
              rawImageUrl = this.getLocalLogoResourceUrl(this.settings.logoPath);
              particleImageUrl = rawImageUrl;
              logoUrl = `url("${rawImageUrl}")`;
            }
          } catch {
            // Fallback for relative paths
            rawImageUrl = this.getLocalLogoResourceUrl(this.settings.logoPath);
            particleImageUrl = rawImageUrl;
            logoUrl = `url("${rawImageUrl}")`;
          }
        }
        root.style.setProperty('--about-blank-logo-image', logoUrl);
      } else if (this.settings.logoEnabled) {
        // Use default SVG when logo is enabled but no path is set
        logoUrl = `url("${DEFAULT_LOGO_SVG}")`;
        root.style.setProperty('--about-blank-logo-image', logoUrl);
      } else {
        root.style.setProperty('--about-blank-logo-image', 'none');
      }
      this.logoImageSourceUrl = particleImageUrl;
      const customLogoPreferred = Boolean(
        this.settings.logoIcon
        && this.customIconsIntegration.isAvailable(),
      );
      
      const logoSize = `${this.settings.logoSize}px`;
      root.style.setProperty('--about-blank-logo-size', logoSize);
      root.style.setProperty('--about-blank-logo-position', 'top');
      
      // 应用 Logo class 的函数
      const applyLogoClasses = () => {
        this.logoImageReady = true;
        this.getOpenNewTabContexts().forEach(({ container }) => {
          this.destroyPixelWordmark(container);
          container.classList.remove('logo-top', 'logo-mask', 'logo-original');
          container.querySelectorAll('.about-blank-logo').forEach((el) => el.remove());
          const logoHost = this.ensureBrandHost(container);
          if (this.settings.logoEnabled && logoHost) {
            container.classList.add('logo-top');
            container.classList.add(
              this.settings.newTabLayout.preset === "isometric"
                ? 'logo-original'
                : 'logo-mask',
            );
            const logoEl = document.createElement('div');
            logoEl.className = 'about-blank-logo';
            this.syncLogoElementStyle(logoEl);
            logoHost.insertBefore(logoEl, logoHost.firstChild);
            this.ensurePixelWordmark(container);
          }
        });

      };
      
      if (
        this.settings.logoEnabled
        && rawImageUrl
        && !customLogoPreferred
        && this.getOpenNewTabContexts().length > 0
      ) {
        // 需要预加载的外部/本地图片: 图片就绪前不显示 Logo
        this.logoImageReady = false;
        const img = new Image();
        img.onload = () => applyLogoClasses();
        img.onerror = () => applyLogoClasses(); // 加载失败也显示 (降级处理)
        img.src = rawImageUrl;
      } else if (this.settings.logoEnabled) {
        // data URI 或默认SVG: 直接就绪
        applyLogoClasses();
      } else {
        // Logo 禁用
        this.logoImageReady = false;
        applyLogoClasses();
      }
      
    } catch (error) {
      loggerOnError(error, "应用Logo设置失败\n(About Blank)");
    }
  };

}
