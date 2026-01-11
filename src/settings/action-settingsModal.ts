import {
  type App,
  getIconIds,
  Modal,
  Setting,
} from "obsidian";

import {
  type Action,
  ACTION_KINDS,
  ACTION_KINDS_ICON,
  ACTION_KINDS_NAME,
  allActionsBloodline,
  type ContentOfGroup,
  genNewCmdId,
} from "src/settings/action-basic";

import {
  chooseContent,
  makeSettingsActionsHeader,
  makeSettingsActionsList,
} from "src/settings/action-settings";

import {
  type AboutBlankSettings,
  type AboutBlankSettingTab,
} from "src/settings/settingTab";

import {
  ConfirmDialogAsync,
} from "src/ui/confirmDialogAsync";

import {
  IconSuggesterAsync,
} from "src/ui/iconSuggesterAsync";

import isFalsyString from "src/utils/isFalsyString";

import {
  objectDeepCopy,
} from "src/utils/objectDeepCopy";

import {
  loggerOnError,
  setFakeIconToExButtonIfEmpty,
} from "src/commons";

import {
  CSS_CLASSES,
} from "src/constants";

import type AboutBlank from "src/main";

import {
  type ValuesOf,
} from "src/types";

// =============================================================================

export class ActionSettingsModal extends Modal {
  plugin: AboutBlank;
  prevPage: AboutBlankSettingTab | ActionSettingsModal;
  pageIndex: number;
  parentsDisplay: boolean;
  actionsHolder: AboutBlankSettings | ContentOfGroup;
  actionIndex: number;
  orgAction: Action; // Original
  modAction: Action; // Modified
  newActionName: string = "";
  actionContentDesc: string = "";
  saveNotice: boolean = false;

  constructor(
    app: App,
    plugin: AboutBlank,
    prevPage: AboutBlankSettingTab | ActionSettingsModal,
    pageIndex: number,
    actionsHolder: AboutBlankSettings | ContentOfGroup,
    actionIndex: number,
    parentsDisplay?: boolean,
  ) {
    super(app);
    this.plugin = plugin;
    this.prevPage = prevPage;
    this.pageIndex = pageIndex;
    this.actionsHolder = actionsHolder;
    this.actionIndex = actionIndex;
    this.orgAction = this.actionsHolder.actions[actionIndex];
    this.modAction = objectDeepCopy(this.orgAction);

    if (this.pageIndex === 0) {
      this.parentsDisplay = this.orgAction.display === true; // Explicitly true
      this.plugin.needToResisterActions = false;
      this.plugin.needToRemoveActions = false;
      this.plugin.needToResisterQuickActions = false;
    } else {
      this.parentsDisplay = parentsDisplay === true; // Explicitly true
    }

    this.actionContentDesc = Object.values(ACTION_KINDS_NAME).join(" / ");

    const title = "Action's setting";
    const numbering = this.pageIndex === 0
      ? ""
      : ` (${this.pageIndex + 1})`;
    this.setTitle(`${title}${numbering}`);

    this.display();
  }

  onClose(): void {
    try {
      if (this.saveNotice && "saveNotice" in this.prevPage) {
        this.prevPage.saveNotice = true;
      }
      this.prevPage.display();
    } catch (error) {
      loggerOnError(error, "Error in settings.\n(About Blank)");
    }
  }

  // ---------------------------------------------------------------------------

  saveAction = async (): Promise<void> => {
    if (isFalsyString(this.modAction.cmdId)) {
      this.modAction.cmdId = genNewCmdId();
    }

    if (this.modAction.cmd === true) {
      this.plugin.needToResisterActions = true;
    } else if (this.orgAction.cmd) {
      this.plugin.needToRemoveActions = true;
    }

    if (this.plugin.settings.quickActions === true) {
      if (this.pageIndex === 0) {
        // Only if both `Original` and `Modified` are false, do nothing.
        if (this.orgAction.display || this.modAction.display === true) {
          this.plugin.needToResisterQuickActions = true;
        }
      } else {
        if (this.parentsDisplay) {
          this.plugin.needToResisterQuickActions = true;
        }
      }
    }

    await this.organizeSettings();
  };

