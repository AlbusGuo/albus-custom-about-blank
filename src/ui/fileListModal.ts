import {
  type App,
  Modal,
  setIcon,
  TFile,
} from "obsidian";

import {
  loggerOnError,
} from "src/commons";

// =============================================================================

export class FileListModal extends Modal {
  private readonly heading: string;
  private readonly files: TFile[];
  private readonly emptyText: string;

  constructor(
    app: App,
    heading: string,
    files: TFile[],
    emptyText = "没有匹配的文件",
  ) {
    super(app);
    this.heading = heading;
    this.files = files;
    this.emptyText = emptyText;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('about-blank-files-modal');
    contentEl.addClass('about-blank-files-modal-content');
    this.setTitle(`${this.heading} - ${this.files.length} 个文件`);

    if (this.files.length === 0) {
      contentEl.createEl('div', {
        cls: 'about-blank-files-modal-empty',
        text: this.emptyText,
      });
      return;
    }

    const fileList = contentEl.createEl('div', {
      cls: 'about-blank-files-list',
    });

    this.files.forEach((file) => {
      const fileItem = fileList.createEl('button', {
        cls: 'clickable-icon about-blank-files-item',
        attr: {
          type: 'button',
        },
      });

      const iconContainer = fileItem.createSpan({
        cls: 'about-blank-files-item-icon',
      });
      setIcon(iconContainer, 'file-text');

      const fileInfoContainer = fileItem.createSpan({
        cls: 'about-blank-files-item-info',
      });
      fileInfoContainer.createSpan({
        cls: 'about-blank-files-item-name',
        text: file.basename,
      });
      fileInfoContainer.createSpan({
        cls: 'about-blank-files-item-path',
        text: file.path,
      });

      fileItem.addEventListener('click', () => {
        void this.openFile(file);
      });
    });
  }

  private async openFile(file: TFile): Promise<void> {
    try {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      this.close();
    } catch (error) {
      loggerOnError(error, '打开文件失败\n(About Blank)');
    }
  }

  onClose() {
    this.contentEl.empty();
    this.modalEl.removeClass('about-blank-files-modal');
  }
}
