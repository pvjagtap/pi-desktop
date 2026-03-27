import { nativeTheme, type BrowserWindow } from "electron";
import { desktopIpc } from "../src/ipc";
import type { ThemeMode } from "../src/desktop-state";

export class ThemeManager {
  private mode: ThemeMode = "system";
  private window: BrowserWindow | null = null;

  constructor() {
    nativeTheme.on("updated", () => {
      this.broadcast();
      this.updateTitleBarOverlay();
    });
  }

  setWindow(win: BrowserWindow) {
    this.window = win;
  }

  getMode(): ThemeMode {
    return this.mode;
  }

  getResolvedTheme(): "light" | "dark" {
    if (this.mode === "system") {
      return nativeTheme.shouldUseDarkColors ? "dark" : "light";
    }
    return this.mode;
  }

  setMode(mode: ThemeMode) {
    this.mode = mode;
    if (mode === "system") {
      nativeTheme.themeSource = "system";
    } else {
      nativeTheme.themeSource = mode;
    }
    this.broadcast();
    this.updateTitleBarOverlay();
  }

  private broadcast() {
    this.window?.webContents.send(desktopIpc.themeChanged, this.getResolvedTheme());
  }

  private updateTitleBarOverlay() {
    if (!this.window || this.window.isDestroyed() || process.platform === "darwin") {
      return;
    }
    const resolved = this.getResolvedTheme();
    try {
      this.window.setTitleBarOverlay({
        color: resolved === "dark" ? "#1e1f22" : "#f3f4f8",
        symbolColor: resolved === "dark" ? "#9ca3af" : "#6b7280",
      });
    } catch { /* setTitleBarOverlay not available on all platforms */ }
  }
}
