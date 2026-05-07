import {
  type App,
} from "obsidian";

import {
  loggerOnError,
} from "src/commons";

import {
  EditorModal,
} from "src/ui/editorModal";

import {
  type DateStatDefinition,
  DATE_STAT_TYPES,
  createDateStat,
  isDateStatDefinition,
} from "src/settings/dateStatTypes";

// =============================================================================

interface DateStatEditorModalOptions {
  onChange: (stat: DateStatDefinition) => Promise<void>;
  onClose?: () => void;
}

export class DateStatEditorModal {
  private readonly app: App;
  private readonly options: DateStatEditorModalOptions;
  private draft: DateStatDefinition;
  private modal: EditorModal | null = null;
  private contentEl: HTMLDivElement | null = null;
  private titleInputEl: HTMLInputElement | null = null;
  private typeSelectEl: HTMLSelectElement | null = null;
  private dateInputEl: HTMLInputElement | null = null;
  private saveChain: Promise<void> = Promise.resolve();

  constructor(
    app: App,
    initialStat: DateStatDefinition,
    options: DateStatEditorModalOptions,
  ) {
    this.app = app;
    this.options = options;
    this.draft = structuredClone(isDateStatDefinition(initialStat) ? initialStat : createDateStat());
  }

  open = (): void => {
    if (this.modal) {
      return;
    }

    this.modal = new EditorModal(this.app, {
      modalClass: "about-blank-date-stat-editor-modal-shell",
      contentClass: "about-blank-date-stat-editor-modal",
      onOpen: (contentEl) => {
        this.contentEl = contentEl as HTMLDivElement;
        this.render();
      },
      onClose: () => {
        this.contentEl = null;
        this.titleInputEl = null;
        this.typeSelectEl = null;
        this.dateInputEl = null;
        this.modal = null;
        this.options.onClose?.();
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

    this.contentEl.empty();

    // 紧凑型 meta 行：标题 + 类型在同一行
    const metaRowEl = this.contentEl.createDiv({ cls: "about-blank-date-stat-editor-meta-row" });

    // 标题
    const nameControlEl = this.createInlineField(metaRowEl, "标题");
    this.titleInputEl = nameControlEl.createEl("input", {
      cls: "about-blank-date-stat-editor-input",
      attr: { type: "text", placeholder: "日期统计标题" },
    });
    this.titleInputEl.value = this.draft.title;
    this.titleInputEl.addEventListener("input", () => {
      this.draft.title = this.titleInputEl?.value ?? "";
    });
    this.titleInputEl.addEventListener("change", () => {
      void this.commitChanges();
    });

    // 类型
    const typeControlEl = this.createInlineField(metaRowEl, "类型");
    this.typeSelectEl = typeControlEl.createEl("select", {
      cls: "about-blank-stat-editor-select",
    });
    this.typeSelectEl.addClass("dropdown");
    this.typeSelectEl.createEl("option", { value: DATE_STAT_TYPES.anniversary, text: "纪念日" });
    this.typeSelectEl.createEl("option", { value: DATE_STAT_TYPES.countdown, text: "倒数日" });
    this.typeSelectEl.value = this.draft.type;
    this.typeSelectEl.addEventListener("change", () => {
      this.draft.type = (this.typeSelectEl?.value as typeof DATE_STAT_TYPES.anniversary) ?? DATE_STAT_TYPES.anniversary;
      this.draft.date = "";
      this.render();
      void this.commitChanges();
    });

    // 日期行
    const isAnniversary = this.draft.type === DATE_STAT_TYPES.anniversary;
    const dateRowEl = this.contentEl.createDiv({ cls: "about-blank-date-stat-editor-meta-row" });
    const dateControlEl = this.createInlineField(dateRowEl, isAnniversary ? "目标日期" : "目标日期（月·日）");

    this.dateInputEl = dateControlEl.createEl("input", {
      cls: "about-blank-date-stat-editor-input",
      attr: {
        type: isAnniversary ? "date" : "text",
        placeholder: isAnniversary ? "" : "MM-DD 如 12-25",
      },
    });
    this.dateInputEl.value = this.draft.date;
    this.dateInputEl.addEventListener("input", () => {
      this.draft.date = this.dateInputEl?.value ?? "";
    });
    this.dateInputEl.addEventListener("change", () => {
      this.draft.date = this.dateInputEl?.value ?? "";
      void this.commitChanges();
    });
  };

  private createInlineField = (parentEl: HTMLElement, label: string): HTMLElement => {
    const fieldEl = parentEl.createDiv({ cls: "about-blank-date-stat-editor-inline-field" });
    fieldEl.createDiv({ cls: "about-blank-date-stat-editor-label", text: label });
    return fieldEl.createDiv({ cls: "about-blank-date-stat-editor-control" });
  };

  private commitChanges = async (): Promise<void> => {
    const toSave = structuredClone(this.draft);
    this.saveChain = this.saveChain.then(async () => {
      try {
        await this.options.onChange(toSave);
      } catch (error) {
        loggerOnError(error, "保存日期统计项目失败\n(About Blank)");
      }
    });
    await this.saveChain;
  };
}
