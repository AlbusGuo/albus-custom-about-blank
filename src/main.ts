import {
  type Command,
  type TFile,
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
    // 监听工作区事件，确保在标签页切换时也能渲染热力图
    this.app.workspace.on('active-leaf-change', () => {
      setTimeout(() => {
        if (this.settings.heatmapEnabled && (this as any).globalRenderHeatmap && (this as any).heatmapDataCache) {
          (this as any).globalRenderHeatmap();
        }
      }, 100);
    });
    
    // 使用MutationObserver监听DOM变化，但只监听工作区容器，减少性能影响
    const workspaceContainer = document.querySelector('.workspace');
    if (workspaceContainer) {
      const observer = new MutationObserver((mutations) => {
        let shouldRerender = false;
        
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList') {
            // 只检查直接添加的空标签页，不检查子树
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node as Element;
                if (element.classList.contains('workspace-leaf-content') && 
                    element.getAttribute('data-type') === 'empty') {
                  shouldRerender = true;
                }
              }
            });
          }
        });
        
        if (shouldRerender && this.settings.heatmapEnabled && 
            (this as any).globalRenderHeatmap && (this as any).heatmapDataCache) {
          setTimeout(() => {
            (this as any).globalRenderHeatmap();
          }, 200);
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

  changeHeatmapYear = (heatmapContainer: HTMLElement, newYear: number, colorSegments: any[], dateCountMap: { [key: string]: number }): void => {
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
    
    // 清空热力图容器
    heatmapContainer.empty();
    
    // 重新创建热力图内容
    this.createHeatmapContent(heatmapContainer, newYear, colorSegments, newDateCountMap);
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
      
      // Set logo position
      root.style.setProperty('--about-blank-logo-position', this.settings.logoPosition);
      
      // Update container class for positioning and style
      const emptyContainers = document.querySelectorAll('.workspace-leaf-content[data-type="empty"] .empty-state-container');
      emptyContainers.forEach(container => {
        // Remove existing position and style classes
        container.classList.remove('logo-top', 'logo-center', 'logo-bottom', 'logo-mask', 'logo-original');
        
        // Add new position and style classes if logo is enabled
        if (this.settings.logoEnabled) {
          container.classList.add(`logo-${this.settings.logoPosition}`);
          container.classList.add(`logo-${this.settings.logoStyle || 'mask'}`);
        }
      });
      
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
}
