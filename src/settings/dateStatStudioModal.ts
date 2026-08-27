import {
  type App,
  Setting,
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

interface DateStatEditorModalOptions {
  onChange: (stat: DateStatDefinition) => Promise<void>;
  onClose?: (stat: DateStatDefinition) => void;
}

export class DateStatEditorModal {
  private readonly draft: DateStatDefinition;
  private modal: EditorModal | null = null;
  private contentEl: HTMLElement | null = null;
  private titleInputEl: HTMLInputElement | null = null;
  private autoSaveTimer: number | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private lastCommittedState: string;

  constructor(
    private readonly app: App,
    initialStat: DateStatDefinition,
    private readonly options: DateStatEditorModalOptions,
  ) {
    this.draft = structuredClone(
      isDateStatDefinition(initialStat) ? initialStat : createDateStat(),
    );
    this.lastCommittedState = JSON.stringify(this.draft);
  }

  open = (): void => {
    if (this.modal) {
      return;
    }
    this.modal = new EditorModal(this.app, {
      modalClass: "about-blank-date-stat-editor-modal-shell",
      contentClass: "about-blank-date-stat-editor-modal",
      onOpen: (contentEl) => {
        this.contentEl = contentEl;
        this.render();
        this.titleInputEl?.win.requestAnimationFrame(() => {
          this.titleInputEl?.focus();
          this.titleInputEl?.select();
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

  private render(): void {
    if (!this.contentEl) {
      return;
    }
    const previousScrollTop = this.contentEl.scrollTop;
    this.contentEl.empty();
    this.titleInputEl = null;

    new Setting(this.contentEl)
      .setName("名称")
      .setDesc("设置日期统计显示的名称")
      .addText((text) => {
        this.titleInputEl = text.inputEl;
        text
          .setPlaceholder("日期统计名称")
          .setValue(this.draft.title)
          .onChange((value) => {
            this.draft.title = value;
            this.scheduleCommit();
          });
      });

    new Setting(this.contentEl)
      .setName("类型")
      .setDesc("设置日期统计的计算方式")
      .addDropdown((dropdown) => dropdown
        .addOption(DATE_STAT_TYPES.anniversary, "纪念日")
        .addOption(DATE_STAT_TYPES.countdown, "倒数日")
        .setValue(this.draft.type)
        .onChange((value) => {
          this.draft.type = value === DATE_STAT_TYPES.countdown
            ? DATE_STAT_TYPES.countdown
            : DATE_STAT_TYPES.anniversary;
          this.draft.date = "";
          this.render();
          this.scheduleCommit();
        }));

    const isAnniversary = this.draft.type === DATE_STAT_TYPES.anniversary;
    new Setting(this.contentEl)
      .setName("目标日期")
      .setDesc(isAnniversary
        ? "选择用于计算累计天数的日期"
        : "设置每年重复计算的月和日")
      .addText((text) => {
        text.inputEl.type = isAnniversary ? "date" : "text";
        text
          .setPlaceholder(isAnniversary ? "" : "MM-DD, 如 12-25")
          .setValue(this.draft.date)
          .onChange((value) => {
            this.draft.date = value;
            this.scheduleCommit();
          });
      });
    this.restoreScrollPosition(previousScrollTop);
  }

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

  private scheduleCommit(): void {
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer);
    }
    this.autoSaveTimer = window.setTimeout(() => {
      void this.commitChanges();
    }, 180);
  }

  private async commitChanges(): Promise<void> {
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    const nextStat = structuredClone(this.draft);
    const nextState = JSON.stringify(nextStat);
    if (nextState === this.lastCommittedState) {
      return;
    }
    this.saveChain = this.saveChain.then(async () => {
      try {
        await this.options.onChange(nextStat);
        this.lastCommittedState = nextState;
      } catch (error) {
        loggerOnError(error, "保存日期统计项目失败\n(About Blank)");
      }
    });
    await this.saveChain;
  }

  private async finalizeClose(): Promise<void> {
    await this.commitChanges();
    this.contentEl = null;
    this.titleInputEl = null;
    this.modal = null;
    this.options.onClose?.(structuredClone(this.draft));
  }
}
