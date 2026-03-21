import {
  type App,
  type ButtonComponent,
  Modal,
  Setting,
} from "obsidian";

import {
  loggerOnError,
} from "src/commons";

interface DialogResponse {
  result: boolean;
  aborted: boolean;
}

interface ButtonSettings {
  text: string;
  cta?: boolean;
  warn?: boolean;
}

// =============================================================================

export class ConfirmDialogAsync extends Modal {
  contentContainer: Setting;
  buttonsContainer: Setting;
  response: Promise<DialogResponse>;
  resolve: (resolution: DialogResponse) => void;

  abortedResponse: DialogResponse = {
    result: false,
    aborted: true,
  } as const;

  constructor(
    app: App,
    title: string | null = null,
    content: string | null = null,
    positiveButton: string | ButtonSettings | null = null,
    negativeButton: string | ButtonSettings | null = null,
  ) {
    super(app);
    this.response = new Promise((resolve) => {
      this.resolve = resolve;
    });
    if (typeof title === "string") {
      this.setTitle(title);
    }
    this.contentContainer = new Setting(this.contentEl);
    this.setContentText(content);
    this.buttonsContainer = new Setting(this.contentEl);
    this.setButtons(positiveButton, negativeButton);
  }

  setContentText = (content: string | null) => {
    if (typeof content === "string") {
      this.contentContainer.setName(content);
    }
  };

  setButtons = (
    positiveButton: string | ButtonSettings | null,
    negativeButton: string | ButtonSettings | null,
  ) => {
    if (positiveButton === null && negativeButton === null) {
      return;
    }
    const pButton: ButtonSettings | null = typeof positiveButton === "string"
      ? { text: positiveButton }
      : positiveButton;
    const nButton: ButtonSettings | null = typeof negativeButton === "string"
      ? { text: negativeButton }
      : negativeButton;
    this.buttonsContainer.clear();
    if (pButton !== null) {
      this.buttonsContainer.addButton(this.addButtonCallback(pButton, true));
    }
    if (nButton !== null) {
      this.buttonsContainer.addButton(this.addButtonCallback(nButton, false));
    }
  };

  private addButtonCallback = (
    buttonSettings: ButtonSettings,
    result: boolean,
  ) => {
    return (button: ButtonComponent) => {
      button
        .setButtonText(buttonSettings.text)
        .onClick(() => {
          try {
            this.resolve({
              result,
              aborted: false,
            });
            this.close();
          } catch (error) {
            loggerOnError(error, "Error in button callback");
          }
        });
      if (buttonSettings.cta) {
        button.setCta();
      }
      if (buttonSettings.warn) {
        button.setWarning();
      }
    };
  };

  openReturnThis = () => {
    this.open();
    return this;
  };

  openAndRespond = async () => {
    // Avoid `return await` for error handling.
    return this.openReturnThis().response;
  };

  onClose() {
    try {
      // If the operation is aborted or otherwise unresolved, resolve it with `abortedResponse`.
      this.resolve(this.abortedResponse);
    } catch (error) {
      loggerOnError(error, "Error when closing dialog.");
    }
  }

  setOk = () => {
    this.setButtons(
      {
        text: "确定",
        cta: true,
      },
      null,
    );
    return this;
  };

  setOkCancel = () => {
    this.setButtons(
      {
        text: "确定",
        cta: true,
      },
      "取消",
    );
    return this;
  };

  setYesNo = () => {
    this.setButtons(
      {
        text: "是",
        cta: true,
      },
      "否",
    );
    return this;
  };

  setDeleteCancel = () => {
    this.setButtons(
      {
        text: "删除",
        warn: true,
      },
      "取消",
    );
    return this;
  };
}
