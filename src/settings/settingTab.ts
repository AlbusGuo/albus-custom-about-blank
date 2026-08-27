import {
  type App,
  Notice,
  PluginSettingTab,
  Setting,
  SettingGroup,
  setIcon,
  setTooltip,
} from "obsidian";

import {
  ACTION_KINDS,
  type Action,
  genNewCmdId,
  isActionComplete,
  newActionClone,
} from "src/settings/action-basic";

import {
  ActionEditorModal,
} from "src/settings/actionEditorModal";

import {
  CustomStatEditorModal,
} from "src/settings/customStatStudioModal";

import {
  DateStatEditorModal,
} from "src/settings/dateStatStudioModal";

import {
  type DateStatDefinition,
  DATE_STAT_TYPES,
  createDateStat,
  getDateStatTypeLabel,
  isDateStatComplete,
} from "src/settings/dateStatTypes";

import {
  countCustomStatFilterConditions,
  CUSTOM_STAT_FILTER_CONJUNCTIONS,
  CUSTOM_STAT_FILTER_FIELDS,
  createCustomStatDefinition,
  isCustomStatComplete,
  type CustomStatDefinition,
} from "src/utils/customStatQuery";

import {
  loggerOnError,
} from "src/commons";

import type AboutBlank from "src/main";

import {
  ConfirmModal,
} from "src/ui/confirmModal";

import {
  PointerSortController,
} from "src/ui/pointerSort";

import {
  CustomStatFieldCatalog,
} from "src/utils/customStatFieldCatalog";

import {
  getRegisteredCommands,
} from "src/utils/commandRegistry";

import {
  OptionPicker,
  type OptionPickerItem,
} from "src/ui/optionPicker";

// =============================================================================

export class AboutBlankSettingTab extends PluginSettingTab {
  plugin: AboutBlank;
  contentEl!: HTMLElement;
  icon: string = 'app-window';
  private settingsSortController: PointerSortController<HTMLElement> | null = null;
  private customStatEditorModal: CustomStatEditorModal | null = null;
  private customStatEditorIndex: number | null = null;
  private customStatEditorRefreshPending = false;
  private customStatRowElements = new Map<number, HTMLElement>();
  private dateStatEditorModal: DateStatEditorModal | null = null;
  private dateStatEditorIndex: number | null = null;
  private dateStatEditorRefreshPending = false;
  private dateStatRowElements = new Map<number, HTMLElement>();
  private actionEditorModal: ActionEditorModal | null = null;
  private actionEditorIndex: number | null = null;
  private actionEditorRefreshPending = false;
  private actionRowElements = new Map<number, HTMLElement>();
  private readonly settingsOptionPickers = new Set<OptionPicker>();

  constructor(app: App, plugin: AboutBlank) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // ---------------------------------------------------------------------------

  display = (): void => {
    try {
      const { containerEl } = this;

      this.settingsSortController?.destroy();
      this.settingsSortController = null;
      this.destroySettingsOptionPickers();
      containerEl.empty();
      containerEl.addClass('about-blank-settings-root');

      // 创建标签页导航 - 固定在顶部
      const tabNames = ["shortcuts", "logo", "stats", "heatmap"];
      const tabLabels: Record<string, string> = {
        shortcuts: "快捷方式",
        logo: "Logo",
        stats: "统计项目",
        heatmap: "热力图"
      };

      const tabsEl = containerEl.createDiv({ cls: "about-blank-settings-tabs" });
      for (const tabName of tabNames) {
        const tab = tabsEl.createDiv({ cls: "about-blank-settings-tab" });
        if (this.plugin.settings.settingsTab === tabName) {
          tab.classList.add('is-active');
        }
        tab.setText(tabLabels[tabName]);
        tab.addEventListener("click", () => {
          this.plugin.settings.settingsTab = tabName;
          void this.plugin.saveSettingsSilent().catch((error) => {
            loggerOnError(error, "保存设置页签失败\n(About Blank)");
          });
          this.display();
        });
      }

      // 可滚动内容区域
      const scrollEl = containerEl.createDiv({ cls: "about-blank-settings-scroll" });
      this.contentEl = scrollEl.createDiv({ cls: "about-blank-settings-content" });
      this.renderCurrentTab();
    } catch (error) {
      loggerOnError(error, "Error in settings.\n(About Blank)");
    }
  };

  hide(): void {
    this.destroySettingsOptionPickers();
    super.hide();
  }

