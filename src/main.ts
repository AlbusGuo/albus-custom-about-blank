import {
  type Command,
  TFile,
  TFolder,
  Modal,
  Notice,
  Plugin,
  setIcon,
} from "obsidian";

import {
  type Action,
  ACTION_KINDS,
  actionPropTypeCheck,
  allActionsBloodline,
  genNewCmdId,
  NEW_ACTION,
  newActionClone,
} from "src/settings/action-basic";

import {
  groupingActions,
  type PracticalAction,
  toPracticalAction,
} from "src/settings/action-edit";

import {
  editStyles,
} from "src/settings/editStyles";

import {
  HIDE_DEFAULT_ACTIONS,
} from "src/settings/hideDefault";

import {
  type AboutBlankSettings,
  AboutBlankSettingTab,
  DEFAULT_SETTINGS,
  defaultSettingsClone,
  settingsPropTypeCheck,
} from "src/settings/settingTab";

import hasClassElements from "src/utils/hasClassElements";

import hasDuplicates from "src/utils/hasDuplicates";

import isFalsyString from "src/utils/isFalsyString";

import isPlainObject from "src/utils/isPlainObject";

import updateProp from "src/utils/updateProp";

import {
  adjustInt,
  loggerOnError,
} from "src/commons";

import {
  COMMANDS,
  CSS_CLASSES,
  DEFAULT_LOGO_SVG,
} from "src/constants";

import {
  UNSAFE_CSS_CLASSES,
  UNSAFE_VIEW_TYPES,
  type UnsafeEmptyView,
} from "src/unsafe";

import { HeatmapFilesModal } from "src/ui/heatmapFilesModal";
// =============================================================================

export default class AboutBlank extends Plugin {
  settings: AboutBlankSettings;
  needToResisterActions: boolean;
  needToRemoveActions: boolean;
  needToResisterQuickActions: boolean;

  // 性能优化：类级别的缓存
  private statsCache: Array<{id: string; label: string; value: number | string}> | null = null;
  private statsCacheTimestamp: number = 0;
  private readonly STATS_CACHE_DURATION = 5000;

  // 热力图/统计相关缓存
  private heatmapDataCache: { [key: string]: number } | null = null;
  private heatmapYearCache: { [year: number]: { [key: string]: number } } = {};
  private heatmapRenderInterval: number | null = null;
  private heatmapObserver: MutationObserver | null = null;
  private globalRenderHeatmap: (() => void) | null = null;
  private globalRenderStats: (() => void) | null = null;
  private globalRenderStatsImmediate: (() => void) | null = null;
  private workspaceEventsRegistered = false;
  private logoImageReady = false;

  async onload() {
    try {
      await this.loadSettingsShallow();
      this.app.workspace.onLayoutReady(this.backBurner);

      if (this.settings.addActionsToNewTabs) {
        this.registerEvent(
          this.app.workspace.on("layout-change", this.addButtonsEventHandler),
        );
        editStyles.rewriteCssVars.iconTextGap.set(adjustInt(this.settings.iconTextGap));
        if (this.settings.centerActionListVertically) {
          editStyles.rewriteCssVars.emptyStateContainerMaxHeight.centered();
        }
        if (this.settings.deleteActionListMarginTop) {
          editStyles.rewriteCssVars.emptyStateListMarginTop.centered();
        }
        this.closeAllNewTabs();
      } else {
        editStyles.rewriteCssVars.emptyStateDisplay.default();
        editStyles.rewriteCssVars.emptyStateContainerMaxHeight.default();
        editStyles.rewriteCssVars.emptyStateListMarginTop.default();
      }

      this.addSettingTab(new AboutBlankSettingTab(this.app, this));
    } catch (error) {
      loggerOnError(error, "插件加载失败\n(About Blank)");
    }
  }

  backBurner = async () => {
    try {
      await this.loadSettingsDeep();

      // Logo 和热力图依赖 vault 文件索引, 必须在 onLayoutReady 后执行
      if (this.settings.addActionsToNewTabs) {
        this.applyLogoSettings();
        this.applyHeatmapSettings();
      }

      // 监听 vault 索引完成事件，重新生成热力图数据
      this.registerEvent(
        this.app.metadataCache.on('resolved', () => {
          if (this.settings.heatmapEnabled) {
            this.heatmapDataCache = null;
            this.heatmapYearCache = {};
            this.generateHeatmapData();
          }
        })
      );

      const allActions = allActionsBloodline(this.settings.actions);
      const hasCommandsToRegister = allActions.some((action) => {
        return action.cmd === true; // Explicitly true
      });
      if (hasCommandsToRegister) {
        this.registerAllCmdToObsidian(allActions);
      }
      if (this.settings.quickActions) {
        this.registerQuickActions();
      }
    } catch (error) {
      loggerOnError(error, "设置加载失败\n(About Blank)");
    }
  };

  onunload() {
    // registerInterval 自动清理定时器
    this.heatmapRenderInterval = null;
    // 清理 MutationObserver
    if (this.heatmapObserver) {
      this.heatmapObserver.disconnect();
      this.heatmapObserver = null;
    }
    // 清理 CSS 变量
    const root = document.documentElement;
    root.style.removeProperty('--about-blank-heatmap-enabled');
    root.style.removeProperty('--about-blank-logo-image');
    root.style.removeProperty('--about-blank-logo-size');
    root.style.removeProperty('--about-blank-logo-opacity');
    root.style.removeProperty('--about-blank-logo-position');

    this.closeAllNewTabs();
  }

  // ---------------------------------------------------------------------------

  loadSettingsShallow = async () => {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as AboutBlankSettings;
  };

  loadSettingsDeep = async () => {
    this.settings = Object.assign({}, defaultSettingsClone(), await this.loadData()) as AboutBlankSettings;
  };

  saveSettings = async () => {
    await this.saveData(this.settings);
    // 清除热力图缓存，确保下次渲染使用最新数据
    this.heatmapDataCache = null;
    this.heatmapYearCache = {};
    this.applyLogoSettings();
    this.applyHeatmapSettings();
  };

  // 保存设置但不刷新页面
  saveSettingsSilent = async () => {
    await this.saveData(this.settings);
  };

  // ---------------------------------------------------------------------------

  registerCmdToObsidian = (action: PracticalAction): void => {
    if (typeof action.cmdId !== "string" || typeof action.name !== "string") {
      new Notice("命令注册失败\n(About Blank)");
      return;
    }

    const commandConfig: Command = {
      id: action.cmdId,
      name: action.name,
      callback: action.callback,
    };
    if (typeof action.icon === "string" && !isFalsyString(action.icon)) {
      commandConfig.icon = action.icon;
    }
    this.addCommand(commandConfig);
  };

  registerAllCmdToObsidian = (allActions?: Action[]): void => {
    if (allActions === undefined) {
      allActions = allActionsBloodline(this.settings.actions);
    }
    const registerActions = allActions.filter((action) => {
      return action.cmd === true;
    });
    const practicalActions: PracticalAction[] = registerActions
      .map((action) => {
        return toPracticalAction(this.app, action);
      })
      .filter((action) => action !== undefined);

    practicalActions.forEach((action) => {
      this.registerCmdToObsidian(action);
    });
  };

  // Prerequisites for correct behavior:
  // - No change in `cmdId` for the same action.
  // - No duplicate `cmdIds`.
  // However, since it works fine with Obsidian reload, it's not something absolutely have to avoid.
  // The arguments are the return value of the `allActionsBloodline()`.
  removeApplicableCmds = (allOriginalActions: Action[], allModifiedActions: Action[]): void => {
    const cmdOrgActions = allOriginalActions.filter((action) => action.cmd ? true : false);
    const orgCmdIds = cmdOrgActions.map((action) => action.cmdId);

    const cmdModActions = allModifiedActions.filter((action) => action.cmd === true);
    const modCmdIds = cmdModActions.map((action) => action.cmdId);

    // Consider deleting or creating new actions, and think based on the Original.
    const shouldRemoveCmdIds = orgCmdIds.filter((cmdId) => !modCmdIds.includes(cmdId));
    shouldRemoveCmdIds.forEach((cmdId) => this.removeCommand(cmdId));
  };

  registerQuickActions = (): void => {
    const registerAction = groupingActions(
      this.app,
      {
        icon: this.settings.quickActionsIcon,
        name: COMMANDS.quickActions.name,
        cmd: true,
        cmdId: COMMANDS.quickActions.id,
      },
      this.settings.actions,
      `About Blank: ${COMMANDS.quickActions.name}`,
    );
    if (registerAction === undefined) {
      return;
    }
    this.registerCmdToObsidian(registerAction);
  };

  unregisterQuickActions = (): void => {
    this.removeCommand(COMMANDS.quickActions.id);
  };

