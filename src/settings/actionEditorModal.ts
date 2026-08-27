import {
  type App,
  Setting,
  setIcon,
  setTooltip,
} from "obsidian";

import {
  ACTION_KINDS,
  type Action,
} from "src/settings/action-basic";

import {
  loggerOnError,
} from "src/commons";

import {
  IconSuggestModal,
} from "src/ui/iconSuggestModal";

import {
  CustomIconsIntegration,
} from "src/integrations/customIconsIntegration";

import {
  EditorModal,
} from "src/ui/editorModal";

import {
  CommandInputSuggester,
  FileInputSuggester,
} from "src/ui/actionTargetSuggester";

import {
  getRegisteredCommands,
} from "src/utils/commandRegistry";

interface ActionEditorModalOptions {
  customIconsIntegration: CustomIconsIntegration;
  onChange: (action: Action) => Promise<void>;
  onClose?: (action: Action) => void;
}

export class ActionEditorModal {
  private readonly app: App;
  private readonly options: ActionEditorModalOptions;
  private readonly draft: Action;
  private modal: EditorModal | null = null;
  private contentEl: HTMLElement | null = null;
  private nameInputEl: HTMLInputElement | null = null;
  private iconPreviewEl: HTMLElement | null = null;
  private targetSuggester: CommandInputSuggester | FileInputSuggester | null = null;
  private autoSaveTimer: number | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private lastCommittedState: string;

  constructor(app: App, action: Action, options: ActionEditorModalOptions) {
    this.app = app;
    this.options = options;
    this.draft = structuredClone(action);
    this.lastCommittedState = JSON.stringify(this.draft);
  }

  open = (): void => {
    if (this.modal) {
      return;
    }

    this.modal = new EditorModal(this.app, {
      modalClass: "about-blank-action-editor-modal-shell",
      contentClass: "about-blank-action-editor-modal",
      onOpen: (contentEl) => {
        this.contentEl = contentEl;
        this.render();
        this.nameInputEl?.win.requestAnimationFrame(() => {
          this.nameInputEl?.focus();
          this.nameInputEl?.select();
        });
      },
      onClose: () => {
        void this.finalizeClose();
      },
    });
    this.modal.open();
  };

  close = (): void => {
    this.modal?.close();
  };

  private render = (): void => {
    if (!this.contentEl) {
      return;
    }

    const previousScrollTop = this.contentEl.scrollTop;
    this.targetSuggester?.close();
    this.targetSuggester = null;
    this.contentEl.empty();
    this.nameInputEl = null;
    this.iconPreviewEl = null;

    this.renderNameSetting(this.contentEl);
    this.renderIconSetting(this.contentEl);
    this.renderTypeSetting(this.contentEl);
    this.renderTargetSetting(this.contentEl);
    this.restoreScrollPosition(previousScrollTop);
  };

  private restoreScrollPosition(scrollTop: number): void {
    const contentEl = this.contentEl;
    if (!contentEl) {
      return;
    }
    contentEl.scrollTop = scrollTop;
    contentEl.win.requestAnimationFrame(() => {
      if (contentEl.isConnected) {
        contentEl.scrollTop = scrollTop;
      }
    });
  }

  private renderNameSetting(parentEl: HTMLElement): void {
    new Setting(parentEl)
      .setName("名称")
      .setDesc("设置快捷方式显示的名称")
      .addText((text) => {
        this.nameInputEl = text.inputEl;
        text
          .setPlaceholder("快捷方式名称")
          .setValue(this.draft.name)
          .onChange((value) => {
            this.draft.name = value;
            this.scheduleCommit();
          });
      });
  }

  private renderIconSetting(parentEl: HTMLElement): void {
    const setting = new Setting(parentEl)
      .setName("图标")
      .setDesc("设置快捷方式显示的图标");
    const iconButton = setting.controlEl.createEl("button", {
      cls: ["clickable-icon", "about-blank-action-editor-icon-picker"],
      attr: { type: "button", "aria-label": "选择图标" },
    });
    this.iconPreviewEl = iconButton.createSpan({
      cls: "about-blank-action-editor-icon-preview",
    });
    setTooltip(iconButton, "选择图标");
    this.updateIconPreview();
    iconButton.addEventListener("click", () => {
      void this.openIconPicker(iconButton);
    });
  }

  private renderTypeSetting(parentEl: HTMLElement): void {
    new Setting(parentEl)
      .setName("类型")
      .setDesc("设置快捷方式执行的操作类型")
      .addDropdown((dropdown) => dropdown
        .addOption(ACTION_KINDS.command, "命令")
        .addOption(ACTION_KINDS.file, "文件")
        .addOption(ACTION_KINDS.url, "网址")
        .setValue(this.draft.content.kind)
        .onChange((value) => {
          this.setContentKind(value);
          this.render();
          void this.commitChanges();
        }));
  }

