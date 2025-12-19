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
} from "src/constants";

import {
  UNSAFE_CSS_CLASSES,
  UNSAFE_VIEW_TYPES,
  type UnsafeEmptyView,
} from "src/unsafe";

// =============================================================================

export default class AboutBlank extends Plugin {
  settings: AboutBlankSettings;
  needToResisterActions: boolean;
  needToRemoveActions: boolean;
  needToResisterQuickActions: boolean;

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
        // Apply logo settings
        this.applyLogoSettings();
        // Apply heatmap settings
        this.applyHeatmapSettings();
        // Reset for lazy loading
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
    // Reset all New tabs
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
    // Apply logo settings
    this.applyLogoSettings();
    // Apply heatmap settings
    this.applyHeatmapSettings();
    // Reset all New tabs
    this.closeAllNewTabs();
  };

  // 保存设置但不刷新页面
  saveSettingsSilent = async () => {
    await this.saveData(this.settings);
  };

  // ---------------------------------------------------------------------------

  registerCmdToObsidian = (action: PracticalAction): void => {
    if (typeof action.cmdId !== "string" || typeof action.name !== "string") {
      new Notice("命令注册失败\n(About Blank)");
      // 命令注册失败，静默处理
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
      // Explicitly true
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
    const cmdOrgActions = allOriginalActions.filter((action) => action.cmd ? true : false); // Safe side
    const orgCmdIds = cmdOrgActions.map((action) => action.cmdId);

    const cmdModActions = allModifiedActions.filter((action) => action.cmd === true); // Safe side
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
      this.settings.actions.filter((action) => action.display === true),
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

  addButtonsToNewTab = (emptyView: UnsafeEmptyView): void => {
    try {
      const emptyActionListEl = emptyView.actionListEl;
      const emptyTitleEl = emptyView.emptyTitleEl;
      const childElements = emptyActionListEl
        ? Array.from(emptyActionListEl.children) as HTMLElement[]
        : null;
      this.applyVisibleClass(emptyTitleEl, childElements);
      // Apply logo settings
      this.applyLogoSettings();
      // Apply heatmap settings
      this.applyHeatmapSettings();
      // Additional actions by "About Blank"
      if (!emptyActionListEl || !childElements) {
        return;
      }
      if (this.alreadyAdded(childElements)) {
        return;
      }
      const practicalActions: PracticalAction[] = this.settings.actions
        .filter((action) => action.display === true) // Explicitly true
        .map((action) => toPracticalAction(this.app, action))
        .filter((action) => action !== undefined);
      // Expect: emptyActionListEl has `createEl()` method.
      practicalActions.forEach((action) => this.addActionButton(emptyActionListEl, action));
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
    // 检查是否已经添加了图标
    if (actionEl.querySelector('.about-blank-default-icon')) {
      return;
    }
    
    // 获取原始文本内容作为悬浮提示
    const originalText = actionEl.textContent?.trim() || '';
    
    // 创建图标容器
    const iconContainer = document.createElement('div');
    iconContainer.addClass('about-blank-default-icon');
    iconContainer.addClass('about-blank-tooltip');
    
    // 根据action类型添加不同的图标
    let iconName = 'file'; // 默认图标
    
    if (actionEl.classList.contains('mod-close')) {
      iconName = 'x'; // 关闭按钮
    } else if (originalText.includes('新建') || originalText.includes('New')) {
      iconName = 'file-plus'; // 新建按钮
    } else if (originalText.includes('打开') || originalText.includes('Open')) {
      iconName = 'folder'; // 打开按钮
    } else if (originalText.includes('今日') || originalText.includes('Today')) {
      iconName = 'calendar-days'; // 今日按钮
    } else if (originalText.includes('帮助') || originalText.includes('Help')) {
      iconName = 'circle-help'; // 帮助按钮
    } else if (originalText.includes('文件夹') || originalText.includes('Folder')) {
      iconName = 'folder-open'; // 文件夹相关
    } else if (originalText.includes('最近') || originalText.includes('Recent')) {
      iconName = 'clock'; // 最近文件
    } else if (originalText.includes('工作区') || originalText.includes('Workspace')) {
      iconName = 'layout'; // 工作区
    } else if (originalText.includes('模板') || originalText.includes('Template')) {
      iconName = 'file-text'; // 模板
    }
    
    // 创建Lucide图标
    setIcon(iconContainer, iconName);
    
    // 添加悬浮提示 - 使用自定义data属性而不是title属性
    if (originalText) {
      iconContainer.setAttribute('data-tooltip', originalText);
    }
    
    // 清空原始内容并添加图标
    actionEl.empty();
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
        cls: `${UNSAFE_CSS_CLASSES.defaultEmptyAction} ${CSS_CLASSES.visible} ${CSS_CLASSES.aboutBlankContainer} about-blank-tooltip`,
      },
      (elem: Element) => {
        elem.addEventListener("click", () => {
          void action.callback();
        });
      },
    );
    
    // 添加悬浮提示 - 使用自定义data属性而不是title属性
    container.setAttribute('data-tooltip', action.name);
    
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

  applyStatsSettings = (): void => {
    try {
      if (this.settings.showStats) {
        // 创建统计气泡
        this.createStatsBubbles();
        
        // 添加工作区事件监听
        this.registerWorkspaceEvents();
      } else {
        // 移除统计气泡容器
        const statsContainers = document.querySelectorAll('.about-blank-stats-bubbles');
        statsContainers.forEach(container => container.remove());
        
        // 清除全局渲染函数
        if ((this as any).globalRenderStats) {
          (this as any).globalRenderStats = null;
        }
      }
    } catch (error) {
      loggerOnError(error, "应用统计设置失败\n(About Blank)");
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
        if ((this as any).heatmapRenderInterval) {
          clearInterval((this as any).heatmapRenderInterval);
          (this as any).heatmapRenderInterval = null;
        }
      }
    } catch (error) {
      loggerOnError(error, "应用热力图设置失败\n(About Blank)");
    }
  };

  registerWorkspaceEvents = (): void => {
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
        if (this.settings.heatmapEnabled && (this as any).globalRenderHeatmap && (this as any).heatmapDataCache) {
          (this as any).globalRenderHeatmap();
        }
        
        // 渲染统计气泡（使用防抖）
        if (this.settings.showStats && (this as any).globalRenderStats) {
          (this as any).globalRenderStats();
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
          
          observerTimeout = setTimeout(() => {
            if (isProcessing) return; // 再次检查处理状态
            
            isProcessing = true; // 设置处理状态
            
            // 渲染热力图
            if (this.settings.heatmapEnabled && 
                (this as any).globalRenderHeatmap && (this as any).heatmapDataCache) {
              (this as any).globalRenderHeatmap();
            }
            
            // 渲染统计气泡（使用防抖）
            if (this.settings.showStats && (this as any).globalRenderStats) {
              (this as any).globalRenderStats();
            }
            
            // 重置处理状态
            setTimeout(() => {
              isProcessing = false;
            }, 500); // 确保渲染完成后再重置
          }, hasNewEmptyLeaf ? 100 : 300); // 新标签页更快响应
        }
      });
      
      // 只观察工作区容器的直接子元素变化，不观察子树
      observer.observe(workspaceContainer, {
        childList: true
      });
      
      // 保存observer引用以便清理
      (this as any).heatmapObserver = observer;
    }
  };

  setupHeatmapPeriodicRender = (): void => {
    // 清除现有的定时器
    if ((this as any).heatmapRenderInterval) {
      clearInterval((this as any).heatmapRenderInterval);
    }
    
    // 立即执行一次
    if ((this as any).globalRenderHeatmap && (this as any).heatmapDataCache) {
      (this as any).globalRenderHeatmap();
    }
    
    // 添加防抖机制，避免频繁渲染
    let lastRenderTime = 0;
    const renderDebounceTime = 2000; // 2秒内只渲染一次
    
    // 设置定期检查和渲染，但降低频率并添加条件检查
    (this as any).heatmapRenderInterval = setInterval(() => {
      const now = Date.now();
      
      // 检查是否在防抖期内
      if (now - lastRenderTime < renderDebounceTime) {
        return;
      }
      
      // 检查所有空标签页
      const emptyLeaves = document.querySelectorAll('.workspace-leaf-content[data-type="empty"]');
      
      // 只在有新标签页时才渲染
      let needsRender = false;
      emptyLeaves.forEach((leaf) => {
        if (!leaf.querySelector('.about-blank-heatmap-container')) {
          needsRender = true;
        }
      });
      
      // 如果有新标签页且有缓存的数据，重新渲染
      if (needsRender && (this as any).globalRenderHeatmap && (this as any).heatmapDataCache) {
        (this as any).globalRenderHeatmap();
        lastRenderTime = now;
      }
    }, 3000); // 每3秒检查一次，进一步降低频率
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
      
      // 确保热力图在设置变更时也能更新
      setTimeout(() => {
        this.renderHeatmap(dateCountMap);
      }, 50);
    } catch (error) {
      loggerOnError(error, "生成热力图数据失败\n(About Blank)");
    }
  };

  renderHeatmap = (dateCountMap: { [key: string]: number }): void => {
    try {
      const year = new Date().getFullYear();
      const colorSegments = this.settings.heatmapColorSegments;
      
      // 缓存数据供后续使用
      (this as any).heatmapDataCache = dateCountMap;
      
      const renderHeatmapInAllLeaves = () => {
        // 获取所有空的新标签页
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
          
          // 清空容器
          heatmapContainer.innerHTML = '';
          
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
      
      // 立即渲染
      renderHeatmapInAllLeaves();
      
      // 延迟再次渲染，确保在DOM完全加载后也能显示
      setTimeout(renderHeatmapInAllLeaves, 100);
      setTimeout(renderHeatmapInAllLeaves, 500);
      
      // 设置全局热力图渲染函数，供后续调用
      (this as any).globalRenderHeatmap = renderHeatmapInAllLeaves;
      
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
        // 移除所有现有的统计气泡
        const existingStatsContainers = document.querySelectorAll('.about-blank-stats-bubbles');
        existingStatsContainers.forEach(container => container.remove());
        return;
      }
      
      // 缓存统计数据，避免重复计算
      let cachedStats: Array<{id: string, label: string, value: number | string}> | null = null;
      let lastStatsUpdate = 0;
      const STATS_CACHE_DURATION = 1000; // 1秒缓存
      
      const getStatsData = () => {
        const now = Date.now();
        if (cachedStats && (now - lastStatsUpdate) < STATS_CACHE_DURATION) {
          return cachedStats;
        }
        
        // 基础统计项目
        const baseStats = [
          { id: 'usage-days', label: "使用天数", value: this.calculateUsageDays() },
          { id: 'file-count', label: "文件数量", value: this.calculateTotalFileCount() },
          { id: 'storage-size', label: "存储空间", value: `${this.calculateTotalFileSize()}G` }
        ];

        // 自定义统计项目
        const customStatsItems = (this.settings.customStats || []).map((stat: any, index: number) => ({
          id: `custom-${index}`,
          label: stat.displayName || stat.value || `统计项目${index + 1}`,
          value: this.calculateCustomStatCount(stat)
        }));

        // 合并所有统计项目
        cachedStats = [...baseStats, ...customStatsItems];
        lastStatsUpdate = now;
        return cachedStats;
      };
      
      // 防抖渲染函数
      let renderTimeout: NodeJS.Timeout | null = null;
      const debouncedRender = () => {
        if (renderTimeout) {
          clearTimeout(renderTimeout);
        }
        renderTimeout = setTimeout(() => {
          renderStatsInAllLeavesImpl();
        }, 50); // 50ms防抖
      };
      
      const renderStatsInAllLeavesImpl = () => {
        // 获取所有空的新标签页
        const emptyLeaves = document.querySelectorAll('.workspace-leaf-content[data-type="empty"]');
        
        if (emptyLeaves.length === 0) return;
        
        // 获取统计数据（使用缓存）
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
        
        emptyLeaves.forEach(leaf => {
          // 查找空状态容器
          const container = leaf.querySelector('.empty-state-container') as HTMLElement;
          if (!container) return;
          
          // 检查容器是否已经完全加载和渲染
          const actionList = container.querySelector('.empty-state-action-list');
          if (!actionList) return; // 等待action列表加载完成
          
          // 检查是否已经有统计气泡
          const existingStats = container.querySelector('.about-blank-stats-bubbles');
          if (existingStats) return; // 已存在则跳过，避免重复渲染
          
          // 检查logo是否已经渲染
          const hasLogo = container.classList.contains('logo-top') || 
                         container.querySelector('.empty-state-container::before');

          // 创建统计气泡容器
          const statsContainer = container.createEl('div', { cls: 'about-blank-stats-bubbles' });

          // 缓存位置计算结果
          const containerHeight = container.clientHeight || 400;
          const logoSize = this.settings.logoSize || 120;
          const bubbleSpacing = 50;
          const sideMargin = 20;
          
          // logo固定在顶部，距离顶部约20%的位置
          const logoActualY = containerHeight * 0.2;
          
          // 计算每侧的气泡数量
          const leftCount = Math.ceil(allStats.length / 2);
          const rightCount = Math.floor(allStats.length / 2);
          const maxBubblesPerSide = Math.max(leftCount, rightCount);
          
          // 计算气泡可用的垂直空间
          const availableSpaceBelow = containerHeight - logoActualY - (logoSize / 2) - 100;
          const availableSpaceAbove = logoActualY - (logoSize / 2) - 50;
          
          // 计算气泡分布策略
          let adjustedSpacing = bubbleSpacing;
          let distributeAbove = false;
          
          if (availableSpaceBelow < (maxBubblesPerSide - 1) * bubbleSpacing) {
            if (availableSpaceAbove > availableSpaceBelow) {
              distributeAbove = true;
              adjustedSpacing = Math.min(bubbleSpacing, availableSpaceAbove / Math.max(maxBubblesPerSide - 1, 1));
            } else {
              adjustedSpacing = Math.min(bubbleSpacing, availableSpaceBelow / Math.max(maxBubblesPerSide - 1, 1));
            }
          }
          
          // 创建统计气泡
          orderedStats.forEach((stat, index) => {
            if (!stat) return;
            
            const isLeft = index % 2 === 0;
            const sideIndex = isLeft ? Math.floor(index / 2) : Math.floor(index / 2);
            
            // 计算垂直位置
            let verticalOffset;
            if (maxBubblesPerSide === 1) {
              verticalOffset = 0;
            } else {
              const totalSpan = (maxBubblesPerSide - 1) * adjustedSpacing;
              verticalOffset = -totalSpan / 2 + (sideIndex * adjustedSpacing);
            }
            
            // 计算最终位置
            let finalY;
            if (distributeAbove) {
              finalY = logoActualY - (logoSize / 2) - sideMargin - Math.abs(verticalOffset);
            } else {
              finalY = logoActualY + (logoSize / 2) + sideMargin + verticalOffset;
            }
            
            const bubble = statsContainer.createEl('div', { cls: 'about-blank-stats-bubble' });
            
            // 根据左右位置添加样式类
            if (isLeft) {
              bubble.addClass('about-blank-stats-bubble-left');
            } else {
              bubble.addClass('about-blank-stats-bubble-right');
            }
            
            // 设置拖拽属性
            bubble.setAttribute('draggable', 'true');
            bubble.setAttribute('data-stat-id', stat.id);
            
            // 设置最终计算的位置
            bubble.style.top = `${finalY}px`;
            
            // 创建统计内容
            const label = bubble.createEl('div', { cls: 'about-blank-stats-bubble-label' });
            label.textContent = stat.label;
            
            const value = bubble.createEl('div', { cls: 'about-blank-stats-bubble-value' });
            value.textContent = stat.value.toString();
            
            // 添加拖拽事件监听器
            bubble.addEventListener('dragstart', (e) => {
              e.dataTransfer?.setData('text/plain', stat.id);
              bubble.classList.add('about-blank-stats-bubble-dragging');
              e.dataTransfer!.effectAllowed = 'move';
            });
            
            bubble.addEventListener('dragend', () => {
              bubble.classList.remove('about-blank-stats-bubble-dragging');
              // 移除所有拖拽悬停样式
              document.querySelectorAll('.about-blank-stats-bubble-drag-over').forEach(el => {
                el.classList.remove('about-blank-stats-bubble-drag-over');
              });
            });
            
            bubble.addEventListener('dragover', (e) => {
              e.preventDefault();
              e.dataTransfer!.dropEffect = 'move';
              if (!bubble.classList.contains('about-blank-stats-bubble-drag-over')) {
                bubble.classList.add('about-blank-stats-bubble-drag-over');
              }
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
                // 获取当前顺序
                const currentOrder = this.settings.statOrder.length > 0 ? [...this.settings.statOrder] : orderedStats.map(s => s?.id || '');
                
                // 确保所有统计项目都在排序数组中
                orderedStats.forEach(s => {
                  if (s && !currentOrder.includes(s.id)) {
                    currentOrder.push(s.id);
                  }
                });
                
                const draggedIndex = currentOrder.indexOf(draggedStatId);
                const targetIndex = currentOrder.indexOf(targetStatId);
                
                if (draggedIndex !== -1 && targetIndex !== -1) {
                  // 两个气泡互换位置
                  const temp = currentOrder[draggedIndex];
                  currentOrder[draggedIndex] = currentOrder[targetIndex];
                  currentOrder[targetIndex] = temp;
                  
                  // 保存新顺序（静默保存，不刷新页面）
                  this.settings.statOrder = currentOrder;
                  this.saveSettingsSilent();
                  
                  // 只交换两个气泡的位置，避免全局重新渲染
                  const allBubbles = Array.from(statsContainer.querySelectorAll('.about-blank-stats-bubble')) as HTMLElement[];
                  const draggedBubble = allBubbles.find(b => b.getAttribute('data-stat-id') === draggedStatId);
                  const targetBubble = allBubbles.find(b => b.getAttribute('data-stat-id') === targetStatId);
                  
                  if (draggedBubble && targetBubble) {
                    // 交换两个气泡的位置
                    const draggedTop = (draggedBubble as HTMLElement).style.top;
                    const targetTop = (targetBubble as HTMLElement).style.top;
                    
                    // 交换位置
                    (draggedBubble as HTMLElement).style.top = targetTop;
                    (targetBubble as HTMLElement).style.top = draggedTop;
                    
                    // 交换左右类名
                    const draggedHasLeft = draggedBubble.classList.contains('about-blank-stats-bubble-left');
                    const targetHasLeft = targetBubble.classList.contains('about-blank-stats-bubble-left');
                    
                    if (draggedHasLeft !== targetHasLeft) {
                      if (draggedHasLeft) {
                        draggedBubble.classList.remove('about-blank-stats-bubble-left');
                        draggedBubble.classList.add('about-blank-stats-bubble-right');
                        targetBubble.classList.remove('about-blank-stats-bubble-right');
                        targetBubble.classList.add('about-blank-stats-bubble-left');
                      } else {
                        draggedBubble.classList.remove('about-blank-stats-bubble-right');
                        draggedBubble.classList.add('about-blank-stats-bubble-left');
                        targetBubble.classList.remove('about-blank-stats-bubble-left');
                        targetBubble.classList.add('about-blank-stats-bubble-right');
                      }
                    }
                    
                    // 添加交换动画效果
                    draggedBubble.style.transition = 'top 0.3s ease';
                    targetBubble.style.transition = 'top 0.3s ease';
                    
                    // 移除过渡效果
                    setTimeout(() => {
                      draggedBubble.style.transition = '';
                      targetBubble.style.transition = '';
                    }, 300);
                  }
                }
              }
            });
          });
        });
      };
      
      // 导出防抖渲染函数
      const renderStatsInAllLeaves = debouncedRender;
      
      // 优化的智能等待渲染函数
      let waitTimeout: NodeJS.Timeout | null = null;
      const waitForReadyAndRender = (retryCount = 0) => {
        if (retryCount > 5) return; // 减少重试次数
        
        // 检查是否有至少一个完全准备好的容器
        const emptyLeaves = document.querySelectorAll('.workspace-leaf-content[data-type="empty"]');
        if (emptyLeaves.length === 0) return;
        
        let hasReadyContainer = false;
        
        for (let i = 0; i < emptyLeaves.length; i++) {
          const leaf = emptyLeaves[i];
          const container = leaf.querySelector('.empty-state-container');
          if (container && container.querySelector('.empty-state-action-list')) {
            hasReadyContainer = true;
            break;
          }
        }
        
        if (hasReadyContainer) {
          // 容器已准备好，进行渲染
          renderStatsInAllLeaves();
        } else {
          // 容器未准备好，等待后重试
          waitTimeout = setTimeout(() => waitForReadyAndRender(retryCount + 1), 200); // 增加等待时间
        }
      };
      
      // 开始智能等待渲染
      waitForReadyAndRender();
      
      // 设置全局统计渲染函数，供后续调用
      (this as any).globalRenderStats = renderStatsInAllLeaves;
      
    } catch (error) {
      loggerOnError(error, "渲染统计气泡失败\n(About Blank)");
    }
  };

  changeHeatmapYear = (heatmapContainer: HTMLElement, newYear: number, colorSegments: any[], dateCountMap: { [key: string]: number }): void => {
    // 检查是否已经有该年份的缓存数据
    if (!(this as any).heatmapYearCache) {
      (this as any).heatmapYearCache = {};
    }
    
    const yearCache = (this as any).heatmapYearCache;
    
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
      // 找到当前热力图容器所属的标签页
      const parentLeaf = heatmapContainer.closest('.workspace-leaf-content[data-type="empty"]') as HTMLElement;
      
      // 获取当前标签页的action list的宽度并设置热力图容器宽度
      if (parentLeaf) {
        const actionList = parentLeaf.querySelector('.empty-state-action-list') as HTMLElement;
        if (actionList) {
          const actionListWidth = actionList.offsetWidth;
          // 设置热力图容器宽度至少与action list一致，但不限制最大宽度
          heatmapContainer.style.width = `${Math.max(actionListWidth, 800)}px`;
          heatmapContainer.style.maxWidth = 'none';
          // 移除滚动条设置
        }
      }
      
      // 创建热力图控制容器
      const controlsContainer = heatmapContainer.createEl('div', { cls: 'about-blank-heatmap-controls' });
      
      // 创建年份切换按钮
      const prevButton = controlsContainer.createEl('button', { cls: 'about-blank-heatmap-year-button about-blank-heatmap-year-prev' });
      prevButton.innerHTML = '‹';
      prevButton.addEventListener('click', () => {
        this.changeHeatmapYear(heatmapContainer, year - 1, colorSegments, dateCountMap);
      });
      
      const yearDisplay = controlsContainer.createEl('div', { cls: 'about-blank-heatmap-year-display' });
      yearDisplay.textContent = year.toString();
      
      const nextButton = controlsContainer.createEl('button', { cls: 'about-blank-heatmap-year-button about-blank-heatmap-year-next' });
      nextButton.innerHTML = '›';
      nextButton.addEventListener('click', () => {
        this.changeHeatmapYear(heatmapContainer, year + 1, colorSegments, dateCountMap);
      });
      
      // 创建热力图容器
      const chartsEl = heatmapContainer.createEl('div', { cls: 'about-blank-heatmap-charts' });
      
      // 创建星期标签列
      const weekTextColumns = chartsEl.createEl('div', { cls: 'about-blank-heatmap-column' });
      this.renderWeekIndicator(weekTextColumns);
      
      // 生成贡献数据
      const contributionData = this.generateContributionData(dateCountMap);
      
      // 填充开始前的空白格子
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
      
      // 创建热力图列
      let columnEl: HTMLElement | null = null;
      for (let i = 0; i < contributionData.length; i++) {
        // 每7个格子创建一个新列（一周）
        if (i % 7 === 0) {
          columnEl = chartsEl.createEl('div', { cls: 'about-blank-heatmap-column' });
        }
        
        const contributionItem = contributionData[i];
        
        // 每月第一天添加月份标签
        if (contributionItem.monthDate === 1 && columnEl) {
          const monthCell = columnEl.createEl('div', { cls: 'about-blank-heatmap-month-indicator' });
          const months = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
          monthCell.textContent = months[contributionItem.month];
          
          // 确保月份标签精确对齐到1号所在的列
          monthCell.style.position = 'absolute';
          monthCell.style.top = '-24px';
          monthCell.style.left = '0';
          monthCell.style.width = '100%';
          monthCell.style.textAlign = 'center';
        }
        
        // 创建格子
        if (columnEl) {
          const cellEl = columnEl.createEl('div', { cls: 'about-blank-heatmap-cell' });
          
          if (contributionItem.count === 0) {
            if (contributionItem.date !== "$HOLE$") {
              cellEl.addClass('empty');
              cellEl.setAttribute('data-level', '0');
              cellEl.setAttribute('data-date', contributionItem.date);
              cellEl.setAttribute('data-count', '0');
              
              // 根据数量设置颜色
              const color = this.getHeatmapColor(0);
              cellEl.style.backgroundColor = color;
            } else {
              cellEl.setAttribute('data-level', '0');
            }
          } else {
            cellEl.setAttribute('data-level', this.getHeatmapLevel(contributionItem.count));
            cellEl.setAttribute('data-date', contributionItem.date);
            cellEl.setAttribute('data-count', contributionItem.count.toString());
            
            // 根据数量设置颜色
            const color = this.getHeatmapColor(contributionItem.count);
            cellEl.style.backgroundColor = color;
            
            // 添加可点击类名
            cellEl.addClass('about-blank-heatmap-cell-clickable');
            
            // 添加点击事件
            cellEl.addEventListener('click', () => {
              this.showHeatmapModal(contributionItem.date, contributionItem.count);
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

  

  showHeatmapModal = (dateStr: string, count: number): void => {
    // 这里可以实现模态框显示该日期的文件列表
    // 显示文件信息
  };

  applyLogoSettings = (): void => {
    try {
      const root = document.documentElement;
      
      // Set logo image
      if (this.settings.logoEnabled && this.settings.logoPath) {
        // Convert file path to URL format
        let logoUrl: string;
        
        if (this.settings.logoPath.startsWith('http')) {
          logoUrl = `url("${this.settings.logoPath}")`;
        } else if (this.settings.logoPath.startsWith('data:image')) {
          logoUrl = `url("${this.settings.logoPath}")`;
        } else {
          // Handle Obsidian relative paths
          try {
            const file = this.app.vault.getAbstractFileByPath(this.settings.logoPath);
            if (file) {
              // 使用Obsidian的资源路径API
              const resourcePath = this.app.vault.getResourcePath(file as TFile);
              logoUrl = `url("${resourcePath}")`;
            } else {
              // Fallback for relative paths
              logoUrl = `url("app://local/${this.settings.logoPath}")`;
            }
          } catch (error) {
            // Fallback for relative paths
            logoUrl = `url("app://local/${this.settings.logoPath}")`;
          }
        }
        
        root.style.setProperty('--about-blank-logo-image', logoUrl);
        // 设置Logo URL
      } else {
        root.style.setProperty('--about-blank-logo-image', 'none');
      }
      
      // Set logo size
      const logoSize = `${this.settings.logoSize}px`;
      root.style.setProperty('--about-blank-logo-size', logoSize);
      // 设置Logo大小
      
      // Set logo opacity
      root.style.setProperty('--about-blank-logo-opacity', this.settings.logoOpacity.toString());
      // 设置Logo透明度
      
      // Set logo position (固定为top)
      root.style.setProperty('--about-blank-logo-position', 'top');
      
      // Update container class for positioning and style
      const emptyContainers = document.querySelectorAll('.workspace-leaf-content[data-type="empty"] .empty-state-container');
      emptyContainers.forEach(container => {
        // Remove existing position and style classes
        container.classList.remove('logo-top', 'logo-mask', 'logo-original');
        
        // Add new position and style classes if logo is enabled
        if (this.settings.logoEnabled) {
          container.classList.add('logo-top');
          container.classList.add(`logo-${this.settings.logoStyle || 'mask'}`);
        }
      });
      
      // Create stats bubbles if logo and stats are enabled
      if (this.settings.logoEnabled && this.settings.showStats) {
        setTimeout(() => {
          this.createStatsBubbles();
        }, 150);
      }
      
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
      // 使用Obsidian的文件系统API获取所有图片文件
      const files = this.app.vault.getFiles();
      // 获取文件数量
      
      let imageFiles = files.filter((file: TFile) => 
        file.extension && ['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp', 'webp'].includes(file.extension)
      );
      
      // 如果设置了logo文件目录，只显示该目录下的文件
      if (this.settings.logoDirectory && this.settings.logoDirectory.trim()) {
        const logoDir = this.settings.logoDirectory.trim();
        // 筛选目录
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
      
      // 添加样式
      modal.contentEl.createEl('style', { text: `
        .about-blank-search-container {
          margin: 10px 0;
          padding: 0 10px;
        }
        .about-blank-search-input {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid var(--background-modifier-border);
          border-radius: 4px;
          background-color: var(--background-primary);
          color: var(--text-normal);
          font-size: 14px;
          outline: none;
        }
        .about-blank-search-input:focus {
          border-color: var(--interactive-accent);
        }
        .about-blank-image-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: 15px;
          max-height: 350px;
          overflow-y: auto;
          padding: 10px 0;
        }
        .about-blank-image-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 10px;
          border: 2px solid transparent;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          background-color: var(--background-secondary);
        }
        .about-blank-image-item:hover {
          border-color: var(--interactive-accent);
          background-color: var(--background-modifier-hover);
          transform: translateY(-2px);
        }
        .about-blank-image-item.selected {
          border-color: var(--interactive-accent);
          background-color: var(--background-modifier-hover);
        }
        .about-blank-image-preview {
          width: 80px;
          height: 80px;
          object-fit: contain;
          margin-bottom: 8px;
          border-radius: 4px;
        }
        .about-blank-image-name {
          font-size: 12px;
          text-align: center;
          word-break: break-all;
          color: var(--text-muted);
          line-height: 1.3;
        }
      `});
      
      let selectedPath: string | null = null;
      
      // 存储所有图片元素用于搜索
      const allImageItems: HTMLElement[] = [];
      
      // 创建图片预览网格
      for (const file of imageFiles) {
        // 添加图片预览
        
        const itemEl = gridEl.createEl('div', { cls: 'about-blank-image-item' });
        
        // 存储文件信息用于搜索
        (itemEl as any).filePath = file.path;
        (itemEl as any).fileName = file.name.toLowerCase();
        
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
          // 图片加载失败
          imgEl.style.display = 'none';
          
          // 创建一个占位符
          const placeholderEl = itemEl.createEl('div', { 
            cls: 'about-blank-image-preview',
            text: '📄'
          });
          placeholderEl.style.display = 'flex';
          placeholderEl.style.alignItems = 'center';
          placeholderEl.style.justifyContent = 'center';
          placeholderEl.style.fontSize = '24px';
          placeholderEl.style.backgroundColor = 'var(--background-secondary)';
        });
        
        allImageItems.push(itemEl);
      }
      
      // 添加搜索功能
      searchInput.addEventListener('input', (e) => {
        const searchTerm = (e.target as HTMLInputElement).value.toLowerCase();
        
        allImageItems.forEach(item => {
          const fileName = (item as any).fileName;
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
      
      // 设置模态框样式，参考React组件的设计
      modal.modalEl.style.width = '500px';
      modal.modalEl.style.maxWidth = '90vw';
      modal.modalEl.style.borderRadius = '8px';
      
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
      
      if (folders.length === 0) {
        const emptyEl = listEl.createEl('div', { cls: 'about-blank-folder-empty' });
        const iconContainer = emptyEl.createEl('div', { cls: 'about-blank-empty-icon' });
        setIcon(iconContainer, 'folder-x');
        const textContainer = emptyEl.createEl('div', { cls: 'about-blank-empty-text' });
        textContainer.textContent = '未找到任何文件夹';
      }
      
      // 添加样式，参考React组件的设计风格
      modal.contentEl.createEl('style', { text: `
        .about-blank-folder-selector-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--background-modifier-border);
        }
        
        .about-blank-folder-selector-header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--text-normal);
        }
        
        .about-blank-folder-search-container {
          padding: 12px 20px;
          border-bottom: 1px solid var(--background-modifier-border);
        }
        
        .about-blank-folder-search-input {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid var(--background-modifier-border);
          border-radius: 4px;
          background-color: var(--background-primary);
          color: var(--text-normal);
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s ease;
        }
        
        .about-blank-folder-search-input:focus {
          border-color: var(--interactive-accent);
        }
        
        .about-blank-folder-list {
          max-height: 300px;
          overflow-y: auto;
          padding: 8px 0;
        }
        
        .about-blank-folder-item {
          padding: 10px 20px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 12px;
          transition: background-color 0.2s ease;
          border-bottom: 1px solid transparent;
        }
        
        .about-blank-folder-item:hover {
          background: var(--background-modifier-hover);
        }
        
        .about-blank-folder-item.selected {
          background: var(--interactive-accent);
          color: var(--text-on-accent);
        }
        
        .about-blank-folder-item.selected .about-blank-folder-path {
          color: var(--text-on-accent);
          opacity: 0.8;
        }
        
        .about-blank-folder-icon {
          font-size: 16px;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        
        .about-blank-folder-info {
          flex: 1;
          min-width: 0;
        }
        
        .about-blank-folder-name {
          font-size: 14px;
          font-weight: 500;
          color: inherit;
          margin-bottom: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .about-blank-folder-path {
          font-size: 12px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .about-blank-folder-empty {
          padding: 40px 20px;
          text-align: center;
          color: var(--text-muted);
          font-size: 14px;
        }
        
        .about-blank-empty-icon {
          font-size: 48px;
          margin-bottom: 16px;
          opacity: 0.5;
          color: var(--text-muted);
        }
        
        .about-blank-empty-text {
          font-size: 16px;
          margin-bottom: 8px;
          color: var(--text-muted);
        }
        
        .about-blank-empty-hint {
          font-size: 12px;
          margin-top: 8px;
          opacity: 0.7;
          color: var(--text-muted);
        }
        
        /* 滚动条样式 */
        .about-blank-folder-list::-webkit-scrollbar {
          width: 6px;
        }
        
        .about-blank-folder-list::-webkit-scrollbar-track {
          background: var(--background-primary);
        }
        
        .about-blank-folder-list::-webkit-scrollbar-thumb {
          background: var(--background-modifier-border);
          border-radius: 3px;
        }
        
        .about-blank-folder-list::-webkit-scrollbar-thumb:hover {
          background: var(--background-modifier-border-hover);
        }
      `});
      
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
        (itemEl as any).folderPath = folder.path;
        (itemEl as any).folderName = folder.name.toLowerCase();
        
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
          const folderName = (item as any).folderName;
          const folderPath = (item as any).folderPath.toLowerCase();
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