  // ---------------------------------------------------------------------------

  closeAllNewTabs = (): void => {
    const emptyLeaves = this.app.workspace.getLeavesOfType(UNSAFE_VIEW_TYPES.empty);
    if (emptyLeaves.length === 0) {
      return;
    }
    emptyLeaves.forEach((leaf) => {
      leaf.detach();
    });
  };

  refreshAllNewTabs = (): void => {
    const emptyLeaves = this.app.workspace.getLeavesOfType(UNSAFE_VIEW_TYPES.empty);
    if (emptyLeaves.length === 0) {
      return;
    }
    emptyLeaves.forEach((leaf) => {
      const emptyView = leaf.view as UnsafeEmptyView;
      const actionListEl = emptyView.actionListEl;
      if (!actionListEl) {
        return;
      }
      const customButtons = actionListEl.querySelectorAll(`.${CSS_CLASSES.aboutBlankContainer}`);
      customButtons.forEach((button) => button.remove());
      
      const practicalActions: PracticalAction[] = this.settings.actions
        .map((action) => toPracticalAction(this.app, action))
        .filter((action) => action !== undefined);
      
      practicalActions.forEach((action) => this.addActionButton(actionListEl, action));
    });
  };

  private addButtonsEventHandler = (): void => {
    if (!this.settings.addActionsToNewTabs) {
      return;
    }
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (leaf?.view?.getViewType() !== UNSAFE_VIEW_TYPES.empty) {
      return;
    }
    this.addButtonsToNewTab(leaf.view as UnsafeEmptyView);
  };

  private addButtonsToNewTab = (emptyView: UnsafeEmptyView): void => {
    try {
      const emptyActionListEl = emptyView.actionListEl;
      const emptyTitleEl = emptyView.emptyTitleEl;
      const childElements = emptyActionListEl
        ? Array.from(emptyActionListEl.children) as HTMLElement[]
        : null;
      this.applyVisibleClass(emptyTitleEl, childElements);
      if (!emptyActionListEl || !childElements) {
        return;
      }
      if (this.alreadyAdded(childElements)) {
        return;
      }

      // 初始化加载状态：隐藏内容，显示加载动画
      const container = emptyActionListEl.closest('.empty-state-container') as HTMLElement | null;
      if (container && !container.classList.contains('about-blank-ready')) {
        container.classList.add('about-blank-loading');
        const loader = document.createElement('div');
        loader.className = 'about-blank-loader';
        loader.innerHTML = '<div class="about-blank-loader-spinner"></div>';
        container.appendChild(loader);
      }

      const practicalActions: PracticalAction[] = this.settings.actions
        .map((action) => toPracticalAction(this.app, action))
        .filter((action) => action !== undefined);
      practicalActions.forEach((action) => this.addActionButton(emptyActionListEl, action));

      // 为新打开的标签页应用 Logo 样式类
      this.applyLogoClassToContainer(emptyActionListEl);

      // 在按钮添加完成后，触发延迟渲染热力图和统计气泡
      requestAnimationFrame(() => {
        if (this.settings.heatmapEnabled && this.globalRenderHeatmap && this.heatmapDataCache) {
          this.globalRenderHeatmap();
        }
        if (this.settings.showStats && this.globalRenderStatsImmediate) {
          this.globalRenderStatsImmediate();
        }

        // 渲染完成：移除加载动画，显示内容
        if (container) {
          container.classList.remove('about-blank-loading');
          const loaderEl = container.querySelector('.about-blank-loader');
          if (loaderEl) loaderEl.remove();
          container.classList.add('about-blank-ready');
        }
      });
    } catch (error) {
      loggerOnError(error, "在空文件视图（新标签页）中添加按钮失败\n(About Blank)");
    }
  };

  private applyVisibleClass = (messageEl: HTMLElement | null, actionEls: HTMLElement[] | null): void => {
    const messageIsTarget = messageEl && !this.settings.hideMessage
      && !messageEl.classList.contains(CSS_CLASSES.visible);
    if (messageIsTarget) {
      messageEl.classList.add(CSS_CLASSES.visible);
    }

    if (!actionEls) {
      return;
    }
    if (this.settings.hideDefaultActions === HIDE_DEFAULT_ACTIONS.all) {
      return;
    }
    if (this.settings.hideDefaultActions === HIDE_DEFAULT_ACTIONS.close) {
      actionEls = actionEls.filter((elem) => {
        return !elem.classList.contains(UNSAFE_CSS_CLASSES.defaultCloseAction);
      });
    }
    actionEls.map((elem) => {
      if (elem.classList.contains(CSS_CLASSES.visible)) {
        return;
      }
      elem.classList.add(CSS_CLASSES.visible);
      
      // 为默认action添加Lucide图标
      this.addLucideIconToDefaultAction(elem);
    });
  };

  private addLucideIconToDefaultAction = (actionEl: HTMLElement): void => {
    if (actionEl.querySelector('.about-blank-default-icon')) {
      return;
    }
    
    const originalText = actionEl.textContent?.trim() || '';
    
    const iconContainer = document.createElement('div');
    iconContainer.addClass('about-blank-default-icon');
    
    let iconName = 'file';
    
    if (actionEl.classList.contains('mod-close')) {
      iconName = 'x';
    } else if (originalText.includes('新建') || originalText.includes('New')) {
      iconName = 'file-plus';
    } else if (originalText.includes('打开') || originalText.includes('Open')) {
      iconName = 'folder';
    } else if (originalText.includes('今日') || originalText.includes('Today')) {
      iconName = 'calendar-days';
    } else if (originalText.includes('帮助') || originalText.includes('Help')) {
      iconName = 'circle-help';
    } else if (originalText.includes('文件夹') || originalText.includes('Folder')) {
      iconName = 'folder-open';
    } else if (originalText.includes('最近') || originalText.includes('Recent')) {
      iconName = 'clock';
    } else if (originalText.includes('工作区') || originalText.includes('Workspace')) {
      iconName = 'layout';
    } else if (originalText.includes('模板') || originalText.includes('Template')) {
      iconName = 'file-text';
    }
    
    setIcon(iconContainer, iconName);
    
    if (originalText) {
      actionEl.setAttribute('aria-label', originalText);
    }
    
    // Clear text and add icon container
    actionEl.textContent = '';
    actionEl.appendChild(iconContainer);
  };

  private alreadyAdded = (elements: HTMLElement[]): boolean => {
    const classesToAdd = [
      CSS_CLASSES.aboutBlankContainer,
      CSS_CLASSES.aboutBlank,
    ];
    return classesToAdd.some((className) => hasClassElements(elements, className));
  };

  private addActionButton = (element: HTMLElement, action: PracticalAction): void => {
    const container = element.createEl(
      "div",
      {
        cls: `${UNSAFE_CSS_CLASSES.defaultEmptyAction} ${CSS_CLASSES.visible} ${CSS_CLASSES.aboutBlankContainer}`,
      },
      (elem: Element) => {
        elem.addEventListener("click", () => {
          void action.callback();
        });
      },
    );
    
    container.setAttribute('aria-label', action.name);
    
    if (!isFalsyString(action.icon)) {
      setIcon(container, action.icon);
    }
    container.createEl(
      "div",
      {
        cls: `${CSS_CLASSES.visible} ${CSS_CLASSES.aboutBlank}`,
        text: `${action.name}`,
      },
    );
  };

  // ---------------------------------------------------------------------------

  cleanUpSettings = (): void => {
    const normalizeResults = this.normalizeSettings();
    const allActions = allActionsBloodline(this.settings.actions);
    const fixResults = this.checkFixAllCmd(allActions);
    const isRegisterable = this.isRegisterable(null, allActions);
    if (isRegisterable) {
      this.registerAllCmdToObsidian(allActions);
      if (this.settings.quickActions === true) {
        this.registerQuickActions();
      }
    }
    const results = [...normalizeResults, ...fixResults];
    if (0 < results.length || !isRegisterable) {
      const registerableResult = isRegisterable ? "OK" : "Failed";
      const resultsMessage =
        `"类型/属性检查": ${normalizeResults.length} 已修复\n"命令 ID 检查": ${fixResults.length} 已修复\n"注册所有命令": ${registerableResult}`;
      const descMessage =
        "查看控制台获取更多详情。设置尚未保存，重新加载 Obsidian 以放弃更改。";
      new Notice(`${resultsMessage}\n\n${descMessage}\n\n**点击关闭**`, 0);
      // 静默处理结果
      return;
    }
      new Notice("未发现设置错误");
  };