  /**
   * 渲染当前选择的标签页内容
   */
  renderCurrentTab = (): void => {
    const contentEl = this.contentEl;
    if (!contentEl) return;
    const scrollEl = contentEl.parentElement;
    const previousScrollTop = scrollEl?.scrollTop ?? 0;

    const activeActionIndex = this.plugin.settings.settingsTab === "shortcuts"
      ? this.actionEditorIndex
      : null;
    const activeCustomStatIndex = this.plugin.settings.settingsTab === "stats"
      ? this.customStatEditorIndex
      : null;
    const activeDateStatIndex = this.plugin.settings.settingsTab === "stats"
      ? this.dateStatEditorIndex
      : null;
    this.closeActionEditor(false);
    this.closeCustomStatEditor(false);
    this.closeDateStatEditor(false);
    this.settingsSortController?.destroy();
    this.settingsSortController = null;
    this.destroySettingsOptionPickers();
    contentEl.empty();
    this.actionRowElements.clear();
    this.customStatRowElements.clear();
    this.dateStatRowElements.clear();

    if (this.plugin.settings.settingsTab === "shortcuts") {
      this.makeSettingsShortcuts(contentEl);
      if (activeActionIndex !== null && activeActionIndex < this.plugin.settings.actions.length) {
        this.actionEditorIndex = activeActionIndex;
        requestAnimationFrame(() => {
          this.reopenActionEditor();
        });
      }
    } else if (this.plugin.settings.settingsTab === "logo") {
      this.actionEditorIndex = null;
      this.makeSettingsLogo(contentEl);
    } else if (this.plugin.settings.settingsTab === "stats") {
      this.actionEditorIndex = null;
      this.makeSettingsStats(contentEl);
      if (activeCustomStatIndex !== null && activeCustomStatIndex < this.plugin.settings.customStats.length) {
        this.customStatEditorIndex = activeCustomStatIndex;
        requestAnimationFrame(() => {
          this.reopenCustomStatEditor();
        });
      }
      if (activeDateStatIndex !== null && activeDateStatIndex < this.plugin.settings.dateStats.length) {
        this.dateStatEditorIndex = activeDateStatIndex;
        requestAnimationFrame(() => {
          this.reopenDateStatEditor();
        });
      }
    } else if (this.plugin.settings.settingsTab === "heatmap") {
      this.actionEditorIndex = null;
      this.customStatEditorIndex = null;
      this.dateStatEditorIndex = null;
      this.makeSettingsHeatmap(contentEl);
    } else {
      this.actionEditorIndex = null;
      this.customStatEditorIndex = null;
      this.dateStatEditorIndex = null;
    }
    this.setupSettingsPointerSort();
    this.restoreSettingsScroll(scrollEl, previousScrollTop);
  };

  private restoreSettingsScroll(
    scrollEl: HTMLElement | null,
    scrollTop: number,
  ): void {
    if (!scrollEl) {
      return;
    }
    scrollEl.scrollTop = scrollTop;
    scrollEl.win.requestAnimationFrame(() => {
      if (scrollEl.isConnected) {
        scrollEl.scrollTop = scrollTop;
      }
    });
  }

  private makeSettingsShortcuts = (containerEl: HTMLElement): void => {
    this.addSectionHeading(
      containerEl,
      "快捷方式",
      "添加快捷方式",
      () => {
        this.openNewActionEditor();
      },
    );
    const actionsGroup = new SettingGroup(containerEl);

    if (this.plugin.settings.actions.length === 0) {
      actionsGroup.addSetting((emptySetting) => {
        emptySetting
          .setName('还没有添加任何快捷方式')
          .setDesc('点击标题右侧的加号创建快捷方式');
      });
    } else {
      this.plugin.settings.actions.forEach((action, index) => {
        this.createActionSetting(actionsGroup, action, index);
      });
    }

  };

  private addSectionHeading(
    containerEl: HTMLElement,
    title: string,
    label: string,
    onClick: () => void | Promise<void>,
  ): void {
    new Setting(containerEl)
      .setName(title)
      .setHeading()
      .addExtraButton((button) => button
        .setIcon("plus")
        .setTooltip(label)
        .onClick(() => {
          try {
            void Promise.resolve(onClick()).catch((error) => {
              loggerOnError(error, "添加设置项目失败\n(About Blank)");
            });
          } catch (error) {
            loggerOnError(error, "添加设置项目失败\n(About Blank)");
          }
        }));
  }

  private destroySettingsOptionPickers(): void {
    this.settingsOptionPickers.forEach((picker) => picker.destroy());
    this.settingsOptionPickers.clear();
  }

  private makeSettingsLogo = (containerEl: HTMLElement): void => {
    const logoGroup = new SettingGroup(containerEl);

    logoGroup.addSetting((logoPathSetting) => {
      logoPathSetting
        .setName("Logo 图片")
        .setDesc("使用系统文件选择器选择 Logo 图片");
      const fileInputEl = logoPathSetting.controlEl.createEl("input", {
        cls: "about-blank-logo-file-input",
        attr: {
          type: "file",
          accept: "image/*",
          "aria-label": "选择 Logo 图片",
        },
      });
      const pickerEl = logoPathSetting.controlEl.createEl("button", {
        cls: [
          "clickable-icon",
          "about-blank-action-editor-icon-picker",
          "about-blank-logo-file-picker",
        ],
        attr: {
          type: "button",
          "aria-label": "选择 Logo 图片",
        },
      });
      setTooltip(pickerEl, "选择 Logo 图片");
      pickerEl.createSpan({
        cls: [
          "about-blank-action-editor-icon-preview",
          "about-blank-logo-file-preview",
        ],
        attr: { "aria-hidden": "true" },
      });
      fileInputEl.addEventListener("click", () => {
        fileInputEl.value = "";
      });
      pickerEl.addEventListener("click", () => {
        fileInputEl.click();
      });
      fileInputEl.addEventListener("change", () => {
        const file = fileInputEl.files?.item(0);
        if (!file) {
          return;
        }
        void (async () => {
          try {
            this.plugin.settings.logoPath = await this.getLogoFileSource(file);
            await this.plugin.saveSettings();
            this.plugin.refreshAllNewTabs();
            new Notice(`已选择 Logo 图片: ${file.name}`, 3000);
          } catch (error) {
            loggerOnError(error, "Logo 图片选择失败\n(About Blank)");
            new Notice("Logo 图片选择失败", 3000);
          }
        })();
      });
    });

  };