  deleteAction = async (): Promise<void> => {
    if (this.orgAction.cmd || this.orgAction.content.kind === "group") {
      this.plugin.needToRemoveActions = true;
    }

    if (this.plugin.settings.quickActions === true) {
      if (this.pageIndex === 0) {
        if (this.orgAction.display) {
          this.plugin.needToResisterQuickActions = true;
        }
      } else {
        if (this.parentsDisplay) {
          this.plugin.needToResisterQuickActions = true;
        }
      }
    }

    await this.organizeSettings(true);
  };

  organizeSettings = async (deleteAction?: boolean): Promise<void> => {
    if ("saveNotice" in this.prevPage) {
      this.prevPage.saveNotice = true;
    }

    const reflector: () => void = deleteAction !== true
      ? () => {
        this.actionsHolder.actions[this.actionIndex] = this.modAction;
      }
      : () => {
        this.actionsHolder.actions.splice(this.actionIndex, 1);
      };

    if (this.pageIndex !== 0) {
      reflector();
      return;
    }

    const allOrgActions = this.plugin.needToRemoveActions === false
      ? null
      : allActionsBloodline(this.actionsHolder.actions);

    reflector();
    await this.plugin.saveSettings();

    if (this.plugin.settings.quickActions === true && this.plugin.needToResisterQuickActions) {
      this.plugin.registerQuickActions();
    }

    if (this.plugin.needToResisterActions === false && this.plugin.needToRemoveActions === false) {
      return;
    }

    const allModActions = allActionsBloodline(this.actionsHolder.actions);
    if (this.plugin.needToRemoveActions) {
      this.plugin.removeApplicableCmds(allOrgActions as Action[], allModActions);
    }
    if (this.plugin.needToResisterActions) {
      this.plugin.registerAllCmdToObsidian(allModActions);
    }
  };

  // ---------------------------------------------------------------------------

  private chooseActionContent = async (
    kind: ValuesOf<typeof ACTION_KINDS>,
  ): Promise<void> => {
    const content = await chooseContent(this.app, kind);
    if (content === undefined) {
      return;
    }
    this.modAction.content = content;
    this.display();
  };

  // ---------------------------------------------------------------------------