  private renderTargetSetting(parentEl: HTMLElement): void {
    const config = this.getTargetSettingConfig();
    new Setting(parentEl)
      .setName(config.name)
      .setDesc(config.description)
      .addText((text) => {
        text
          .setPlaceholder(config.placeholder)
          .setValue(this.getTargetDisplayValue());
        if (this.draft.content.kind === ACTION_KINDS.command) {
          const content = this.draft.content;
          text
            .setPlaceholder("输入命令名称")
            .onChange((value) => {
              const currentName = this.getCommandDisplayName();
              if (value !== currentName) {
                content.commandId = "";
                content.commandName = value;
              }
              this.scheduleCommit();
            });
          this.targetSuggester = new CommandInputSuggester(
            this.app,
            text.inputEl,
            (command) => {
              if (this.draft.content.kind !== ACTION_KINDS.command) {
                return;
              }
              content.commandId = command.id;
              content.commandName = command.name;
              text.setValue(command.name);
              void this.commitChanges();
            },
          );
          return;
        }
        if (this.draft.content.kind === ACTION_KINDS.file) {
          const content = this.draft.content;
          text.onChange((value) => {
            content.filePath = value;
            content.fileName = this.getFileName(value);
            this.scheduleCommit();
          });
          this.targetSuggester = new FileInputSuggester(
            this.app,
            text.inputEl,
            (file) => {
              if (this.draft.content.kind !== ACTION_KINDS.file) {
                return;
              }
              content.filePath = file.path;
              content.fileName = file.name;
              text.setValue(file.path);
              void this.commitChanges();
            },
          );
          return;
        }
        text.onChange((value) => {
          if (this.draft.content.kind === ACTION_KINDS.url) {
            this.draft.content.url = value;
            this.scheduleCommit();
          }
        });
      });
  }

  private setContentKind(value: string): void {
    if (value === ACTION_KINDS.file) {
      this.draft.content = {
        kind: ACTION_KINDS.file,
        fileName: "",
        filePath: "",
      };
      return;
    }
    if (value === ACTION_KINDS.url) {
      this.draft.content = {
        kind: ACTION_KINDS.url,
        url: "",
      };
      return;
    }
    this.draft.content = {
      kind: ACTION_KINDS.command,
      commandName: "",
      commandId: "",
    };
  }

  private getTargetSettingConfig(): {
    name: string;
    description: string;
    placeholder: string;
  } {
    if (this.draft.content.kind === ACTION_KINDS.command) {
      return {
        name: "命令",
        description: "选择快捷方式执行的 Obsidian 命令",
        placeholder: "输入命令名称",
      };
    }
    if (this.draft.content.kind === ACTION_KINDS.file) {
      return {
        name: "文件",
        description: "选择快捷方式打开的库内文件",
        placeholder: "选择或输入文件路径",
      };
    }
    return {
      name: "链接",
      description: "设置快捷方式打开的网址或本地 HTML 文件",
      placeholder: "https://example.com 或 D:\\...\\index.html",
    };
  }

  private async openIconPicker(sourceEl: HTMLElement): Promise<void> {
    try {
      const result = await this.options.customIconsIntegration.openIconPicker(
        sourceEl,
        this.draft.icon,
      );
      if (result.handled) {
        if (result.icon !== null) {
          await this.applySelectedIcon(result.icon);
        }
        return;
      }
    } catch (error) {
      loggerOnError(error, "打开 Custom Icons 图标选择器失败\n(About Blank)");
    }

    const modal = IconSuggestModal.create(this.app, (selectedIcon: string) => {
      void this.applySelectedIcon(selectedIcon).catch((error) => {
        loggerOnError(error, "保存图标设置失败\n(About Blank)");
      });
    });
    modal.open();
  }

  private async applySelectedIcon(selectedIcon: string): Promise<void> {
    this.draft.icon = selectedIcon;
    this.updateIconPreview();
    await this.commitChanges();
  }

  private updateIconPreview(): void {
    if (!this.iconPreviewEl) {
      return;
    }

    this.iconPreviewEl.empty();
    if (!this.draft.icon) {
      setIcon(this.iconPreviewEl, "slash");
      return;
    }

    if (this.options.customIconsIntegration.renderIcon(this.iconPreviewEl, this.draft.icon)) {
      return;
    }

    try {
      setIcon(this.iconPreviewEl, this.draft.icon);
      if (!this.iconPreviewEl.querySelector("svg")) {
        this.iconPreviewEl.setText(",");
      }
    } catch {
      this.iconPreviewEl.setText(",");
    }
  }

  refreshIconPreview = (): void => {
    this.updateIconPreview();
  };

  private getTargetDisplayValue(): string {
    return this.draft.content.kind === ACTION_KINDS.command
      ? this.getCommandDisplayName()
      : this.draft.content.kind === ACTION_KINDS.file
        ? this.draft.content.filePath
        : this.draft.content.url;
  }

  private getCommandDisplayName(): string {
    if (this.draft.content.kind !== ACTION_KINDS.command) {
      return "";
    }
    const { commandId, commandName } = this.draft.content;
    const command = getRegisteredCommands(this.app)
      .find((item) => item.id === commandId);
    return command?.name ?? commandName;
  }

  private getFileName(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, "/");
    return normalizedPath.split("/").pop() ?? normalizedPath;
  }

  private async commitChanges(): Promise<void> {
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    this.draft.name = this.nameInputEl?.value ?? this.draft.name;

    const nextAction = structuredClone(this.draft);
    const nextState = JSON.stringify(nextAction);
    if (nextState === this.lastCommittedState) {
      return;
    }

    this.saveChain = this.saveChain.then(async () => {
      try {
        await this.options.onChange(nextAction);
        this.lastCommittedState = nextState;
      } catch (error) {
        loggerOnError(error, "保存快捷方式失败\n(About Blank)");
      }
    });
    await this.saveChain;
  }

  private async finalizeClose(): Promise<void> {
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    await this.commitChanges();
    this.targetSuggester?.close();
    this.targetSuggester = null;
    this.contentEl = null;
    this.nameInputEl = null;
    this.iconPreviewEl = null;
    this.modal = null;
    this.options.onClose?.(structuredClone(this.draft));
  }

  private scheduleCommit(): void {
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer);
    }

    this.autoSaveTimer = window.setTimeout(() => {
      void this.commitChanges();
    }, 180);
  }
}
