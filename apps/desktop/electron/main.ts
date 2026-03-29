import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DesktopAppStore } from "./app-store";
import { getChangedFiles, getFileDiff, stageFile } from "./app-store-diff";
import { listWorkspaceFiles } from "./app-store-files";
import { NotificationManager } from "./notification-manager";
import { ThemeManager } from "./theme-manager";
import type { ThemeMode } from "../src/desktop-state";
import { desktopIpc, getDesktopCommandFromShortcut } from "../src/ipc";
import type {
  ComposerImageAttachment,
  CreateSessionInput,
  CreateWorktreeInput,
  RemoveWorktreeInput,
  StartThreadInput,
  WorkspaceSessionTarget,
} from "../src/desktop-state";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

// Prevent multiple instances of the app from running on Windows.
// Without this guard, the NSIS installer post-install launch (or shortcuts)
// can cause runaway process accumulation.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let store: DesktopAppStore;
const themeManager = new ThemeManager();
let mainWindow: BrowserWindow | null = null;
let stopPublishingState: (() => void) | undefined;
let stopNotifications: (() => void) | undefined;

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

const SUPPORTED_IMAGE_TYPES = [
  { extension: "png", mimeType: "image/png" },
  { extension: "jpg", mimeType: "image/jpeg" },
  { extension: "jpeg", mimeType: "image/jpeg" },
  { extension: "gif", mimeType: "image/gif" },
  { extension: "webp", mimeType: "image/webp" },
] as const;

function createWindow(): BrowserWindow {
  const isMac = process.platform === "darwin";
  const resolvedTheme = themeManager.getResolvedTheme();
  const overlayColors = titleBarOverlayColors(resolvedTheme);
  const window = new BrowserWindow({
    icon: path.join(app.getAppPath(), "build", "icon.ico"),
    width: 1480,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: resolvedTheme === "dark" ? "#1e1f22" : "#f3f4f8",
    ...(isMac
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 18, y: 18 } }
      : { titleBarStyle: "hidden" as const, titleBarOverlay: { height: 38, ...overlayColors } }),
    show: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist-electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Security: prevent navigation away from the app
  window.webContents.on("will-navigate", (event, url) => {
    if (isDev && url.startsWith(process.env.VITE_DEV_SERVER_URL as string)) {
      return;
    }
    event.preventDefault();
  });

  // Security: prevent new window creation; open external links in the OS browser
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (["http:", "https:"].includes(parsed.protocol)) {
        void shell.openExternal(url);
      }
    } catch { /* ignore malformed URLs */ }
    return { action: "deny" };
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }

    // Zoom: Ctrl+= / Ctrl+- / Ctrl+0
    if ((process.platform === "darwin" ? input.meta : input.control) && !input.shift && !input.alt) {
      const zoomKey = input.key === "=" || input.key === "+" ? "in"
        : input.key === "-" ? "out"
        : input.key === "0" ? "reset"
        : undefined;
      if (zoomKey) {
        event.preventDefault();
        const wc = window.webContents;
        const current = wc.getZoomLevel();
        if (zoomKey === "in") wc.setZoomLevel(Math.min(current + 0.5, 5));
        else if (zoomKey === "out") wc.setZoomLevel(Math.max(current - 0.5, -3));
        else wc.setZoomLevel(0);
        return;
      }
    }

    const command = getDesktopCommandFromShortcut({
      modifier: process.platform === "darwin" ? input.meta : input.control,
      shift: input.shift,
      key: input.key,
      code: input.code,
    });
    if (command) {
      event.preventDefault();
      window.webContents.send(desktopIpc.appCommand, command);
    }
  });

  if (isDev) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
    if (process.env.PI_APP_OPEN_DEVTOOLS !== "0") {
      window.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    const indexPath = path.join(app.getAppPath(), "dist", "index.html");
    void window.loadURL(pathToFileURL(indexPath).toString());
  }

  return window;
}

