import {
  type App,
  Modal,
  TFile,
} from "obsidian";

import type AboutBlank from "src/main";

// =============================================================================

export class HeatmapFilesModal extends Modal {
  plugin: AboutBlank;
  date: string;
  files: TFile[];

  constructor(app: App, plugin: AboutBlank, date: string, files: TFile[]) {
    super(app);
    this.plugin = plugin;
    this.date = date;
    this.files = files;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('about-blank-heatmap-files-modal');

    // 标题
    const header = contentEl.createEl('div', { cls: 'about-blank-heatmap-files-modal-header' });
    header.createEl('h3', { text: this.date });
    header.createEl('div', { 
      cls: 'about-blank-heatmap-files-modal-count',
      text: `共 ${this.files.length} 个文件` 
    });

    // 文件列表容器
    const fileListContainer = contentEl.createEl('div', { 
      cls: 'about-blank-heatmap-files-modal-content' 
    });

    if (this.files.length === 0) {
      fileListContainer.createEl('div', { 
        cls: 'about-blank-heatmap-files-modal-empty',
        text: '该日期没有文件' 
      });
      return;
    }

    // 创建文件列表
    const fileList = fileListContainer.createEl('div', { 
      cls: 'about-blank-heatmap-files-list' 
    });

    this.files.forEach((file) => {
      const fileItem = fileList.createEl('div', { 
        cls: 'about-blank-heatmap-files-item' 
      });

      // 文件图标
      const iconContainer = fileItem.createEl('div', { 
        cls: 'about-blank-heatmap-files-item-icon' 
      });
      iconContainer.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
      `;

      // 文件信息容器
      const fileInfoContainer = fileItem.createEl('div', { 
        cls: 'about-blank-heatmap-files-item-info' 
      });

      // 文件名
      const fileName = fileInfoContainer.createEl('div', { 
        cls: 'about-blank-heatmap-files-item-name',
        text: file.basename 
      });

      // 文件路径
      const filePath = fileInfoContainer.createEl('div', { 
        cls: 'about-blank-heatmap-files-item-path',
        text: file.path 
      });

      // 添加点击事件
      fileItem.addEventListener('click', async () => {
        try {
          // 打开文件
          const leaf = this.app.workspace.getLeaf(false);
          await leaf.openFile(file);
          
          // 关闭模态窗口
          this.close();
        } catch (error) {
          console.error('打开文件失败:', error);
        }
      });

      // 添加悬停效果
      fileItem.setAttribute('tabindex', '0');
      fileItem.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileItem.click();
        }
      });
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