  normalizeSettings = (): unknown[] => {
    const results: unknown[] = [];

    const normalizeActions = (actions: Action[]): Action[] => {
      return actions.map((action) => {
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
        const actionKeys = Object.keys(NEW_ACTION) as Array<keyof Action>;
        actionKeys.forEach((key) => {
          if (!actionPropTypeCheck[key](action[key])) {
            const newAction = newActionClone();
            results.push(
              new Map<string, unknown>([
                ["errorType", "action's property type error"],
                ["actionName", action.name],
                ["actionCommandId", action.cmdId],
                ["actionContentKind", action.content.kind],
                ["actionContent", action.content],
                ["fixedKey", key],
                ["before", action[key]],
                ["after", newAction[key]],
              ]),
            );
            updateProp(action, key, newAction[key]);
          }
        });
        if (action.content.kind === ACTION_KINDS.group) {
          action.content.actions = normalizeActions(action.content.actions);
        }
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
        updateProp(this.settings, key, defaultSettings[key]);
      }
    });

    this.settings.actions = normalizeActions(this.settings.actions);

    return results;
  };

  // Expect: `this.normalizeSettings()` was done.
  checkFixAllCmd = (allActions?: Action[]): unknown[] => {
    if (!Array.isArray(allActions)) {
      allActions = allActionsBloodline(this.settings.actions);
    }

    const fixResults: unknown[] = [];
    for (const action of allActions) {
      if (isFalsyString(action.cmdId)) {
        const beforeId = action.cmdId;
        action.cmdId = genNewCmdId(this.settings); // Unique ID
        fixResults.push(
          new Map<string, unknown>([
            ["errorType", "action's command ID is falsy string"],
            ["actionName", action.name],
            ["actionContentKind", action.content.kind],
            ["actionContent", action.content],
            ["beforeId", beforeId],
            ["fixedId", action.cmdId],
          ]),
        );
      }
    }

    if (hasDuplicates(allActions.map((action) => action.cmdId))) {
      const resolveResults: unknown[] = this.resolveCmdIdsConflict(allActions);
      return [...fixResults, ...resolveResults];
    }

    return fixResults;
  };

  // Before executing this, check for duplicates with `hasDuplicates.ts`
  // Expect: `this.normalizeSettings()` was done.
  resolveCmdIdsConflict = (allActions?: Action[]): unknown[] => {
    if (!Array.isArray(allActions)) {
      allActions = allActionsBloodline(this.settings.actions);
    }

    const results: unknown[] = [];
    const cmdIds = allActions.map((action) => action.cmdId);
    cmdIds.forEach((cmdId, index) => {
      const duplicate = cmdIds.indexOf(cmdId, index + 1);
      if (duplicate !== -1) {
        // In the current algorithm, if there are multiple duplicates,
        // it is better to update the `index` ID rather than `duplicate`.
        const action = allActions[index];
        const beforeId = action.cmdId;
        action.cmdId = genNewCmdId(this.settings); // Unique ID
        results.push(
          new Map<string, unknown>([
            ["errorType", "action's command ID is duplicated"],
            ["actionName", action.name],
            ["actionContentKind", action.content.kind],
            ["actionContent", action.content],
            ["beforeId", beforeId],
            ["fixedId", action.cmdId],
          ]),
        );
      }
    });

    return results;
  };

  isRegisterable = (
    registerId: string | null = null,
    allActions?: Action[],
  ): boolean => {
    if (!Array.isArray(allActions)) {
      allActions = allActionsBloodline(this.settings.actions);
    }

    const cmdIds = allActions.map((action) => action.cmdId);
    if (typeof registerId === "string") {
      return !isFalsyString(registerId) && !hasDuplicates(cmdIds, registerId);
    } else {
      return cmdIds.every((cmdId) => !isFalsyString(cmdId)) && !hasDuplicates(cmdIds);
    }
  };

  applyHeatmapSettings = (): void => {
    try {
      const root = document.documentElement;
      
      // Set heatmap enabled
      root.style.setProperty('--about-blank-heatmap-enabled', this.settings.heatmapEnabled ? 'block' : 'none');
      
      if (this.settings.heatmapEnabled) {
        // Generate heatmap data and render
        this.generateHeatmapData();
        
        // 设置定期检查和渲染热力图
        this.setupHeatmapPeriodicRender();
        
        // 添加额外的渲染尝试，确保在标签页切换时也能显示
        this.registerWorkspaceEvents();
      } else {
        // Remove heatmap containers when disabled
        const heatmapContainers = document.querySelectorAll('.about-blank-heatmap-container');
        heatmapContainers.forEach(container => container.remove());
        
        // 清除定期渲染
        if (this.heatmapRenderInterval) {
          clearInterval(this.heatmapRenderInterval);
          this.heatmapRenderInterval = null;
        }
      }
    } catch (error) {
      loggerOnError(error, "应用热力图设置失败\n(About Blank)");
    }
  };