function attachStatePublisher(window: BrowserWindow): void {
  stopPublishingState?.();
  stopPublishingState = store.subscribe((state) => {
    if (!window.isDestroyed()) {
      window.webContents.send(desktopIpc.stateChanged, state);
    }
  });
  window.once("closed", () => {
    stopPublishingState?.();
    stopPublishingState = undefined;
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
}

app.setName("pi");

app.whenReady().then(async () => {
  const userDataDir = process.env.PI_APP_USER_DATA_DIR?.trim() || app.getPath("userData");
  store = new DesktopAppStore({
    userDataDir,
    initialWorkspacePaths: resolveInitialWorkspacePaths(),
  });
  await store.initialize();
  stopNotifications = new NotificationManager(store, () => mainWindow).start();

  ipcMain.handle(desktopIpc.ping, () => "pi desktop ready");
  ipcMain.handle(desktopIpc.getThemeMode, () => themeManager.getMode());
  ipcMain.handle(desktopIpc.getResolvedTheme, () => themeManager.getResolvedTheme());
  ipcMain.handle(desktopIpc.setThemeMode, (_event, mode: ThemeMode) => {
    themeManager.setMode(mode);
    return mode;
  });
  ipcMain.handle(desktopIpc.openExternal, (_event, url: string) => {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Refusing to open unsupported URL: ${url}`);
    }
    return shell.openExternal(url);
  });
  ipcMain.handle(desktopIpc.stateRequest, () => store.getState());
  ipcMain.handle(desktopIpc.addWorkspacePath, (_event, workspacePath: string) => store.addWorkspace(workspacePath));
  ipcMain.handle(desktopIpc.pickWorkspace, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Open workspace folder",
    });
    if (result.canceled || result.filePaths.length === 0) {
      return store.getState();
    }
    return store.addWorkspace(result.filePaths[0] as string);
  });
  ipcMain.handle(desktopIpc.selectWorkspace, (_event, workspaceId: string) => store.selectWorkspace(workspaceId));
  ipcMain.handle(desktopIpc.renameWorkspace, (_event, workspaceId: string, displayName: string) =>
    store.renameWorkspace(workspaceId, displayName),
  );
  ipcMain.handle(desktopIpc.removeWorkspace, (_event, workspaceId: string) => store.removeWorkspace(workspaceId));
  ipcMain.handle(desktopIpc.openWorkspaceInFinder, async (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    await shell.openPath(workspacePath);
  });
  ipcMain.handle(desktopIpc.createWorktree, (_event, input: CreateWorktreeInput) =>
    store.createWorktree(input),
  );
  ipcMain.handle(desktopIpc.removeWorktree, (_event, input: RemoveWorktreeInput) =>
    store.removeWorktree(input),
  );
  ipcMain.handle(desktopIpc.syncCurrentWorkspace, () => store.syncCurrentWorkspace());
  ipcMain.handle(desktopIpc.selectSession, (_event, target: WorkspaceSessionTarget) =>
    store.selectSession(target),
  );
  ipcMain.handle(desktopIpc.archiveSession, (_event, target: WorkspaceSessionTarget) =>
    store.archiveSession(target),
  );
  ipcMain.handle(desktopIpc.unarchiveSession, (_event, target: WorkspaceSessionTarget) =>
    store.unarchiveSession(target),
  );
  ipcMain.handle(desktopIpc.setActiveView, (_event, activeView) => store.setActiveView(activeView));
  ipcMain.handle(desktopIpc.refreshRuntime, (_event, workspaceId?: string) => store.refreshRuntime(workspaceId));
  ipcMain.handle(desktopIpc.setSessionModel, (_event, workspaceId: string, sessionId: string, provider: string, modelId: string) =>
    store.setSessionModel({ workspaceId, sessionId }, provider, modelId),
  );
  ipcMain.handle(desktopIpc.setDefaultModel, (_event, workspaceId: string, provider: string, modelId: string) =>
    store.setDefaultModel(workspaceId, provider, modelId),
  );
  ipcMain.handle(
    desktopIpc.setDefaultThinkingLevel,
    (_event, workspaceId: string, thinkingLevel) => store.setDefaultThinkingLevel(workspaceId, thinkingLevel),
  );
  ipcMain.handle(
    desktopIpc.setSessionThinkingLevel,
    (_event, workspaceId: string, sessionId: string, thinkingLevel) =>
      store.setSessionThinkingLevel({ workspaceId, sessionId }, thinkingLevel),
  );
  ipcMain.handle(desktopIpc.loginProvider, (_event, workspaceId: string, providerId: string) =>
    store.loginProvider(workspaceId, providerId, createRuntimeLoginCallbacks()),
  );
  ipcMain.handle(desktopIpc.logoutProvider, (_event, workspaceId: string, providerId: string) =>
    store.logoutProvider(workspaceId, providerId),
  );
  ipcMain.handle(desktopIpc.setEnableSkillCommands, (_event, workspaceId: string, enabled: boolean) =>
    store.setEnableSkillCommands(workspaceId, enabled),
  );
  ipcMain.handle(desktopIpc.setScopedModelPatterns, (_event, workspaceId: string, patterns: readonly string[]) =>
    store.setScopedModelPatterns(workspaceId, patterns),
  );
  ipcMain.handle(desktopIpc.setSkillEnabled, (_event, workspaceId: string, filePath: string, enabled: boolean) =>
    store.setSkillEnabled(workspaceId, filePath, enabled),
  );
  ipcMain.handle(desktopIpc.setExtensionEnabled, (_event, workspaceId: string, filePath: string, enabled: boolean) =>
    store.setExtensionEnabled(workspaceId, filePath, enabled),
  );
  ipcMain.handle(desktopIpc.respondToHostUiRequest, (_event, workspaceId: string, sessionId: string, response) =>
    store.respondToHostUiRequest({ workspaceId, sessionId }, response),
  );
  ipcMain.handle(desktopIpc.setNotificationPreferences, (_event, preferences) =>
    store.setNotificationPreferences(preferences),
  );
  ipcMain.handle(desktopIpc.savePromptTemplate, (_event, name: string, prompt: string) =>
    store.savePromptTemplate(name, prompt),
  );
  ipcMain.handle(desktopIpc.deletePromptTemplate, (_event, templateId: string) =>
    store.deletePromptTemplate(templateId),
  );
  ipcMain.handle(desktopIpc.createSession, (_event, input: CreateSessionInput) =>
    store.createSession(input),
  );
  ipcMain.handle(desktopIpc.startThread, (_event, input: StartThreadInput) => store.startThread(input));
  ipcMain.handle(desktopIpc.openSkillInFinder, async (_event, workspaceId: string, filePath: string) => {
    const resolved = store.getSkillFilePath(workspaceId, filePath);
    if (!resolved) {
      throw new Error(`Unknown skill: ${filePath}`);
    }
    await shell.openPath(path.dirname(resolved));
  });
  ipcMain.handle(desktopIpc.readSkillSource, async (_event, workspaceId: string, filePath: string) => {
    const resolved = store.getSkillFilePath(workspaceId, filePath);
    if (!resolved) {
      throw new Error(`Unknown skill: ${filePath}`);
    }
    const content = await readFile(resolved, "utf8");
    return content;
  });
  ipcMain.handle(desktopIpc.openExtensionInFinder, async (_event, workspaceId: string, filePath: string) => {
    const resolved = store.getExtensionFilePath(workspaceId, filePath);
    if (!resolved) {
      throw new Error(`Unknown extension: ${filePath}`);
    }
    await shell.openPath(path.dirname(resolved));
  });
  ipcMain.handle(desktopIpc.cancelCurrentRun, () => store.cancelCurrentRun());
  ipcMain.handle(desktopIpc.pickComposerImages, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Images",
          extensions: SUPPORTED_IMAGE_TYPES.map((type) => type.extension),
        },
      ],
      title: "Attach images",
    });
    if (result.canceled || result.filePaths.length === 0) {
      return store.getState();
    }
    const attachments = await Promise.all(result.filePaths.map(readComposerImage));
    return store.addComposerImages(attachments);
  });
  ipcMain.handle(desktopIpc.addComposerImages, (_event, attachments: readonly ComposerImageAttachment[]) => {
    const allowedMimeTypes: Set<string> = new Set(SUPPORTED_IMAGE_TYPES.map((t) => t.mimeType));
    const validated = attachments.filter((a) => typeof a.mimeType === "string" && allowedMimeTypes.has(a.mimeType));
    return store.addComposerImages(validated);
  });
  ipcMain.handle(desktopIpc.removeComposerImage, (_event, attachmentId: string) =>
    store.removeComposerImage(attachmentId),
  );
  ipcMain.handle(desktopIpc.updateComposerDraft, (_event, composerDraft: string) =>
    store.updateComposerDraft(composerDraft),
  );
  ipcMain.handle(desktopIpc.submitComposer, (_event, text: string) => store.submitComposer(text));
  ipcMain.handle(desktopIpc.listWorkspaceFiles, async (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      return [];
    }
    return listWorkspaceFiles(workspacePath);
  });
  ipcMain.handle(desktopIpc.getChangedFiles, async (_event, workspaceId: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      return [];
    }
    return getChangedFiles(workspacePath);
  });
  ipcMain.handle(desktopIpc.getFileDiff, async (_event, workspaceId: string, filePath: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      return "";
    }
    return getFileDiff(workspacePath, filePath);
  });
  ipcMain.handle(desktopIpc.stageFile, async (_event, workspaceId: string, filePath: string) => {
    const workspacePath = store.getWorkspacePath(workspaceId);
    if (!workspacePath) {
      throw new Error(`Unknown workspace: ${workspaceId}`);
    }
    await stageFile(workspacePath, filePath);
  });
  ipcMain.handle(desktopIpc.toggleWindowMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }

    if (window.isMaximized()) {
      window.unmaximize();
      return;
    }

    window.maximize();
  });

  mainWindow = createWindow();
  themeManager.setWindow(mainWindow);
  attachStatePublisher(mainWindow);

  // Log Electron process metrics periodically for diagnostics.
  const logProcessMetrics = () => {
    const metrics = app.getAppMetrics();
    const summary = metrics.map((m) => `${m.type}(pid=${m.pid}, mem=${Math.round(m.memory.workingSetSize / 1024)}MB)`);
    console.log(`[process-monitor] ${metrics.length} Electron processes: ${summary.join(", ")}`);
  };
  logProcessMetrics();
  const metricsInterval = setInterval(logProcessMetrics, 60_000);
  app.on("before-quit", () => clearInterval(metricsInterval));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      themeManager.setWindow(mainWindow);
      attachStatePublisher(mainWindow);
    }
  });
});

app.on("window-all-closed", () => {
  stopNotifications?.();
  stopNotifications = undefined;
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopNotifications?.();
  stopNotifications = undefined;
  // Dispose all open pi.exe child processes to prevent orphaned process
  // accumulation across app restarts (Issue #13).
  store?.driver.destroyAllSessions();
});

function resolveInitialWorkspacePaths(): readonly string[] {
  const raw = process.env.PI_APP_INITIAL_WORKSPACES;
  if (raw !== undefined) {
    return raw
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

async function readComposerImage(filePath: string): Promise<ComposerImageAttachment> {
  const buffer = await readFile(filePath);
  return {
    id: randomUUID(),
    name: path.basename(filePath),
    mimeType: mimeTypeForPath(filePath),
    data: buffer.toString("base64"),
  };
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const supported = SUPPORTED_IMAGE_TYPES.find((type) => type.extension === extension);
  if (supported) {
    return supported.mimeType;
  }
  return "application/octet-stream";
}

function titleBarOverlayColors(theme: "light" | "dark"): { color: string; symbolColor: string } {
  return theme === "dark"
    ? { color: "#1e1f22", symbolColor: "#9ca3af" }
    : { color: "#f3f4f8", symbolColor: "#6b7280" };
}

function createRuntimeLoginCallbacks() {
  return {
    onAuth: async ({ url, instructions: _instructions }: { readonly url: string; readonly instructions?: string }) => {
      await shell.openExternal(url);
    },
    onPrompt: async ({ message, placeholder }: { readonly message: string; readonly placeholder?: string }) =>
      promptForText(message, placeholder),
  };
}

async function promptForText(message: string, placeholder = ""): Promise<string> {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    throw new Error("Main window is not available for login.");
  }
  window.show();
  window.focus();
  const result = await window.webContents.executeJavaScript(
    `window.prompt(${JSON.stringify(message)}, ${JSON.stringify(placeholder)})`,
    true,
  );
  if (typeof result !== "string" || result.trim().length === 0) {
    throw new Error("Login cancelled.");
  }
  return result.trim();
}
