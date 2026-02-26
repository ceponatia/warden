import * as vscode from "vscode";

import type { ReportBundle } from "./types";

export class WardenOutput {
  private readonly channel = vscode.window.createOutputChannel("Warden");

  refresh(bundle: ReportBundle): void {
    this.channel.clear();
    if (bundle.markdown) {
      this.channel.appendLine(bundle.markdown);
      return;
    }

    if (!bundle.report) {
      this.channel.appendLine("No report found.");
      return;
    }

    this.channel.appendLine(JSON.stringify(bundle.report, null, 2));
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
