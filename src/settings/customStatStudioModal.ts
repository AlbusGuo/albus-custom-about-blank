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
  CustomStatQueryEditor,
} from "src/ui/customStatQueryEditor";

import {
  createCustomStatDefinition,
  isCustomStatDefinition,
  type CustomStatDefinition,
} from "src/utils/customStatQuery";

interface CustomStatEditorModalOptions {
  onChange: (stat: CustomStatDefinition) => Promise<void>;
  onClose?: (stat: CustomStatDefinition) => void;
}

export class CustomStatEditorModal {
  private readonly draft: CustomStatDefinition;
  private modal: EditorModal | null = null;
  private contentEl: HTMLElement | null = null;
  private nameInputEl: HTMLInputElement | null = null;
  private filterEditor: CustomStatQueryEditor | null = null;
  private autoSaveTimer: number | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private lastCommittedState: string;

  constructor(
    private readonly app: App,
    initialStat: CustomStatDefinition,
    private readonly options: CustomStatEditorModalOptions,
  ) {
    this.draft = structuredClone(
      isCustomStatDefinition(initialStat)
        ? initialStat
        : createCustomStatDefinition(),
    );
    this.lastCommittedState = JSON.stringify(this.draft);
  }

  open = (): void => {
    if (this.modal) {
      return;
    }
    this.modal = new EditorModal(this.app, {
      modalClass: "about-blank-stat-editor-modal-shell",
      contentClass: "about-blank-stat-editor-modal",
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

  private render(): void {
    if (!this.contentEl) {
      return;
    }
    this.filterEditor?.destroy();
    this.contentEl.empty();
    this.nameInputEl = null;

    new Setting(this.contentEl)
      .setName("名称")
      .setDesc("设置文件统计显示的名称")
      .addText((text) => {
        this.nameInputEl = text.inputEl;
        text
          .setPlaceholder("文件统计名称")
          .setValue(this.draft.displayName)
          .onChange((value) => {
            this.draft.displayName = value;
            this.scheduleCommit();
          });
      });

    const filterSetting = new Setting(this.contentEl)
      .setName("筛选")
      .setDesc("设置参与文件统计的筛选条件");
    filterSetting.settingEl.addClass("about-blank-stat-filter-setting");
    const filterEl = filterSetting.controlEl.createDiv();
    this.filterEditor = new CustomStatQueryEditor(
      this.app,
      this.draft.filters,
      {
        onChange: () => {
          this.scheduleCommit();
        },
      },
    );
    this.filterEditor.mount(filterEl);
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
        loggerOnError(error, "保存自定义统计项目失败\n(About Blank)");
      }
    });
    await this.saveChain;
  }

  private async finalizeClose(): Promise<void> {
    await this.commitChanges();
    this.filterEditor?.destroy();
    this.filterEditor = null;
    this.contentEl = null;
    this.nameInputEl = null;
    this.modal = null;
    this.options.onClose?.(structuredClone(this.draft));
  }
}
