import {
  type App,
  type Command,
  setIcon,
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
  StringSuggesterAsync,
} from "src/ui/stringSuggesterAsync";

import {
  type UnsafeApp,
} from "src/unsafe";

import {
  CustomIconManager,
} from "src/utils/customIconManager";

import {
  EditorModal,
} from "src/ui/editorModal";

interface ActionEditorModalOptions {
  title: string;
  iconFolder: string;
  iconMask: boolean;
  onChange: (action: Action) => Promise<void>;
  onClose?: () => void;
}

export class ActionEditorModal {
  private readonly app: App;
  private readonly options: ActionEditorModalOptions;
  private readonly customIconManager: CustomIconManager;
  private readonly draft: Action;
  private modal: EditorModal | null = null;
  private contentEl: HTMLDivElement | null = null;
  private nameInputEl: HTMLInputElement | null = null;
  private valueInputEl: HTMLInputElement | null = null;
  private typeSelectEl: HTMLSelectElement | null = null;
  private iconPreviewEl: HTMLElement | null = null;
  private autoSaveTimer: number | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private lastCommittedState: string;

  constructor(app: App, action: Action, options: ActionEditorModalOptions) {
    this.app = app;
    this.options = options;
    this.customIconManager = CustomIconManager.getInstance(app);
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
        this.contentEl = contentEl as HTMLDivElement;
        this.render();
        requestAnimationFrame(() => {
          this.nameInputEl?.focus();
          this.nameInputEl?.select();
        });
      },
      onClose: () => {
        this.contentEl = null;
        this.nameInputEl = null;
        this.valueInputEl = null;
        this.typeSelectEl = null;
        this.iconPreviewEl = null;
        this.modal = null;
        this.options.onClose?.();
      },
    });
    this.modal.open();
  };

  close = (): void => {
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    this.modal?.close();
  };

  private render = (): void => {
    if (!this.contentEl) {
      return;
    }

    this.contentEl.empty();

    const headerEl = this.contentEl.createDiv({ cls: "about-blank-action-editor-header" });
    headerEl.createDiv({
      cls: "about-blank-action-editor-title",
      text: this.draft.name.trim() || this.options.title,
    });

    const nameControlEl = this.createFormRow(this.contentEl, "名称");
    this.nameInputEl = nameControlEl.createEl("input", {
      cls: "about-blank-action-editor-input about-blank-action-editor-name-input",
      attr: { type: "text", placeholder: "快捷方式名称" },
    });
    this.nameInputEl.value = this.draft.name;
    this.nameInputEl.addEventListener("input", () => {
      this.draft.name = this.nameInputEl?.value ?? "";
      this.updateTitle();
      this.scheduleCommit();
    });

    const metaRowEl = this.contentEl.createDiv({ cls: "about-blank-action-editor-compact-row" });
    this.createIconField(metaRowEl);
    this.createTypeField(metaRowEl);

    const valueControlEl = this.createFormRow(this.contentEl, this.getValueLabel());
    this.valueInputEl = valueControlEl.createEl("input", {
      cls: "about-blank-action-editor-input about-blank-action-editor-value-input about-blank-action-editor-picker-input",
      attr: { type: "text", placeholder: this.getValuePlaceholder() },
    });
    this.valueInputEl.value = this.getCurrentValue();
    this.valueInputEl.addEventListener("input", () => {
      this.setCurrentValue(this.valueInputEl?.value ?? "");
      this.scheduleCommit();
    });
    this.valueInputEl.addEventListener("click", () => {
      void this.openValuePicker();
    });
  };

  private createFormRow(parentEl: HTMLElement, label: string): HTMLElement {
    const rowEl = parentEl.createDiv({ cls: "about-blank-action-editor-form-row" });
    rowEl.createDiv({ cls: "about-blank-action-editor-label", text: label });
    return rowEl.createDiv({ cls: "about-blank-action-editor-control" });
  }

  private createIconField(parentEl: HTMLElement): void {
    parentEl.createDiv({ cls: "about-blank-action-editor-label", text: "图标" });
    const fieldEl = parentEl.createDiv({ cls: "about-blank-action-editor-icon-field" });
    const iconButton = fieldEl.createEl("button", {
      cls: "about-blank-icon-picker-button about-blank-action-editor-icon-trigger",
      attr: { type: "button", "aria-label": "选择图标" },
    });

    this.iconPreviewEl = iconButton.createDiv({ cls: "about-blank-icon-picker-preview" });
    void this.updateIconPreview();

    iconButton.addEventListener("click", () => {
      void this.openIconPicker();
    });
  }

  private createTypeField(parentEl: HTMLElement): void {
    parentEl.createDiv({ cls: "about-blank-action-editor-label", text: "类型" });
    this.typeSelectEl = parentEl.createEl("select", { cls: "about-blank-action-editor-select" });
    this.typeSelectEl.addClass("dropdown");
    this.typeSelectEl.addClass("about-blank-action-editor-native-select");
    this.typeSelectEl.createEl("option", { value: ACTION_KINDS.command, text: "命令" });
    this.typeSelectEl.createEl("option", { value: ACTION_KINDS.file, text: "文件" });
    this.typeSelectEl.value = this.draft.content.kind;
    this.typeSelectEl.addEventListener("change", () => {
      const nextKind = this.typeSelectEl?.value as typeof ACTION_KINDS.command | typeof ACTION_KINDS.file;
      if (nextKind === ACTION_KINDS.command) {
        this.draft.content = {
          kind: ACTION_KINDS.command,
          commandName: "",
          commandId: "",
        };
      } else {
        this.draft.content = {
          kind: ACTION_KINDS.file,
          fileName: "",
          filePath: "",
        };
      }
      this.render();
      void this.commitChanges();
    });
  }

  private updateTitle(): void {
    const titleEl = this.contentEl?.querySelector<HTMLElement>(".about-blank-action-editor-title");
    titleEl?.setText(this.draft.name.trim() || this.options.title);
  }

  private async openIconPicker(): Promise<void> {
    const modal = await IconSuggestModal.create(
      this.app,
      this.options.iconFolder,
      this.options.iconMask,
      async (selectedIcon: string) => {
        this.draft.icon = selectedIcon;
        await this.updateIconPreview();
        await this.commitChanges();
      },
    );
    modal.open();
  }

  private async updateIconPreview(): Promise<void> {
    if (!this.iconPreviewEl) {
      return;
    }

    this.iconPreviewEl.empty();
    if (!this.draft.icon) {
      setIcon(this.iconPreviewEl, "slash");
      return;
    }

    if (this.customIconManager.isCustomIcon(this.draft.icon)) {
      const rendered = await this.customIconManager.renderIcon(this.draft.icon, this.iconPreviewEl, this.options.iconMask);
      if (!rendered) {
        this.iconPreviewEl.setText("?");
      }
      return;
    }

    try {
      setIcon(this.iconPreviewEl, this.draft.icon);
    } catch {
      this.iconPreviewEl.setText("?");
    }
  }

  private getValueLabel(): string {
    return this.draft.content.kind === ACTION_KINDS.command ? "命令" : "文件";
  }

  private getValuePlaceholder(): string {
    return this.draft.content.kind === ACTION_KINDS.command ? "命令 ID" : "文件路径";
  }

  private getCurrentValue(): string {
    return this.draft.content.kind === ACTION_KINDS.command
      ? this.draft.content.commandId
      : this.draft.content.filePath;
  }

  private setCurrentValue(value: string): void {
    if (this.draft.content.kind === ACTION_KINDS.command) {
      this.draft.content.commandId = value;
      if (!value.trim()) {
        this.draft.content.commandName = "";
      }
      return;
    }

    this.draft.content.filePath = value;
    this.draft.content.fileName = value;
  }

  private async openValuePicker(): Promise<void> {
    if (this.draft.content.kind === ACTION_KINDS.command) {
      const rawCommands = (this.app as UnsafeApp).commands.commands;
      const commands: Command[] = Array.isArray(rawCommands)
        ? rawCommands
        : Object.values(rawCommands ?? {}) as Command[];
      const commandList = commands.map((command) => ({
        name: command.name,
        value: command.id,
      }));

      const selected = await new StringSuggesterAsync(this.app, commandList, "选择命令...").openAndRespond();
      if (selected.aborted || this.draft.content.kind !== ACTION_KINDS.command) {
        return;
      }

      this.draft.content.commandId = selected.result.value;
      this.draft.content.commandName = commands.find((command) => command.id === selected.result.value)?.name || "";
      if (this.valueInputEl) {
        this.valueInputEl.value = selected.result.value;
      }
      await this.commitChanges();
      return;
    }

    const files = this.app.vault.getFiles().map((file) => ({
      name: file.path,
      value: file.path,
    }));
    const selected = await new StringSuggesterAsync(this.app, files, "选择文件...").openAndRespond();
    if (selected.aborted || this.draft.content.kind !== ACTION_KINDS.file) {
      return;
    }

    this.draft.content.filePath = selected.result.value;
    this.draft.content.fileName = selected.result.value;
    if (this.valueInputEl) {
      this.valueInputEl.value = selected.result.value;
    }
    await this.commitChanges();
  }

  private async commitChanges(): Promise<void> {
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    this.draft.name = this.nameInputEl?.value ?? this.draft.name;
    if (this.valueInputEl) {
      this.setCurrentValue(this.valueInputEl.value);
    }

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

  private scheduleCommit(): void {
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer);
    }

    this.autoSaveTimer = window.setTimeout(() => {
      void this.commitChanges();
    }, 180);
  }
}