  display = (): void => {
    this.contentEl.empty();

    new Setting(this.contentEl)
      .setName("显示名称/图标")
      .addText((text) => {
        text
          .setPlaceholder(this.orgAction.name)
          .setValue(this.modAction.name)
          .onChange((value) => {
            try {
              if (isFalsyString(value)) {
                return;
              }
              this.modAction.name = value;
            } catch (error) {
              loggerOnError(error, "Error in settings.\n(About Blank)");
            }
          });
      })
      .addExtraButton((button) => {
        button
          .setIcon(this.modAction.icon)
          .setTooltip("设置图标")
          .onClick(async () => {
            try {
              const noIconId = "*No icon*";
              const iconIds = getIconIds();
              iconIds.unshift(noIconId);
              const placeholder = this.modAction.icon
                ? this.modAction.icon
                : "Icon...";
              const response = await new IconSuggesterAsync(
                this.app,
                iconIds,
                placeholder,
              ).openAndRespond();
              if (response.aborted) {
                return;
              } else if (response.result === noIconId) {
                this.modAction.icon = "";
              } else {
                this.modAction.icon = response.result;
              }
              this.display();
            } catch (error) {
              loggerOnError(error, "Error in settings.\n(About Blank)");
            }
          });
        setFakeIconToExButtonIfEmpty(button.extraSettingsEl);
      });

    const actionContentItem = new Setting(this.contentEl);
    actionContentItem
      .setClass(CSS_CLASSES.settingActionHeader)
      .setName("操作内容：")
      .setDesc(this.actionContentDesc);
    Object.values(ACTION_KINDS).forEach((kind) => {
      actionContentItem
        .addExtraButton((button) => {
          if (this.modAction.content.kind === kind) {
            button.extraSettingsEl.classList.add(CSS_CLASSES.ctaExButton);
          }
          button
            .setIcon(ACTION_KINDS_ICON[kind])
            .setTooltip(ACTION_KINDS_NAME[kind])
            .onClick(async () => {
              try {
                if (kind === ACTION_KINDS.group) {
                  const response = await new ConfirmDialogAsync(
                    this.app,
                    "Reset this content",
                    "Do you want to reset the current content and create a new group?",
                  ).setYesNo().openAndRespond();
                  if (!response.result) {
                    return;
                  }
                }
                await this.chooseActionContent(kind);
              } catch (error) {
                loggerOnError(error, "Error in settings.\n(About Blank)");
              }
            });
          setFakeIconToExButtonIfEmpty(button.extraSettingsEl);
        });
    });

    if (this.modAction.content.kind === ACTION_KINDS.group) {
      makeSettingsActionsHeader(
        this.contentEl,
        this,
        this.modAction.content,
        false,
        CSS_CLASSES.settingActionContentGroup,
      );
      makeSettingsActionsList(
        this.contentEl,
        this,
        this.pageIndex + 1,
        this.modAction.content,
        false,
        this.parentsDisplay,
      );
    } else if (this.modAction.content.kind === ACTION_KINDS.file) {
      new Setting(this.contentEl)
        .setClass(CSS_CLASSES.settingActionContent)
        .setName(this.modAction.content.fileName)
        .setDesc(this.modAction.content.filePath);
    } else {
      new Setting(this.contentEl)
        .setClass(CSS_CLASSES.settingActionContent)
        .setName(this.modAction.content.commandName)
        .setDesc(this.modAction.content.commandId);
    }

    new Setting(this.contentEl)
      .setName("执行前确认")
      .setDesc("如果启用，此操作在执行前将提示您确认。")
      .addToggle((toggle) => {
        toggle
          .setValue(this.modAction.ask)
          .onChange((value) => {
            try {
              this.modAction.ask = value;
            } catch (error) {
              loggerOnError(error, "Error in settings.\n(About Blank)");
            }
          });
      });

    new Setting(this.contentEl)
      .setName("注册为命令")
      .setDesc(
        "如果启用，此操作将在Obsidian中注册为命令。（可以从命令面板等执行）",
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.modAction.cmd)
          .onChange((value) => {
            try {
              this.modAction.cmd = value;
            } catch (error) {
              loggerOnError(error, "Error in settings.\n(About Blank)");
            }
          });
      });

    if (this.pageIndex === 0) {
      new Setting(this.contentEl)
        .setName("显示")
        .setDesc(
          "如果启用，此操作将显示在空文件视图（新标签页）和\"快速操作\"中。",
        )
        .addToggle((toggle) => {
          toggle
            .setValue(this.modAction.display)
            .onChange((value) => {
              try {
                this.modAction.display = value;
              } catch (error) {
                loggerOnError(error, "Error in settings.\n(About Blank)");
              }
            });
        });
    }

    new Setting(this.contentEl)
      .setName("删除此操作")
      .addButton((button) => {
        button
          .setButtonText("删除")
          .setWarning()
          .onClick(async () => {
            try {
              const contentDetails = (() => {
                if (this.modAction.content.kind === ACTION_KINDS.group) {
                  return `${this.modAction.content.actions.length} actions`;
                } else if (this.modAction.content.kind === ACTION_KINDS.file) {
                  return `${this.modAction.content.fileName} / ${this.modAction.content.filePath}`;
                } else {
                  return `${this.modAction.content.commandName} / ${this.modAction.content.commandId}`;
                }
              })();
              const response = await new ConfirmDialogAsync(
                this.app,
                "Delete action",
                `${this.modAction.name} (${ACTION_KINDS_NAME[this.modAction.content.kind]}: ${contentDetails})`,
              ).setDeleteCancel().openAndRespond();
              if (!response.result) {
                return;
              }
              await this.deleteAction();
              this.close();
            } catch (error) {
              loggerOnError(error, "Error in settings.\n(About Blank)");
            }
          });
      });

    new Setting(this.contentEl)
      .addButton((button) => {
        button
          .setButtonText("保存")
          .setCta()
          .onClick(async () => {
            await this.saveAction();
            this.close();
          });
      })
      .addButton((button) => {
        button
          .setButtonText("取消")
          .onClick(() => {
            this.close();
          });
      });

    if (this.modAction.content.kind === ACTION_KINDS.group && this.saveNotice) {
      new Setting(this.contentEl)
        .setClass(CSS_CLASSES.settingActionSaveNotice)
        .setDesc("子操作的更改需要在父操作中\"保存\"。")
    }
  };
}