  registerWorkspaceEvents = (): void => {
    if (this.workspaceEventsRegistered) return;
    this.workspaceEventsRegistered = true;

    // 监听工作区事件，确保在标签页切换时也能渲染热力图和统计气泡
    let leafChangeTimeout: NodeJS.Timeout | null = null;
    let isProcessingLeafChange = false;
    this.app.workspace.on('active-leaf-change', () => {
      if (isProcessingLeafChange) return; // 如果正在处理，跳过本次变化
      
      // 清除之前的超时，避免重复触发
      if (leafChangeTimeout) {
        clearTimeout(leafChangeTimeout);
      }
      
      leafChangeTimeout = setTimeout(() => {
        if (isProcessingLeafChange) return; // 再次检查处理状态
        
        isProcessingLeafChange = true;
        
        // 渲染热力图
        if (this.settings.heatmapEnabled && this.globalRenderHeatmap && this.heatmapDataCache) {
          this.globalRenderHeatmap();
        }
        
        // 渲染统计气泡（使用防抖）- 添加 logoEnabled 检查
        if (this.settings.showStats && this.globalRenderStats) {
          this.globalRenderStats();
        }
        
        // 重置处理状态
        setTimeout(() => {
          isProcessingLeafChange = false;
        }, 300);
      }, 150);
    });
    
    // 使用优化的MutationObserver监听DOM变化
    const workspaceContainer = document.querySelector('.workspace');
    if (workspaceContainer) {
      let observerTimeout: NodeJS.Timeout | null = null;
      let isProcessing = false; // 添加处理状态标志
      
      const observer = new MutationObserver((mutations) => {
        if (isProcessing) return; // 如果正在处理，跳过本次变化
        
        let shouldRerender = false;
        let hasNewEmptyLeaf = false;
        
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList') {
            // 只检查直接添加的空标签页，不检查子树
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node as Element;
                if (element.classList.contains('workspace-leaf-content') && 
                    element.getAttribute('data-type') === 'empty') {
                  shouldRerender = true;
                  hasNewEmptyLeaf = true;
                }
              }
            });
          }
        });
        
        if (shouldRerender) {
          // 清除之前的超时，避免重复触发
          if (observerTimeout) {
            clearTimeout(observerTimeout);
          }
          
          // 性能优化：对新标签页使用 requestAnimationFrame 立即渲染
          if (hasNewEmptyLeaf) {
            requestAnimationFrame(() => {
              if (isProcessing) return;
              isProcessing = true;
              
              // 渲染热力图
              if (this.settings.heatmapEnabled && 
                  this.globalRenderHeatmap && this.heatmapDataCache) {
                this.globalRenderHeatmap();
              }
              
              // 渲染统计气泡 - 直接调用，不经过防抖
              if (this.settings.showStats && this.globalRenderStatsImmediate) {
                this.globalRenderStatsImmediate();
              }
              
              // 重置处理状态
              setTimeout(() => {
                isProcessing = false;
              }, 300);
            });
          } else {
            // 非新标签页的情况，使用防抖
            observerTimeout = setTimeout(() => {
              if (isProcessing) return;
              
              isProcessing = true;
              
              // 渲染热力图
              if (this.settings.heatmapEnabled && 
                  this.globalRenderHeatmap && this.heatmapDataCache) {
                this.globalRenderHeatmap();
              }
              
              // 渲染统计气泡
              if (this.settings.showStats && this.globalRenderStats) {
                this.globalRenderStats();
              }
              
              // 重置处理状态
              setTimeout(() => {
                isProcessing = false;
              }, 500);
            }, 300);
          }
        }
      });
      
      // 只观察工作区容器的直接子元素变化，不观察子树
      observer.observe(workspaceContainer, {
        childList: true
      });
      
      // 保存observer引用以便清理
      this.heatmapObserver = observer;
    }
  };

  setupHeatmapPeriodicRender = (): void => {
    // 清除现有的定时器
    if (this.heatmapRenderInterval) {
      clearInterval(this.heatmapRenderInterval);
    }
    
    // 立即执行一次
    if (this.globalRenderHeatmap && this.heatmapDataCache) {
      this.globalRenderHeatmap();
    }
    
    // 添加防抖机制，避免频繁渲染
    let lastRenderTime = 0;
    const renderDebounceTime = 1000; // 1秒防抖
    
    // 设置定期检查和渲染，但降低频率并添加条件检查
    this.heatmapRenderInterval = this.registerInterval(window.setInterval(() => {
      const now = Date.now();
      
      // 检查是否在防抖期内
      if (now - lastRenderTime < renderDebounceTime) {
        return;
      }
      
      // 性能优化：检查所有空标签页
      const emptyLeaves = document.querySelectorAll('.workspace-leaf-content[data-type="empty"]');
      
      // 只在有新标签页时才渲染
      let needsRender = false;
      emptyLeaves.forEach((leaf) => {
        if (!leaf.querySelector('.about-blank-heatmap-container')) {
          needsRender = true;
        }
      });
      
      // 如果有新标签页且有缓存的数据，重新渲染
      if (needsRender && this.globalRenderHeatmap && this.heatmapDataCache) {
        this.globalRenderHeatmap();
        lastRenderTime = now;
      }
    }, 2000)); // 2秒检查一次
  };

  // 获取指定日期的文件列表
  getFilesForDate = (dateStr: string): TFile[] => {
    const dataSource = this.settings.heatmapDataSource;
    const frontmatterField = this.settings.heatmapFrontmatterField;
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const filesForDate: TFile[] = [];

    for (const file of markdownFiles) {
      const cache = this.app.metadataCache.getFileCache(file);
      let fileDate: Date | null = null;

      if (dataSource === "fileCreation" && file.stat) {
        fileDate = new Date(file.stat.ctime);
      } else if (dataSource === "frontmatter" && cache && cache.frontmatter) {
        const dateValue = cache.frontmatter[frontmatterField];
        if (dateValue) {
          const parsedDate = new Date(dateValue);
          if (!isNaN(parsedDate.getTime())) {
            fileDate = parsedDate;
          }
        }
      }

      if (fileDate && !isNaN(fileDate.getTime())) {
        const utcFileDate = new Date(Date.UTC(
          fileDate.getFullYear(),
          fileDate.getMonth(),
          fileDate.getDate()
        ));
        const fileDateStr = utcFileDate.toISOString().split('T')[0];

        if (fileDateStr === dateStr) {
          filesForDate.push(file);
        }
      }
    }

    return filesForDate;
  };

  generateHeatmapData = (): void => {
    try {
      const year = new Date().getFullYear();
      const dataSource = this.settings.heatmapDataSource;
      const frontmatterField = this.settings.heatmapFrontmatterField;
      
      // 使用 UTC 日期避免时区问题
      const startDate = new Date(Date.UTC(year, 0, 1));
      const endDate = new Date(Date.UTC(year, 11, 31));
      
      // 获取所有markdown文件
      const markdownFiles = this.app.vault.getMarkdownFiles();
      const dateCountMap: { [key: string]: number } = {};
      
      // 初始化全年日期
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        dateCountMap[dateStr] = 0;
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }
      
      // 统计文件
      for (const file of markdownFiles) {
        const cache = this.app.metadataCache.getFileCache(file);
        let fileDate: Date | null = null;
        
        if (dataSource === "fileCreation" && file.stat) {
          fileDate = new Date(file.stat.ctime);
        } else if (dataSource === "frontmatter" && cache && cache.frontmatter) {
          const dateValue = cache.frontmatter[frontmatterField];
          if (dateValue) {
            const parsedDate = new Date(dateValue);
            if (!isNaN(parsedDate.getTime())) {
              fileDate = parsedDate;
            }
          }
        }
        
        if (fileDate && !isNaN(fileDate.getTime())) {
          const utcFileDate = new Date(Date.UTC(
            fileDate.getFullYear(),
            fileDate.getMonth(),
            fileDate.getDate()
          ));
          const dateStr = utcFileDate.toISOString().split('T')[0];
          
          if (utcFileDate.getUTCFullYear() === year) {
            dateCountMap[dateStr] = (dateCountMap[dateStr] || 0) + 1;
          }
        }
      }
      
      // 渲染热力图
      this.renderHeatmap(dateCountMap);
    } catch (error) {
      loggerOnError(error, "生成热力图数据失败\n(About Blank)");
    }
  };

  renderHeatmap = (dateCountMap: { [key: string]: number }): void => {
    try {
      const year = new Date().getFullYear();
      const colorSegments = this.settings.heatmapColorSegments;
      
      // 缓存数据供后续使用
      this.heatmapDataCache = dateCountMap;
      
      const renderHeatmapInAllLeaves = () => {
        // 性能优化：批量查询所有需要的元素
        const emptyLeaves = document.querySelectorAll('.workspace-leaf-content[data-type="empty"]');
        
        emptyLeaves.forEach((leaf, index) => {
          // 查找或创建热力图容器
          let heatmapContainer = leaf.querySelector('.about-blank-heatmap-container') as HTMLElement;
          if (!heatmapContainer) {
            // 找到action列表下方
            const actionList = leaf.querySelector('.empty-state-action-list');
            if (actionList && actionList.parentNode) {
              heatmapContainer = document.createElement('div');
              heatmapContainer.className = 'about-blank-heatmap-container';
              actionList.parentNode.insertBefore(heatmapContainer, actionList.nextSibling);
            }
          }
          
          if (!heatmapContainer) return;
          
          // 性能优化：检查是否已经有内容，避免重复渲染
          if (heatmapContainer.children.length > 0) return;
          
          // 获取action list的宽度并设置热力图容器宽度
          const actionList = leaf.querySelector('.empty-state-action-list') as HTMLElement;
          if (actionList) {
            const actionListWidth = actionList.offsetWidth;
            // 设置热力图容器宽度与action list一致，但限制最大宽度以确保显示完整
            const maxWidth = 900; // 最大宽度限制
            const containerWidth = Math.min(actionListWidth, maxWidth);
            heatmapContainer.style.width = `${containerWidth}px`;
            heatmapContainer.style.maxWidth = 'none';
          }
          
          // 创建热力图内容
          this.createHeatmapContent(heatmapContainer, year, colorSegments, dateCountMap);
        });
      };
      
      // 性能优化：立即渲染
      renderHeatmapInAllLeaves();
      
      // 设置全局热力图渲染函数，供后续调用
      this.globalRenderHeatmap = renderHeatmapInAllLeaves;
      
    } catch (error) {
      loggerOnError(error, "渲染热力图失败\n(About Blank)");
    }
  };

  // 辅助方法：计算一周开始前的空白数量
  distanceBeforeTheStartOfWeek = (weekDay: number): number => {
    // 0=周日, 1=周一, ..., 6=周六
    // 如果一周从周日开始，则不需要空白
    return weekDay;
  };

  // 辅助方法：生成贡献数据
  generateContributionData = (dateCountMap: { [key: string]: number }) => {
    const contributionData: any[] = [];
    
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

  // 辅助方法：渲染星期指示器
  renderWeekIndicator = (weekdayContainer: HTMLElement) => {
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    
    for (let i = 0; i < 7; i++) {
      const weekdayCell = weekdayContainer.createEl('div', { cls: 'about-blank-heatmap-week-indicator' });
      
      // 显示所有周标签
      weekdayCell.textContent = weekdays[i];
    }
  };

  // 计算所有文件的总大小（GB）
  calculateTotalFileSize = (): string => {
    const allFiles = this.app.vault.getAllLoadedFiles().filter(file => file instanceof TFile);
    const totalBytes = allFiles.reduce((total, file) => total + file.stat.size, 0);
    const totalGB = totalBytes / (1024 * 1024 * 1024);
    return totalGB.toFixed(2);
  };

  // 计算所有文件的总数
  calculateTotalFileCount = (): number => {
    return this.app.vault.getAllLoadedFiles().filter(file => file instanceof TFile).length;
  };

  // 计算使用天数
  calculateUsageDays = (): number => {
    if (!this.settings.obsidianStartDate) return 0;
    
    const startDate = new Date(this.settings.obsidianStartDate);
    const today = new Date();
    const days = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    
    return days >= 0 ? days : 0;
  };

  // 计算特定文件类型的文件数量
  calculateFileTypeCount = (fileExtension: string): number => {
    if (!fileExtension) return 0;
    
    const allFiles = this.app.vault.getAllLoadedFiles().filter(file => file instanceof TFile);
    return allFiles.filter(file => file.extension === fileExtension).length;
  };

  // 计算自定义统计项目的文件数量
  calculateCustomStatCount = (stat: any): number => {
    if (!stat) return 0;
    
    const { type, value } = stat;
    
    switch (type) {
      case 'folder':
        if (!value) return 0;
        const allFiles = this.app.vault.getAllLoadedFiles().filter(file => file instanceof TFile);
        const folderFiles = allFiles.filter(file => {
          const fileFolder = file.path.split('/').slice(0, -1).join('/');
          return fileFolder === value || file.path.startsWith(value + '/');
        });
        return folderFiles.length;
        
      case 'fileType':
        return this.calculateFileTypeCount(value);
        
      default:
        return 0;
    }
  };

  // 创建统计气泡
  createStatsBubbles = (): void => {
    try {
      // 检查是否启用统计
      if (!this.settings.showStats) {
        // 移除所有现有的统计气泡和内联统计条
        document.querySelectorAll('.about-blank-stats-bubbles').forEach(el => el.remove());
        document.querySelectorAll('.about-blank-stats-inline').forEach(el => el.remove());
        return;
      }
      
      // 使用类级别缓存，避免重复计算
      const getStatsData = () => {
        const now = Date.now();
        if (this.statsCache && (now - this.statsCacheTimestamp) < this.STATS_CACHE_DURATION) {
          return this.statsCache;
        }
        
        // 基础统计项目（根据开关过滤）
        const baseStats: Array<{id: string; label: string; value: number | string}> = [];
        if (this.settings.showUsageDays) {
          baseStats.push({ id: 'usage-days', label: "使用天数", value: this.calculateUsageDays() });
        }
        if (this.settings.showFileCount) {
          baseStats.push({ id: 'file-count', label: "文件数量", value: this.calculateTotalFileCount() });
        }
        if (this.settings.showStorageSize) {
          baseStats.push({ id: 'storage-size', label: "存储空间", value: `${this.calculateTotalFileSize()}G` });
        }

        // 自定义统计项目
        const customStatsItems = (this.settings.customStats || []).map((stat: any, index: number) => ({
          id: `custom-${index}`,
          label: stat.displayName || stat.value || `统计项目${index + 1}`,
          value: this.calculateCustomStatCount(stat)
        }));

        // 合并所有统计项目并缓存
        this.statsCache = [...baseStats, ...customStatsItems];
        this.statsCacheTimestamp = now;
        return this.statsCache;
      };
      
      // 防抖渲染函数
      let renderTimeout: NodeJS.Timeout | null = null;
      const debouncedRender = () => {
        if (renderTimeout) {
          clearTimeout(renderTimeout);
        }
        renderTimeout = setTimeout(() => {
          renderStatsInAllLeavesImpl();
        }, 100); // 增加防抖时间到100ms
      };
      
      const renderStatsInAllLeavesImpl = () => {
        // 性能优化：批量查询所有需要的元素
        const emptyLeaves = document.querySelectorAll('.workspace-leaf-content[data-type="empty"]');
        
        if (emptyLeaves.length === 0) return;
        
        // 获取统计数据（使用类级别缓存）
        const allStats = getStatsData();
        
        // 获取排序后的统计项目
        const getOrderedStats = () => {
          // 如果没有设置顺序，使用默认顺序
          if (!this.settings.statOrder || this.settings.statOrder.length === 0) {
            return allStats;
          }
          
          // 根据保存的顺序排序，同时包含新添加的统计项目
          const orderedStats = this.settings.statOrder
            .map(id => allStats.find(stat => stat.id === id))
            .filter(stat => stat); // 过滤掉不存在的项目
          
          // 添加不在排序数组中的新统计项目
          const newStats = allStats.filter(stat => !this.settings.statOrder.includes(stat.id));
          
          return [...orderedStats, ...newStats];
        };
        
        const orderedStats = getOrderedStats();
        
        if (this.settings.logoEnabled) {
          // Logo 模式：浮动气泡布局
          this.renderStatsBubbleMode(emptyLeaves, orderedStats);
        } else {
          // 非 Logo 模式：内联统计条
          this.renderStatsInlineMode(emptyLeaves, orderedStats);
        }
      };
      
      // 导出防抖渲染函数
      const renderStatsInAllLeaves = debouncedRender;
      
      // 导出立即执行的渲染函数（用于新标签页）
      const renderStatsImmediate = renderStatsInAllLeavesImpl;
      
      // 优化的智能等待渲染函数
      let waitTimeout: NodeJS.Timeout | null = null;
      const waitForReadyAndRender = (retryCount = 0) => {
        if (retryCount > 10) return; // 增加重试次数但减少间隔
        
        // 检查是否有至少一个完全准备好的容器
        const emptyLeaves = document.querySelectorAll('.workspace-leaf-content[data-type="empty"]');
        if (emptyLeaves.length === 0) return;
        
        let hasReadyContainer = false;
        
        for (let i = 0; i < emptyLeaves.length; i++) {
          const leaf = emptyLeaves[i];
          const container = leaf.querySelector('.empty-state-container') as HTMLElement;
          if (container && container.querySelector('.empty-state-action-list') && container.clientHeight >= 100) {
            hasReadyContainer = true;
            break;
          }
        }
        
        if (hasReadyContainer) {
          // 容器已准备好，立即渲染
          renderStatsInAllLeavesImpl();
        } else {
          // 容器未准备好，等待后重试
          waitTimeout = setTimeout(() => waitForReadyAndRender(retryCount + 1), 50); // 减少到 50ms
        }
      };
      
      // 开始智能等待渲染
      waitForReadyAndRender();
      
      // 设置全局统计渲染函数，供后续调用
      this.globalRenderStats = renderStatsInAllLeaves;
      this.globalRenderStatsImmediate = renderStatsImmediate; // 立即执行版本
      
    } catch (error) {
      loggerOnError(error, "渲染统计气泡失败\n(About Blank)");
    }
  };

  private renderStatsBubbleMode = (emptyLeaves: NodeListOf<Element>, orderedStats: Array<{id: string; label: string; value: number | string} | undefined>): void => {
    emptyLeaves.forEach(leaf => {
      const container = leaf.querySelector('.empty-state-container') as HTMLElement;
      if (!container) return;
      const actionList = container.querySelector('.empty-state-action-list');
      if (!actionList) return;
      if (container.querySelector('.about-blank-stats-bubbles')) return;
      if (container.clientHeight < 100) return;

      const statsContainer = container.createEl('div', { cls: 'about-blank-stats-bubbles' });
      const containerHeight = container.clientHeight;
      const logoCenterY = containerHeight * 0.33;
      const maxRowsPerSide = 6;
      const verticalSpacing = 50;
      const totalBubbles = orderedStats.length;
      const actualMaxRows = Math.min(maxRowsPerSide, Math.ceil(totalBubbles / 2));
      const totalHeight = (actualMaxRows - 1) * verticalSpacing;
      const startY = logoCenterY - (totalHeight / 2);

      const fragment = document.createDocumentFragment();

      orderedStats.forEach((stat, index) => {
        if (!stat) return;

        const isLeft = index % 2 === 0;
        const sideIndex = Math.floor(index / 2);
        const columnIndex = Math.floor(sideIndex / maxRowsPerSide);
        const rowIndex = sideIndex % maxRowsPerSide;
        const finalY = startY + (rowIndex * verticalSpacing);

        const bubble = document.createElement('div');
        bubble.className = isLeft ? 'about-blank-stats-bubble about-blank-stats-bubble-left' : 'about-blank-stats-bubble about-blank-stats-bubble-right';
        bubble.setAttribute('data-column', columnIndex.toString());
        bubble.setAttribute('draggable', 'true');
        bubble.setAttribute('data-stat-id', stat.id);
        bubble.style.top = `${finalY}px`;

        const label = document.createElement('div');
        label.className = 'about-blank-stats-bubble-label';
        label.textContent = stat.label;

        const value = document.createElement('div');
        value.className = 'about-blank-stats-bubble-value';
        value.textContent = stat.value.toString();

        bubble.appendChild(label);
        bubble.appendChild(value);

        // 拖拽事件
        bubble.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData('text/plain', stat.id);
          bubble.classList.add('about-blank-stats-bubble-dragging');
          e.dataTransfer!.effectAllowed = 'move';
        });
        bubble.addEventListener('dragend', () => {
          bubble.classList.remove('about-blank-stats-bubble-dragging');
          document.querySelectorAll('.about-blank-stats-bubble-drag-over').forEach(el => el.classList.remove('about-blank-stats-bubble-drag-over'));
        });
        bubble.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer!.dropEffect = 'move';
          bubble.classList.add('about-blank-stats-bubble-drag-over');
        });
        bubble.addEventListener('dragleave', () => {
          bubble.classList.remove('about-blank-stats-bubble-drag-over');
        });
        bubble.addEventListener('drop', (e) => {
          e.preventDefault();
          bubble.classList.remove('about-blank-stats-bubble-drag-over');
          const draggedStatId = e.dataTransfer?.getData('text/plain');
          const targetStatId = stat.id;
          if (draggedStatId && draggedStatId !== targetStatId) {
            const currentOrder = this.settings.statOrder.length > 0 ? [...this.settings.statOrder] : orderedStats.map(s => s?.id || '');
            orderedStats.forEach(s => { if (s && !currentOrder.includes(s.id)) currentOrder.push(s.id); });
            const draggedIdx = currentOrder.indexOf(draggedStatId);
            const targetIdx = currentOrder.indexOf(targetStatId);
            if (draggedIdx !== -1 && targetIdx !== -1) {
              const temp = currentOrder[draggedIdx];
              currentOrder[draggedIdx] = currentOrder[targetIdx];
              currentOrder[targetIdx] = temp;
              this.settings.statOrder = currentOrder;
              this.saveSettingsSilent();
              // 交换气泡位置
              const allBubbles = Array.from(statsContainer.querySelectorAll('.about-blank-stats-bubble')) as HTMLElement[];
              const draggedBubble = allBubbles.find(b => b.getAttribute('data-stat-id') === draggedStatId);
              const targetBubble = allBubbles.find(b => b.getAttribute('data-stat-id') === targetStatId);
              if (draggedBubble && targetBubble) {
                const dTop = draggedBubble.style.top;
                draggedBubble.style.top = targetBubble.style.top;
                targetBubble.style.top = dTop;
                const dLeft = draggedBubble.classList.contains('about-blank-stats-bubble-left');
                const tLeft = targetBubble.classList.contains('about-blank-stats-bubble-left');
                if (dLeft !== tLeft) {
                  draggedBubble.classList.toggle('about-blank-stats-bubble-left');
                  draggedBubble.classList.toggle('about-blank-stats-bubble-right');
                  targetBubble.classList.toggle('about-blank-stats-bubble-left');
                  targetBubble.classList.toggle('about-blank-stats-bubble-right');
                }
                const dCol = draggedBubble.getAttribute('data-column');
                draggedBubble.setAttribute('data-column', targetBubble.getAttribute('data-column') || '0');
                targetBubble.setAttribute('data-column', dCol || '0');
                draggedBubble.style.transition = 'top 0.3s ease';
                targetBubble.style.transition = 'top 0.3s ease';
                setTimeout(() => { draggedBubble.style.transition = ''; targetBubble.style.transition = ''; }, 300);
              }
            }
          }
        });

        fragment.appendChild(bubble);
      });

      statsContainer.appendChild(fragment);
    });
  };

  private renderStatsInlineMode = (emptyLeaves: NodeListOf<Element>, orderedStats: Array<{id: string; label: string; value: number | string} | undefined>): void => {
    emptyLeaves.forEach(leaf => {
      const container = leaf.querySelector('.empty-state-container') as HTMLElement;
      if (!container) return;
      const actionList = container.querySelector('.empty-state-action-list');
      if (!actionList) return;
      // 避免重复渲染
      if (container.querySelector('.about-blank-stats-inline')) return;

      const inlineContainer = document.createElement('div');
      inlineContainer.className = 'about-blank-stats-inline';

      orderedStats.forEach(stat => {
        if (!stat) return;
        const item = document.createElement('div');
        item.className = 'about-blank-stats-inline-item';
        item.setAttribute('draggable', 'true');
        item.setAttribute('data-stat-id', stat.id);

        const value = document.createElement('div');
        value.className = 'about-blank-stats-inline-value';
        value.textContent = stat.value.toString();

        const label = document.createElement('div');
        label.className = 'about-blank-stats-inline-label';
        label.textContent = stat.label;

        item.appendChild(value);
        item.appendChild(label);

        // 拖拽事件
        item.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData('text/plain', stat.id);
          item.classList.add('about-blank-stats-inline-dragging');
          e.dataTransfer!.effectAllowed = 'move';
        });
        item.addEventListener('dragend', () => {
          item.classList.remove('about-blank-stats-inline-dragging');
          inlineContainer.querySelectorAll('.about-blank-stats-inline-drag-over').forEach(el => el.classList.remove('about-blank-stats-inline-drag-over'));
        });
        item.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer!.dropEffect = 'move';
          item.classList.add('about-blank-stats-inline-drag-over');
        });
        item.addEventListener('dragleave', () => {
          item.classList.remove('about-blank-stats-inline-drag-over');
        });
        item.addEventListener('drop', (e) => {
          e.preventDefault();
          item.classList.remove('about-blank-stats-inline-drag-over');
          const draggedStatId = e.dataTransfer?.getData('text/plain');
          const targetStatId = stat.id;
          if (draggedStatId && draggedStatId !== targetStatId) {
            const currentOrder = this.settings.statOrder.length > 0 ? [...this.settings.statOrder] : orderedStats.map(s => s?.id || '');
            orderedStats.forEach(s => { if (s && !currentOrder.includes(s.id)) currentOrder.push(s.id); });
            const draggedIdx = currentOrder.indexOf(draggedStatId);
            const targetIdx = currentOrder.indexOf(targetStatId);
            if (draggedIdx !== -1 && targetIdx !== -1) {
              const temp = currentOrder[draggedIdx];
              currentOrder[draggedIdx] = currentOrder[targetIdx];
              currentOrder[targetIdx] = temp;
              this.settings.statOrder = currentOrder;
              this.saveSettingsSilent();
              // 重新渲染内联统计
              document.querySelectorAll('.about-blank-stats-inline').forEach(el => el.remove());
              this.statsCache = null;
              this.createStatsBubbles();
            }
          }
        });

        inlineContainer.appendChild(item);
      });

      // 插入到 action list 上方
      actionList.parentNode?.insertBefore(inlineContainer, actionList);
    });
  };

  changeHeatmapYear = (heatmapContainer: HTMLElement, newYear: number, colorSegments: any[], dateCountMap: { [key: string]: number }): void => {
    // 检查是否已经有该年份的缓存数据
    if (!this.heatmapYearCache) {
      this.heatmapYearCache = {};
    }
    
    const yearCache = this.heatmapYearCache;
    
    if (!yearCache[newYear]) {
      // 重新生成新年份的数据
      const newDateCountMap: { [key: string]: number } = {};
      const dataSource = this.settings.heatmapDataSource;
      const frontmatterField = this.settings.heatmapFrontmatterField;
      
      // 使用 UTC 日期避免时区问题
      const startDate = new Date(Date.UTC(newYear, 0, 1));
      const endDate = new Date(Date.UTC(newYear, 11, 31));
      
      // 获取所有markdown文件
      const markdownFiles = this.app.vault.getMarkdownFiles();
      
      // 初始化全年日期
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        newDateCountMap[dateStr] = 0;
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }
      
      // 统计文件
      for (const file of markdownFiles) {
        const cache = this.app.metadataCache.getFileCache(file);
        let fileDate: Date | null = null;
        
        if (dataSource === "fileCreation" && file.stat) {
          fileDate = new Date(file.stat.ctime);
        } else if (dataSource === "frontmatter" && cache && cache.frontmatter) {
          const dateValue = cache.frontmatter[frontmatterField];
          if (dateValue) {
            const parsedDate = new Date(dateValue);
            if (!isNaN(parsedDate.getTime())) {
              fileDate = parsedDate;
            }
          }
        }
        
        if (fileDate && !isNaN(fileDate.getTime())) {
          const utcFileDate = new Date(Date.UTC(
            fileDate.getFullYear(),
            fileDate.getMonth(),
            fileDate.getDate()
          ));
          const dateStr = utcFileDate.toISOString().split('T')[0];
          
          if (utcFileDate.getUTCFullYear() === newYear) {
            newDateCountMap[dateStr] = (newDateCountMap[dateStr] || 0) + 1;
          }
        }
      }
      
      // 缓存新年份数据
      yearCache[newYear] = newDateCountMap;
    }
    
    // 清空热力图容器
    heatmapContainer.empty();
    
    // 使用缓存的数据重新创建热力图内容
    this.createHeatmapContent(heatmapContainer, newYear, colorSegments, yearCache[newYear]);
  };

  createHeatmapContent = (heatmapContainer: HTMLElement, year: number, colorSegments: any[], dateCountMap: { [key: string]: number }): void => {
    try {
      const parentLeaf = heatmapContainer.closest('.workspace-leaf-content[data-type="empty"]') as HTMLElement;
      
      if (parentLeaf) {
        const actionList = parentLeaf.querySelector('.empty-state-action-list') as HTMLElement;
        if (actionList) {
          const actionListWidth = actionList.offsetWidth;
          heatmapContainer.style.width = `${Math.max(actionListWidth, 800)}px`;
          heatmapContainer.style.maxWidth = 'none';
        }
      }
      
      const controlsContainer = heatmapContainer.createEl('div', { cls: 'about-blank-heatmap-controls' });
      
      const prevButton = controlsContainer.createEl('button', { cls: 'about-blank-heatmap-year-button about-blank-heatmap-year-prev' });
      prevButton.textContent = '‹';
      prevButton.addEventListener('click', () => {
        this.changeHeatmapYear(heatmapContainer, year - 1, colorSegments, dateCountMap);
      });
      
      const yearDisplay = controlsContainer.createEl('div', { cls: 'about-blank-heatmap-year-display' });
      yearDisplay.textContent = year.toString();
      
      const nextButton = controlsContainer.createEl('button', { cls: 'about-blank-heatmap-year-button about-blank-heatmap-year-next' });
      nextButton.textContent = '›';
      nextButton.addEventListener('click', () => {
        this.changeHeatmapYear(heatmapContainer, year + 1, colorSegments, dateCountMap);
      });
      
      const chartsEl = heatmapContainer.createEl('div', { cls: 'about-blank-heatmap-charts' });
      
      const weekTextColumns = chartsEl.createEl('div', { cls: 'about-blank-heatmap-column' });
      this.renderWeekIndicator(weekTextColumns);
      
      const contributionData = this.generateContributionData(dateCountMap);
      
      if (contributionData.length > 0) {
        const firstDate = new Date(contributionData[0].date);
        const weekDayOfFirstDate = firstDate.getDay();
        const firstHoleCount = this.distanceBeforeTheStartOfWeek(weekDayOfFirstDate);
        
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
      
      let columnEl: HTMLElement | null = null;
      for (let i = 0; i < contributionData.length; i++) {
        if (i % 7 === 0) {
          columnEl = chartsEl.createEl('div', { cls: 'about-blank-heatmap-column' });
        }
        
        const contributionItem = contributionData[i];
        
        if (contributionItem.monthDate === 1 && columnEl) {
          const monthCell = columnEl.createEl('div', { cls: 'about-blank-heatmap-month-indicator' });
          const months = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
          monthCell.textContent = months[contributionItem.month];
          
          monthCell.style.position = 'absolute';
          monthCell.style.top = '-24px';
          monthCell.style.left = '0';
          monthCell.style.width = '100%';
          monthCell.style.textAlign = 'center';
        }
        
        if (columnEl) {
          const cellEl = columnEl.createEl('div', { cls: 'about-blank-heatmap-cell' });
          
          if (contributionItem.count === 0) {
            if (contributionItem.date !== "$HOLE$") {
              cellEl.addClass('empty');
              cellEl.setAttribute('data-level', '0');
              cellEl.setAttribute('data-date', contributionItem.date);
              cellEl.setAttribute('data-count', '0');
              
              const color = this.getHeatmapColor(0);
              cellEl.style.backgroundColor = color;
              
              // 添加 Obsidian 默认 tooltip
              cellEl.setAttribute('aria-label', `${contributionItem.date}, 0 个文件`);
              
              // 添加点击事件 - 即使没有文件也可以点击查看
              cellEl.addClass('clickable');
              cellEl.addEventListener('click', () => {
                const files = this.getFilesForDate(contributionItem.date);
                const modal = new HeatmapFilesModal(this.app, this, contributionItem.date, files);
                modal.open();
              });
            } else {
              cellEl.setAttribute('data-level', '0');
            }
          } else {
            cellEl.setAttribute('data-level', this.getHeatmapLevel(contributionItem.count));
            cellEl.setAttribute('data-date', contributionItem.date);
            cellEl.setAttribute('data-count', contributionItem.count.toString());
            
            const color = this.getHeatmapColor(contributionItem.count);
            cellEl.style.backgroundColor = color;
            
            // 添加 Obsidian 默认 tooltip
            cellEl.setAttribute('aria-label', `${contributionItem.date}, ${contributionItem.count} 个文件`);
            
            // 添加点击事件
            cellEl.addClass('clickable');
            cellEl.addEventListener('click', () => {
              const files = this.getFilesForDate(contributionItem.date);
              const modal = new HeatmapFilesModal(this.app, this, contributionItem.date, files);
              modal.open();
            });
          }
        }
      }
      
    } catch (error) {
      loggerOnError(error, "创建热力图内容失败\n(About Blank)");
    }
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
        return (i + 1).toString(); // 返回段索引+1，0表示无数据
      }
    }
    
    // 如果超出所有段，返回最高级别
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

  // 为特定容器应用 Logo 样式类（用于新打开的标签页）
  private applyLogoClassToContainer = (actionListEl: HTMLElement): void => {
    if (!this.settings.logoEnabled) return;
    if (!this.logoImageReady) return; // 图片未就绪时不添加类，避免显示空白色块
    const container = actionListEl.closest('.empty-state-container');
    if (!container) return;
    container.classList.remove('logo-top', 'logo-mask', 'logo-original');
    container.classList.add('logo-top');
    container.classList.add(`logo-${this.settings.logoStyle || 'mask'}`);
  };

  applyLogoSettings = (): void => {
    try {
      const root = document.documentElement;
      
      // Set logo image
      let logoUrl: string;
      let rawImageUrl: string | null = null; // 用于预加载的原始图片URL
      if (this.settings.logoEnabled && this.settings.logoPath) {
        // Convert file path to URL format
        if (this.settings.logoPath.startsWith('http')) {
          rawImageUrl = this.settings.logoPath;
          logoUrl = `url("${this.settings.logoPath}")`;
        } else if (this.settings.logoPath.startsWith('data:image')) {
          // data URI 不需要预加载
          logoUrl = `url("${this.settings.logoPath}")`;
        } else {
          // Handle Obsidian relative paths
          try {
            const file = this.app.vault.getAbstractFileByPath(this.settings.logoPath);
            if (file) {
              // 使用Obsidian的资源路径API
              const resourcePath = this.app.vault.getResourcePath(file as TFile);
              rawImageUrl = resourcePath;
              logoUrl = `url("${resourcePath}")`;
            } else {
              // Fallback for relative paths
              rawImageUrl = `app://local/${this.settings.logoPath}`;
              logoUrl = `url("${rawImageUrl}")`;
            }
          } catch (error) {
            // Fallback for relative paths
            rawImageUrl = `app://local/${this.settings.logoPath}`;
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
      
      const logoSize = `${this.settings.logoSize}px`;
      root.style.setProperty('--about-blank-logo-size', logoSize);
      root.style.setProperty('--about-blank-logo-opacity', this.settings.logoOpacity.toString());
      root.style.setProperty('--about-blank-logo-position', 'top');
      
      // 应用 Logo class 的函数
      const applyLogoClasses = () => {
        this.logoImageReady = true;
        const emptyContainers = document.querySelectorAll('.workspace-leaf-content[data-type="empty"] .empty-state-container');
        emptyContainers.forEach(container => {
          container.classList.remove('logo-top', 'logo-mask', 'logo-original');
          if (this.settings.logoEnabled) {
            container.classList.add('logo-top');
            container.classList.add(`logo-${this.settings.logoStyle || 'mask'}`);
          }
        });
      };
      
      if (this.settings.logoEnabled && rawImageUrl) {
        // 需要预加载的外部/本地图片：图片就绪前不显示 Logo
        this.logoImageReady = false;
        const img = new Image();
        img.onload = () => applyLogoClasses();
        img.onerror = () => applyLogoClasses(); // 加载失败也显示（降级处理）
        img.src = rawImageUrl;
      } else if (this.settings.logoEnabled) {
        // data URI 或默认SVG：直接就绪
        applyLogoClasses();
      } else {
        // Logo 禁用
        this.logoImageReady = false;
        applyLogoClasses();
      }
      
      // Create stats if enabled (now independent of Logo)
      if (this.settings.showStats) {
        // 清除现有统计元素，以便用新设置重新渲染
        document.querySelectorAll('.about-blank-stats-bubbles').forEach(el => el.remove());
        document.querySelectorAll('.about-blank-stats-inline').forEach(el => el.remove());
        // 重置缓存以强制重新计算
        this.statsCache = null;
        setTimeout(() => {
          this.createStatsBubbles();
        }, 150);
      } else {
        // 统计关闭时，移除现有元素
        document.querySelectorAll('.about-blank-stats-bubbles').forEach(el => el.remove());
        document.querySelectorAll('.about-blank-stats-inline').forEach(el => el.remove());
      }
      
      // 应用按钮栏装饰图片设置
      const root2 = document.documentElement;
      root2.style.setProperty('--about-blank-action-list-image-display', this.settings.showActionListImage ? 'block' : 'none');
      
      // Force a reflow to ensure styles are applied
      setTimeout(() => {
        const event = new Event('resize');
        window.dispatchEvent(event);
      }, 100);
    } catch (error) {
      loggerOnError(error, "应用Logo设置失败\n(About Blank)");
    }
  };

  async showFileSelectionDialog(): Promise<string | null> {
    try {
      // 开始文件选择
      const files = this.app.vault.getFiles();
      
      let imageFiles = files.filter((file: TFile) => 
        file.extension && ['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp', 'webp'].includes(file.extension)
      );
      
      if (this.settings.logoDirectory && this.settings.logoDirectory.trim()) {
        const logoDir = this.settings.logoDirectory.trim();
        imageFiles = imageFiles.filter((file: TFile) => 
          file.path.startsWith(logoDir) && (file.path === logoDir || file.path.substring(logoDir.length).startsWith('/'))
        );
      }
      
      // 筛选图片文件数量
      
      if (imageFiles.length === 0) {
        const dirMsg = this.settings.logoDirectory ? `在目录 "${this.settings.logoDirectory}" 中` : "";
        new Notice(`未找到图片文件${dirMsg}`, 3000);
        return null;
      }
      
      // 创建一个图片预览选择器
      const modal = new Modal(this.app);
      modal.contentEl.createEl('h3', { text: '选择Logo图片' });
      
      // 添加搜索框
      const searchContainer = modal.contentEl.createEl('div', { cls: 'about-blank-search-container' });
      const searchInput = searchContainer.createEl('input', { 
        type: 'text',
        placeholder: '搜索文件名...',
        cls: 'about-blank-search-input'
      });
      
      const gridEl = modal.contentEl.createEl('div', { cls: 'about-blank-image-grid' });
      
      let selectedPath: string | null = null;
      
      // 存储所有图片元素用于搜索
      const allImageItems: HTMLElement[] = [];
      
      // 创建图片预览网格
      for (const file of imageFiles) {
        // 添加图片预览
        
        const itemEl = gridEl.createEl('div', { cls: 'about-blank-image-item' });
        
        // 存储文件信息用于搜索
        itemEl.dataset.filePath = file.path;
        itemEl.dataset.fileName = file.name.toLowerCase();
        
        // 创建图片预览
        const imgEl = itemEl.createEl('img', { cls: 'about-blank-image-preview' });
        
        // 获取图片URL
        const resourcePath = this.app.vault.getResourcePath(file);
        imgEl.src = resourcePath;
        
        // 添加文件名
        const nameEl = itemEl.createEl('div', { cls: 'about-blank-image-name' });
        nameEl.textContent = file.name;
        
        // 添加点击事件
        itemEl.addEventListener('click', async () => {
          // 选择图片
          
          // 移除之前的选中状态
          document.querySelectorAll('.about-blank-image-item.selected').forEach(el => {
            el.classList.remove('selected');
          });
          
          // 添加选中状态
          itemEl.classList.add('selected');
          selectedPath = file.path;
          
          // 延迟关闭模态框，让用户看到选中效果
          setTimeout(() => {
            modal.close();
          }, 200);
        });
        
        // 处理图片加载错误
        imgEl.addEventListener('error', () => {
          imgEl.hide();
          itemEl.createEl('div', { 
            cls: 'about-blank-image-preview about-blank-image-placeholder',
            text: '📄'
          });
        });
        
        allImageItems.push(itemEl);
      }
      
      // 添加搜索功能
      searchInput.addEventListener('input', (e) => {
        const searchTerm = (e.target as HTMLInputElement).value.toLowerCase();
        
        allImageItems.forEach(item => {
          const fileName = item.dataset.fileName ?? '';
          const shouldShow = !searchTerm || fileName.includes(searchTerm);
          item.style.display = shouldShow ? 'flex' : 'none';
        });
      });
      
      // 聚焦搜索框
      setTimeout(() => {
        searchInput.focus();
      }, 100);
      
      // 打开模态框
      return new Promise((resolve) => {
        modal.onClose = () => {
          // 模态框关闭，保存选择的路径
          resolve(selectedPath);
        };
        modal.open();
      });
    } catch (error) {
      loggerOnError(error, "文件选择失败\n(About Blank)");
      new Notice("文件选择失败", 3000);
      return null;
    }
  }

  async showFolderSelectionDialog(): Promise<string | null> {
    try {
      // 获取所有文件夹
      const files = this.app.vault.getAllLoadedFiles();
      const folders = files.filter(file => file instanceof TFolder) as TFolder[];
      
      // 创建文件夹选择器
      const modal = new Modal(this.app);
      modal.modalEl.addClass('about-blank-folder-modal');
      
      // 创建头部
      const headerEl = modal.contentEl.createEl('div', { cls: 'about-blank-folder-selector-header' });
      headerEl.createEl('h3', { text: '选择文件夹' });
      
      // 添加搜索框
      const searchContainer = modal.contentEl.createEl('div', { cls: 'about-blank-folder-search-container' });
      const searchInput = searchContainer.createEl('input', { 
        type: 'text',
        placeholder: '搜索文件夹...',
        cls: 'about-blank-folder-search-input'
      });
      
      const listEl = modal.contentEl.createEl('div', { cls: 'about-blank-folder-list' });
      
      let selectedPath: string | null = null;
      
      // 存储所有文件夹元素用于搜索
      const allFolderItems: HTMLElement[] = [];
      
      if (folders.length === 0) {
        const emptyEl = listEl.createEl('div', { cls: 'about-blank-folder-empty' });
        const iconContainer = emptyEl.createEl('div', { cls: 'about-blank-empty-icon' });
        setIcon(iconContainer, 'folder-x');
        const textContainer = emptyEl.createEl('div', { cls: 'about-blank-empty-text' });
        textContainer.textContent = '未找到任何文件夹';
      }
      
      // 创建文件夹列表，参考React组件的设计
      for (const folder of folders) {
        const itemEl = listEl.createEl('div', { cls: 'about-blank-folder-item' });
        
        // 存储文件夹信息用于搜索
        itemEl.dataset.folderPath = folder.path;
        itemEl.dataset.folderName = folder.name.toLowerCase();
        
        // 添加文件夹图标
        const iconEl = itemEl.createEl('div', { cls: 'about-blank-folder-icon' });
        setIcon(iconEl, 'folder');
        
        // 添加文件夹信息容器
        const infoEl = itemEl.createEl('div', { cls: 'about-blank-folder-info' });
        
        // 添加文件夹名
        const nameEl = infoEl.createEl('div', { cls: 'about-blank-folder-name' });
        nameEl.textContent = folder.name;
        
        // 添加路径
        const pathEl = infoEl.createEl('div', { cls: 'about-blank-folder-path' });
        pathEl.textContent = folder.path;
        
        // 添加点击事件
        itemEl.addEventListener('click', () => {
          // 移除之前的选中状态
          document.querySelectorAll('.about-blank-folder-item.selected').forEach(el => {
            el.classList.remove('selected');
          });
          
          // 添加选中状态
          itemEl.classList.add('selected');
          selectedPath = folder.path;
          
          // 延迟关闭模态框，让用户看到选中效果
          setTimeout(() => {
            modal.close();
          }, 200);
        });
        
        allFolderItems.push(itemEl);
      }
      
      // 添加搜索功能
      searchInput.addEventListener('input', (e) => {
        const searchTerm = (e.target as HTMLInputElement).value.toLowerCase();
        let visibleCount = 0;
        
        allFolderItems.forEach(item => {
          const folderName = item.dataset.folderName ?? '';
          const folderPath = (item.dataset.folderPath ?? '').toLowerCase();
          const shouldShow = !searchTerm || folderName.includes(searchTerm) || folderPath.includes(searchTerm);
          item.style.display = shouldShow ? 'flex' : 'none';
          if (shouldShow) visibleCount++;
        });
        
        // 显示或隐藏空状态
        let emptyEl = listEl.querySelector('.about-blank-folder-empty') as HTMLElement;
        if (visibleCount === 0 && !emptyEl) {
          emptyEl = listEl.createEl('div', { cls: 'about-blank-folder-empty' });
          const iconContainer = emptyEl.createEl('div', { cls: 'about-blank-empty-icon' });
          setIcon(iconContainer, 'search-x');
          const textContainer = emptyEl.createEl('div', { cls: 'about-blank-empty-text' });
          textContainer.textContent = '未找到匹配的文件夹';
          const hintContainer = emptyEl.createEl('div', { cls: 'about-blank-empty-hint' });
          hintContainer.textContent = '尝试使用不同的关键词搜索';
        } else if (visibleCount > 0 && emptyEl) {
          emptyEl.remove();
        }
      });
      
      // 聚焦搜索框
      setTimeout(() => {
        searchInput.focus();
      }, 100);
      
      // 打开模态框
      return new Promise((resolve) => {
        modal.onClose = () => {
          // 模态框关闭，保存选择的路径
          resolve(selectedPath);
        };
        modal.open();
      });
    } catch (error) {
      loggerOnError(error, "文件夹选择失败\n(About Blank)");
      new Notice("文件夹选择失败", 3000);
      return null;
    }
  }
}