  private getLogoFileSource(file: File): Promise<string> {
    const localPath = (file as File & { path?: unknown }).path;
    if (typeof localPath === "string" && localPath.trim()) {
      return Promise.resolve(localPath);
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
        } else {
          reject(new Error("无法读取 Logo 图片"));
        }
      };
      reader.onerror = () => reject(reader.error ?? new Error("无法读取 Logo 图片"));
      reader.readAsDataURL(file);
    });
  }

  private makeSettingsStats = (containerEl: HTMLElement): void => {
      // 默认统计项标题
      new Setting(containerEl)
        .setName("默认")
        .setHeading();

      const builtinGroup = new SettingGroup(containerEl);

      builtinGroup.addSetting((fileCountSetting) => {
        fileCountSetting
          .setName("文件数量")
          .setDesc("显示仓库中的文件总数")
          .addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.showFileCount)
              .onChange(async (value) => {
                try {
                  this.plugin.settings.showFileCount = value;
                  await this.plugin.saveSettings();
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
          });
      });

      builtinGroup.addSetting((storageSizeSetting) => {
        storageSizeSetting
          .setName("存储空间")
          .setDesc("显示仓库的总存储大小")
          .addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.showStorageSize)
              .onChange(async (value) => {
                try {
                  this.plugin.settings.showStorageSize = value;
                  await this.plugin.saveSettings();
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
          });
      });

      this.addSectionHeading(
        containerEl,
        "文件统计",
        "添加文件统计",
        () => {
          this.openNewCustomStatEditor();
        },
      );

      const customStatsGroup = new SettingGroup(containerEl);

      if (this.plugin.settings.customStats.length === 0) {
        customStatsGroup.addSetting((emptySetting) => {
          emptySetting
            .setName('还没有添加任何文件统计项目')
            .setDesc('点击标题右侧的加号创建文件统计项目');
        });
      } else {
        this.plugin.settings.customStats.forEach((stat, index) => {
          customStatsGroup.addSetting((statHeaderSetting) => {
            statHeaderSetting
              .setName(stat.displayName.trim() || `文件统计 ${index + 1}`)
              .setDesc(this.getCustomStatSummary(stat));
            statHeaderSetting.settingEl.addClass('about-blank-stat-setting');
            this.customStatRowElements.set(index, statHeaderSetting.settingEl);

            statHeaderSetting.addExtraButton((button) => {
              button
                .setIcon("pencil")
                .setTooltip("编辑")
                .onClick(() => {
                  this.openCustomStatEditor(index);
                });
            });

            statHeaderSetting.addExtraButton((button) => {
              button.setIcon("trash")
                .setTooltip("删除")
                .onClick(async () => {
                  const confirmed = await ConfirmModal.confirm(this.app, {
                    title: "删除文件统计",
                    message: `确定要删除文件统计 "${stat.displayName.trim() || `文件统计 ${index + 1}`}" 吗?`,
                    confirmText: "删除",
                    cancelText: "取消",
                    danger: true,
                  });
                  if (!confirmed) {
                    return;
                  }
                  const previousEditorIndex = this.customStatEditorIndex;
                  this.plugin.settings.customStats.splice(index, 1);
                  if (previousEditorIndex === index) {
                    this.customStatEditorIndex = null;
                  } else if (previousEditorIndex !== null && previousEditorIndex > index) {
                    this.customStatEditorIndex = previousEditorIndex - 1;
                  }
                  await this.plugin.saveSettings();
                  this.plugin.refreshAllNewTabs();
                  this.renderCurrentTab();
                });
            });

            this.makeSettingSortable(statHeaderSetting, "custom-stats", index);

          });
        });
      }

      this.addSectionHeading(
        containerEl,
        "日期统计",
        "添加日期统计",
        () => {
          this.openNewDateStatEditor();
        },
      );

      const dateStatsGroup = new SettingGroup(containerEl);

      if (this.plugin.settings.dateStats.length === 0) {
        dateStatsGroup.addSetting((emptySetting) => {
          emptySetting
            .setName('还没有添加任何日期统计项目')
            .setDesc('点击标题右侧的加号创建日期统计项目');
        });
      } else {
        this.plugin.settings.dateStats.forEach((stat, index) => {
          dateStatsGroup.addSetting((statHeaderSetting) => {
            statHeaderSetting
              .setName(stat.title.trim() || `日期统计 ${index + 1}`)
              .setDesc(this.getDateStatSummary(stat));
            statHeaderSetting.settingEl.addClass('about-blank-stat-setting');
            this.dateStatRowElements.set(index, statHeaderSetting.settingEl);

            statHeaderSetting.addExtraButton((button) => {
              button
                .setIcon("pencil")
                .setTooltip("编辑")
                .onClick(() => {
                  this.openDateStatEditor(index);
                });
            });

            statHeaderSetting.addExtraButton((button) => {
              button.setIcon("trash")
                .setTooltip("删除")
                .onClick(async () => {
                  const confirmed = await ConfirmModal.confirm(this.app, {
                    title: "删除日期统计",
                    message: `确定要删除日期统计 "${stat.title.trim() || `日期统计 ${index + 1}`}" 吗?`,
                    confirmText: "删除",
                    cancelText: "取消",
                    danger: true,
                  });
                  if (!confirmed) {
                    return;
                  }
                  const previousEditorIndex = this.dateStatEditorIndex;
                  this.plugin.settings.dateStats.splice(index, 1);
                  if (previousEditorIndex === index) {
                    this.dateStatEditorIndex = null;
                  } else if (previousEditorIndex !== null && previousEditorIndex > index) {
                    this.dateStatEditorIndex = previousEditorIndex - 1;
                  }
                  await this.plugin.saveSettings();
                  this.plugin.refreshAllNewTabs();
                  this.renderCurrentTab();
                });
            });

            this.makeSettingSortable(statHeaderSetting, "date-stats", index);

          });
        });
      }

  };

  private getDateStatSummary = (stat: DateStatDefinition): string => {
    const typeLabel = getDateStatTypeLabel(stat.type);
    const dateLabel = stat.type === DATE_STAT_TYPES.anniversary
      ? stat.date
      : stat.date;
    return `${typeLabel} - ${dateLabel || "未设置日期"}`;
  };

  private getCustomStatSummary = (stat: CustomStatDefinition): string => {
    const conjunctionText = stat.filters.conjunction === CUSTOM_STAT_FILTER_CONJUNCTIONS.and
      ? "根组条件: 全部满足"
      : stat.filters.conjunction === CUSTOM_STAT_FILTER_CONJUNCTIONS.not
        ? "根组条件: 全部不满足"
        : "根组条件: 任一满足";
    const countText = `${countCustomStatFilterConditions(stat.filters)} 条条件`;
    return [conjunctionText, countText].join(" - ");
  };

  private openNewCustomStatEditor = (): void => {
    this.closeCustomStatEditor();
    const draft = createCustomStatDefinition();
    let savedIndex: number | null = null;
    this.customStatEditorIndex = null;
    this.customStatEditorModal = new CustomStatEditorModal(this.app, draft, {
      onChange: async (nextStat) => {
        if (!isCustomStatComplete(nextStat)) {
          return;
        }
        if (savedIndex === null) {
          const nextIndex = this.plugin.settings.customStats.length;
          this.plugin.settings.customStats.push(nextStat);
          try {
            await this.plugin.saveSettingsSilent();
          } catch (error) {
            this.plugin.settings.customStats.splice(nextIndex, 1);
            throw error;
          }
          savedIndex = nextIndex;
          this.customStatEditorIndex = nextIndex;
        } else {
          this.plugin.settings.customStats[savedIndex] = nextStat;
          await this.plugin.saveSettingsSilent();
        }
        this.customStatEditorRefreshPending = true;
      },
      onClose: (finalStat) => {
        this.customStatEditorModal = null;
        this.customStatEditorIndex = null;
        if (!isCustomStatComplete(finalStat)) {
          new Notice(this.getCustomStatValidationNotice(
            finalStat,
            savedIndex === null,
          ));
        }
        this.flushCustomStatEditorRefresh();
        this.renderCurrentTab();
      },
    });
    this.customStatEditorModal.open();
  };

  private openCustomStatEditor = (index: number): void => {
    const stat = this.plugin.settings.customStats[index];
    const rowEl = this.customStatRowElements.get(index);
    if (!stat || !rowEl) {
      return;
    }

    if (this.customStatEditorIndex === index && this.customStatEditorModal) {
      this.closeCustomStatEditor();
      return;
    }

    this.closeCustomStatEditor(false);
    this.customStatEditorIndex = index;
    this.customStatEditorModal = new CustomStatEditorModal(this.app, stat, {
      onChange: async (nextStat: CustomStatDefinition) => {
        if (
          !this.plugin.settings.customStats[index]
          || !isCustomStatComplete(nextStat)
        ) {
          return;
        }
        this.plugin.settings.customStats[index] = nextStat;
        this.customStatEditorRefreshPending = true;
        await this.plugin.saveSettingsSilent();
        this.updateCustomStatRow(index);
      },
      onClose: (finalStat) => {
        this.customStatEditorModal = null;
        this.customStatEditorIndex = null;
        if (!isCustomStatComplete(finalStat)) {
          new Notice(this.getCustomStatValidationNotice(finalStat, false));
        }
        this.flushCustomStatEditorRefresh();
      },
    });
    this.customStatEditorModal.open();
  };

  private reopenCustomStatEditor = (): void => {
    if (this.customStatEditorIndex === null) {
      return;
    }
    if (!this.customStatRowElements.has(this.customStatEditorIndex)) {
      this.customStatEditorIndex = null;
      return;
    }
    this.openCustomStatEditor(this.customStatEditorIndex);
  };

  private closeCustomStatEditor = (clearIndex: boolean = true): void => {
    const modal = this.customStatEditorModal;
    this.customStatEditorModal = null;
    if (clearIndex) {
      this.customStatEditorIndex = null;
    }
    modal?.close();
  };

  private flushCustomStatEditorRefresh = (): void => {
    if (!this.customStatEditorRefreshPending) {
      return;
    }
    this.customStatEditorRefreshPending = false;
    this.plugin.refreshAllNewTabs();
  };

  private getCustomStatValidationNotice(
    stat: CustomStatDefinition,
    isNew: boolean,
  ): string {
    const missing: string[] = [];
    if (!stat.displayName.trim()) {
      missing.push("填写名称");
    }
    if (!isCustomStatComplete({ ...stat, displayName: "valid" })) {
      missing.push("至少添加一条完整筛选条件");
    }
    const result = isNew ? "文件统计未创建" : "文件统计修改未保存";
    const fallback = isNew ? "" : ". 已保留上次有效设置";
    return `${result}: 请${missing.join(", 并")}${fallback}`;
  }

  private updateCustomStatRow = (index: number): void => {
    const rowEl = this.customStatRowElements.get(index);
    const stat = this.plugin.settings.customStats[index];
    if (!rowEl || !stat) {
      return;
    }

    const nameEl = rowEl.querySelector('.setting-item-name');
    if (nameEl) {
      nameEl.setText(stat.displayName.trim() || `文件统计 ${index + 1}`);
    }

    const summary = this.getCustomStatSummary(stat);
    const descEl = rowEl.querySelector('.setting-item-description');
    if (summary) {
      if (descEl instanceof HTMLElement) {
        descEl.setText(summary);
      } else {
        rowEl.querySelector('.setting-item-info')?.createDiv({
          cls: 'setting-item-description',
          text: summary,
        });
      }
      return;
    }

    descEl?.remove();
  };

  // ===========================================================================
  //                              日期统计编辑器
  // ===========================================================================

  private openNewDateStatEditor = (): void => {
    this.closeDateStatEditor();
    const draft = createDateStat();
    let savedIndex: number | null = null;
    this.dateStatEditorIndex = null;
    this.dateStatEditorModal = new DateStatEditorModal(this.app, draft, {
      onChange: async (nextStat) => {
        if (!isDateStatComplete(nextStat)) {
          return;
        }
        if (savedIndex === null) {
          const nextIndex = this.plugin.settings.dateStats.length;
          this.plugin.settings.dateStats.push(nextStat);
          try {
            await this.plugin.saveSettingsSilent();
          } catch (error) {
            this.plugin.settings.dateStats.splice(nextIndex, 1);
            throw error;
          }
          savedIndex = nextIndex;
          this.dateStatEditorIndex = nextIndex;
        } else {
          this.plugin.settings.dateStats[savedIndex] = nextStat;
          await this.plugin.saveSettingsSilent();
        }
        this.dateStatEditorRefreshPending = true;
      },
      onClose: (finalStat) => {
        this.dateStatEditorModal = null;
        this.dateStatEditorIndex = null;
        if (!isDateStatComplete(finalStat)) {
          new Notice(this.getDateStatValidationNotice(
            finalStat,
            savedIndex === null,
          ));
        }
        this.flushDateStatEditorRefresh();
        this.renderCurrentTab();
      },
    });
    this.dateStatEditorModal.open();
  };

  private openDateStatEditor = (index: number): void => {
    const stat = this.plugin.settings.dateStats[index];
    const rowEl = this.dateStatRowElements.get(index);
    if (!stat || !rowEl) {
      return;
    }

    if (this.dateStatEditorIndex === index && this.dateStatEditorModal) {
      this.closeDateStatEditor();
      return;
    }

    this.closeDateStatEditor(false);
    this.dateStatEditorIndex = index;
    this.dateStatEditorModal = new DateStatEditorModal(this.app, stat, {
      onChange: async (nextStat: DateStatDefinition) => {
        if (
          !this.plugin.settings.dateStats[index]
          || !isDateStatComplete(nextStat)
        ) {
          return;
        }
        this.plugin.settings.dateStats[index] = nextStat;
        this.dateStatEditorRefreshPending = true;
        await this.plugin.saveSettingsSilent();
        this.updateDateStatRow(index);
      },
      onClose: (finalStat) => {
        this.dateStatEditorModal = null;
        this.dateStatEditorIndex = null;
        if (!isDateStatComplete(finalStat)) {
          new Notice(this.getDateStatValidationNotice(finalStat, false));
        }
        this.flushDateStatEditorRefresh();
      },
    });
    this.dateStatEditorModal.open();
  };

  private reopenDateStatEditor = (): void => {
    if (this.dateStatEditorIndex === null) {
      return;
    }
    if (!this.dateStatRowElements.has(this.dateStatEditorIndex)) {
      this.dateStatEditorIndex = null;
      return;
    }
    this.openDateStatEditor(this.dateStatEditorIndex);
  };

  private closeDateStatEditor = (clearIndex: boolean = true): void => {
    const modal = this.dateStatEditorModal;
    this.dateStatEditorModal = null;
    if (clearIndex) {
      this.dateStatEditorIndex = null;
    }
    modal?.close();
  };

  private flushDateStatEditorRefresh = (): void => {
    if (!this.dateStatEditorRefreshPending) {
      return;
    }
    this.dateStatEditorRefreshPending = false;
    this.plugin.refreshAllNewTabs();
  };

  private getDateStatValidationNotice(
    stat: DateStatDefinition,
    isNew: boolean,
  ): string {
    const missing: string[] = [];
    if (!stat.title.trim()) {
      missing.push("填写名称");
    }
    if (!isDateStatComplete({ ...stat, title: "valid" })) {
      missing.push("填写有效目标日期");
    }
    const result = isNew ? "日期统计未创建" : "日期统计修改未保存";
    const fallback = isNew ? "" : ". 已保留上次有效设置";
    return `${result}: 请${missing.join(", 并")}${fallback}`;
  }

  private updateDateStatRow = (index: number): void => {
    const rowEl = this.dateStatRowElements.get(index);
    const stat = this.plugin.settings.dateStats[index];
    if (!rowEl || !stat) {
      return;
    }

    const nameEl = rowEl.querySelector('.setting-item-name');
    if (nameEl) {
      nameEl.setText(stat.title.trim() || `日期统计 ${index + 1}`);
    }

    const summary = this.getDateStatSummary(stat);
    const descEl = rowEl.querySelector('.setting-item-description');
    if (summary) {
      if (descEl instanceof HTMLElement) {
        descEl.setText(summary);
      } else {
        rowEl.querySelector('.setting-item-info')?.createDiv({
          cls: 'setting-item-description',
          text: summary,
        });
      }
      return;
    }

    descEl?.remove();
  };

  // ===========================================================================

  /**
   * 创建单个按钮的设置项 (使用 SettingGroup API)
   */
  private createActionSetting = (actionsGroup: SettingGroup, action: Action, index: number): void => {
    actionsGroup.addSetting((setting) => {
      setting.settingEl.addClass('about-blank-action-setting');
      setting.settingEl.dataset.index = index.toString();
      setting.setName(action.name.trim() || `快捷方式 ${index + 1}`);
      setting.setDesc(this.getActionSummary(action));
      this.actionRowElements.set(index, setting.settingEl);
      this.decorateActionName(setting, action);

      setting.addExtraButton((button) => button
        .setIcon('pencil')
        .setTooltip('编辑快捷方式')
        .onClick(() => {
          this.openActionEditor(index);
        }));

      setting.addExtraButton((button) => button
        .setIcon('trash')
        .setTooltip('删除快捷方式')
        .onClick(async () => {
          const confirmed = await ConfirmModal.confirm(this.app, {
            title: '删除快捷方式',
            message: `确定要删除快捷方式 "${action.name.trim() || `快捷方式 ${index + 1}`}" 吗?`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
          });
          if (!confirmed) {
            return;
          }
          const previousEditorIndex = this.actionEditorIndex;
          this.plugin.settings.actions.splice(index, 1);
          if (previousEditorIndex === index) {
            this.actionEditorIndex = null;
          } else if (previousEditorIndex !== null && previousEditorIndex > index) {
            this.actionEditorIndex = previousEditorIndex - 1;
          }
          await this.plugin.saveSettings();
          this.plugin.refreshAllNewTabs();
          this.renderCurrentTab();
        }));

      this.makeSettingSortable(setting, "actions", index);
    });
  };

  private decorateActionName(setting: Setting, action: Action): void {
    setting.nameEl.empty();

    const nameWrapEl = setting.nameEl.createSpan({ cls: 'about-blank-action-name-wrap' });
    const iconWrapEl = nameWrapEl.createSpan({ cls: 'about-blank-action-name-icon' });
    const previewEl = iconWrapEl.createSpan({ cls: 'about-blank-icon-picker-preview about-blank-icon-picker-preview-compact' });
    nameWrapEl.createSpan({
      cls: 'about-blank-action-name-text',
      text: action.name.trim() || '未命名快捷方式',
    });

    const renderPreview = () => {
      previewEl.empty();
      if (!action.icon) {
        setIcon(previewEl, 'slash');
        return;
      }

      if (this.plugin.customIconsIntegration.renderIcon(previewEl, action.icon)) {
        return;
      }

      try {
        setIcon(previewEl, action.icon);
        if (!previewEl.querySelector('svg')) {
          previewEl.setText(',');
        }
      } catch {
        previewEl.setText(',');
      }
    };

    renderPreview();
  }

  private getActionSummary(action: Action): string {
    if (action.content.kind === ACTION_KINDS.command) {
      const content = action.content;
      const registeredName = getRegisteredCommands(this.app)
        .find((command) => command.id === content.commandId)
        ?.name;
      const target = registeredName
        || content.commandName
        || (content.commandId ? '命令不可用' : '未设置命令');
      return `命令 - ${target}`;
    }
    if (action.content.kind === ACTION_KINDS.file) {
      return `文件 - ${action.content.filePath || '未设置文件'}`;
    }
    return `网页 - ${action.content.url || '未设置网址'}`;
  }

  private openNewActionEditor(): void {
    this.closeActionEditor();
    const draft = newActionClone();
    draft.cmdId = genNewCmdId(this.plugin.settings);
    let savedIndex: number | null = null;
    this.actionEditorIndex = null;
    this.actionEditorModal = new ActionEditorModal(this.app, draft, {
      customIconsIntegration: this.plugin.customIconsIntegration,
      onChange: async (nextAction) => {
        if (!isActionComplete(nextAction)) {
          return;
        }
        if (savedIndex === null) {
          const nextIndex = this.plugin.settings.actions.length;
          this.plugin.settings.actions.push(nextAction);
          try {
            await this.plugin.saveSettingsSilent();
          } catch (error) {
            this.plugin.settings.actions.splice(nextIndex, 1);
            throw error;
          }
          savedIndex = nextIndex;
          this.actionEditorIndex = nextIndex;
        } else {
          this.plugin.settings.actions[savedIndex] = nextAction;
          await this.plugin.saveSettingsSilent();
        }
        this.actionEditorRefreshPending = true;
      },
      onClose: (finalAction) => {
        this.actionEditorModal = null;
        this.actionEditorIndex = null;
        if (!isActionComplete(finalAction)) {
          new Notice(this.getActionValidationNotice(
            finalAction,
            savedIndex === null,
          ));
        }
        this.flushActionEditorRefresh();
        this.renderCurrentTab();
      },
    });
    this.actionEditorModal.open();
  }

  private openActionEditor(index: number): void {
    const action = this.plugin.settings.actions[index];
    const rowEl = this.actionRowElements.get(index);
    if (!action || !rowEl) {
      return;
    }

    if (this.actionEditorIndex === index && this.actionEditorModal) {
      this.closeActionEditor();
      return;
    }

    this.closeActionEditor(false);
    this.actionEditorIndex = index;
    this.actionEditorModal = new ActionEditorModal(this.app, action, {
      customIconsIntegration: this.plugin.customIconsIntegration,
      onChange: async (nextAction) => {
        if (
          !this.plugin.settings.actions[index]
          || !isActionComplete(nextAction)
        ) {
          return;
        }
        this.plugin.settings.actions[index] = nextAction;
        this.actionEditorRefreshPending = true;
        await this.plugin.saveSettingsSilent();
        this.updateActionRow(index);
      },
      onClose: (finalAction) => {
        this.actionEditorModal = null;
        this.actionEditorIndex = null;
        if (!isActionComplete(finalAction)) {
          new Notice(this.getActionValidationNotice(finalAction, false));
        }
        this.flushActionEditorRefresh();
      },
    });
    this.actionEditorModal.open();
  }

  private reopenActionEditor(): void {
    if (this.actionEditorIndex === null) {
      return;
    }
    if (!this.actionRowElements.has(this.actionEditorIndex)) {
      this.actionEditorIndex = null;
      return;
    }
    this.openActionEditor(this.actionEditorIndex);
  }

  private closeActionEditor(clearIndex: boolean = true): void {
    const modal = this.actionEditorModal;
    this.actionEditorModal = null;
    if (clearIndex) {
      this.actionEditorIndex = null;
    }
    modal?.close();
  }

  private flushActionEditorRefresh(): void {
    if (!this.actionEditorRefreshPending) {
      return;
    }
    this.actionEditorRefreshPending = false;
    this.plugin.refreshAllNewTabs();
  }

  private getActionValidationNotice(action: Action, isNew: boolean): string {
    const missing: string[] = [];
    if (!action.name.trim()) {
      missing.push("填写名称");
    }
    if (action.content.kind === ACTION_KINDS.command) {
      if (!action.content.commandId.trim() || !action.content.commandName.trim()) {
        missing.push("选择命令");
      }
    } else if (action.content.kind === ACTION_KINDS.file) {
      if (!action.content.filePath.trim() || !action.content.fileName.trim()) {
        missing.push("选择文件");
      }
    } else if (!action.content.url.trim()) {
      missing.push("填写网址");
    }
    const result = isNew ? "快捷方式未创建" : "快捷方式修改未保存";
    const fallback = isNew ? "" : ". 已保留上次有效设置";
    return `${result}: 请${missing.join(", 并")}${fallback}`;
  }

  private updateActionRow(index: number): void {
    const rowEl = this.actionRowElements.get(index);
    const action = this.plugin.settings.actions[index];
    if (!rowEl || !action) {
      return;
    }

    const nameEl = rowEl.querySelector('.setting-item-name');
    if (nameEl instanceof HTMLElement) {
      nameEl.empty();
      const setting = { nameEl, settingEl: rowEl } as Setting;
      this.decorateActionName(setting, action);
    }

    const summary = this.getActionSummary(action);
    const descEl = rowEl.querySelector('.setting-item-description');
    if (descEl instanceof HTMLElement) {
      descEl.setText(summary);
    }
  }

  refreshIntegratedIconPreviews = (): void => {
    this.actionRowElements.forEach((_rowEl, index) => {
      this.updateActionRow(index);
    });
    this.actionEditorModal?.refreshIconPreview();
  };

  private makeSettingSortable = (
    setting: Setting,
    group: "actions" | "custom-stats" | "date-stats",
    index: number,
  ): void => {
    setting.settingEl.addClass(
      "about-blank-draggable-setting",
      "about-blank-pointer-sort-setting",
    );
    setting.settingEl.dataset.sortGroup = group;
    setting.settingEl.dataset.sortIndex = index.toString();
    const dragHandle = setting.controlEl.createDiv({
      cls: ['clickable-icon', 'about-blank-drag-handle'],
      attr: { 'aria-label': '拖拽排序' },
    });
    setIcon(dragHandle, 'grip-vertical');
  };

  private setupSettingsPointerSort = (): void => {
    const sortableRows = this.contentEl.querySelectorAll<HTMLElement>(
      ".about-blank-pointer-sort-setting",
    );
    if (sortableRows.length < 2) {
      return;
    }

    this.settingsSortController = new PointerSortController<HTMLElement>({
      rootEl: this.contentEl,
      itemSelector: ".about-blank-pointer-sort-setting",
      handleSelector: ".about-blank-drag-handle",
      strategy: "vertical",
      movementAxis: "vertical",
      scrollEl: this.contentEl.parentElement,
      getItems: (sourceEl) => {
        const group = sourceEl.dataset.sortGroup;
        return Array.from(this.contentEl.querySelectorAll<HTMLElement>(
          `.about-blank-pointer-sort-setting[data-sort-group="${group}"]`,
        ));
      },
      getId: (itemEl) => {
        return `${itemEl.dataset.sortGroup}:${itemEl.dataset.sortIndex}`;
      },
      onCommit: (orderedIds, sourceId) => {
        void this.commitSettingsSort(orderedIds, sourceId).catch((error) => {
          loggerOnError(error, "保存拖拽顺序失败\n(About Blank)");
        });
      },
    });
  };

  private commitSettingsSort = async (
    orderedIds: string[],
    sourceId: string,
  ): Promise<void> => {
    const group = sourceId.slice(0, sourceId.lastIndexOf(":"));
    const indices = orderedIds.map((id) => Number(id.slice(id.lastIndexOf(":") + 1)));
    if (indices.some((index) => !Number.isInteger(index))) {
      return;
    }

    if (group === "actions") {
      const current = [...this.plugin.settings.actions];
      this.plugin.settings.actions = indices.map((index) => current[index]);
      this.actionEditorIndex = this.remapEditorIndex(this.actionEditorIndex, indices);
    } else if (group === "custom-stats") {
      const current = [...this.plugin.settings.customStats];
      this.plugin.settings.customStats = indices.map((index) => current[index]);
      this.customStatEditorIndex = this.remapEditorIndex(this.customStatEditorIndex, indices);
      this.plugin.syncStatDefinitionOrder("custom");
    } else if (group === "date-stats") {
      const current = [...this.plugin.settings.dateStats];
      this.plugin.settings.dateStats = indices.map((index) => current[index]);
      this.dateStatEditorIndex = this.remapEditorIndex(this.dateStatEditorIndex, indices);
      this.plugin.syncStatDefinitionOrder("date");
    } else {
      return;
    }

    await this.plugin.saveSettingsSilent();
    this.plugin.refreshAllNewTabs();
    this.renderCurrentTab();
  };

  private remapEditorIndex = (
    editorIndex: number | null,
    reorderedOriginalIndices: number[],
  ): number | null => {
    if (editorIndex === null) {
      return null;
    }
    const nextIndex = reorderedOriginalIndices.indexOf(editorIndex);
    return nextIndex >= 0 ? nextIndex : null;
  };

  private makeSettingsHeatmap = (containerEl: HTMLElement): void => {
    const dataSourceGroup = new SettingGroup(containerEl);
    dataSourceGroup.addSetting((dataSourceSetting) => {
      dataSourceSetting
        .setName("数据来源")
        .setDesc("选择用于统计文件日期的内置时间或笔记属性, 无法解析为日期的值不会计入");
      const catalog = new CustomStatFieldCatalog(this.app);
      const items: OptionPickerItem[] = catalog.getFields()
        .filter((field) => (
          field.name === CUSTOM_STAT_FILTER_FIELDS.createdAt
          || field.name === CUSTOM_STAT_FILTER_FIELDS.modifiedAt
          || !field.builtIn
        ))
        .map((field) => ({
          value: field.name,
          label: field.label,
          icon: field.icon,
          keywords: [field.builtIn ? "文件" : "笔记属性"],
        }));
      const currentSource = this.plugin.settings.heatmapDataSource;
      if (!items.some((item) => item.value === currentSource)) {
        items.push({
          value: currentSource,
          label: currentSource.startsWith("note.")
            ? currentSource.slice(5)
            : currentSource,
          icon: "calendar-clock",
          keywords: ["当前数据来源"],
        });
      }
      const picker = new OptionPicker(dataSourceSetting.controlEl, {
        items,
        value: currentSource,
        ariaLabel: "选择热力图数据来源",
        className: "about-blank-heatmap-data-source",
        onSelect: (value: string) => {
          this.plugin.settings.heatmapDataSource = value;
          void (async () => {
            try {
              await this.plugin.saveSettings();
              this.plugin.refreshAllNewTabs();
            } catch (error) {
              loggerOnError(error, "保存热力图数据来源失败\n(About Blank)");
            }
          })();
        },
      });
      this.settingsOptionPickers.add(picker);
    });

    this.addSectionHeading(
      containerEl,
      "热力图分段",
      "添加颜色分段",
      async () => {
        const lastSegment = this.plugin.settings.heatmapColorSegments[
          this.plugin.settings.heatmapColorSegments.length - 1
        ];
        const newMin = lastSegment ? lastSegment.max + 1 : 1;
        this.plugin.settings.heatmapColorSegments.push({
          min: newMin,
          max: newMin + 5,
          color: "#40c463",
        });
        await this.plugin.saveSettings();
        this.renderCurrentTab();
      },
    );
    const heatmapGroup = new SettingGroup(containerEl);

      // 颜色分段设置 (跳过零值分段)
      for (let i = 1; i < this.plugin.settings.heatmapColorSegments.length; i++) {
        const segment = this.plugin.settings.heatmapColorSegments[i];
        heatmapGroup.addSetting((segmentSetting) => {
          segmentSetting.setName(`分段 ${i}`);

          segmentSetting.addText((text) => {
            text.setPlaceholder("最小值")
              .setValue(segment.min.toString())
              .onChange(async (value) => {
                this.plugin.settings.heatmapColorSegments[i].min = parseInt(value) || 0;
                await this.plugin.saveSettings();
              });
            text.inputEl.addClass('about-blank-input-narrow');
          });

          segmentSetting.addText((text) => {
            text.setPlaceholder("最大值")
              .setValue(segment.max.toString())
              .onChange(async (value) => {
                this.plugin.settings.heatmapColorSegments[i].max = parseInt(value) || 0;
                await this.plugin.saveSettings();
              });
            text.inputEl.addClass('about-blank-input-narrow');
          });

          segmentSetting.addColorPicker((colorPicker) => {
            colorPicker
              .setValue(segment.color.startsWith('#') ? segment.color : '#40c463')
              .onChange(async (value) => {
                this.plugin.settings.heatmapColorSegments[i].color = value;
                await this.plugin.saveSettings();
              });
          });

          // 删除按钮 (至少保留一个分段)
          if (this.plugin.settings.heatmapColorSegments.length > 2) {
            segmentSetting.addExtraButton((button) => {
              button.setIcon("trash")
                .setTooltip("删除")
                .onClick(async () => {
                  this.plugin.settings.heatmapColorSegments.splice(i, 1);
                  await this.plugin.saveSettings();
                  this.renderCurrentTab();
                });
            });
          }
        });
      }

  };

}
