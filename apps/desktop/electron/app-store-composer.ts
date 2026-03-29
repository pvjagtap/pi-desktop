import { sessionKey } from "@pi-gui/pi-sdk-driver";
import type { SessionRef } from "@pi-gui/session-driver";
import type { ComposerImageAttachment, DesktopAppState, TranscriptMessage, WorkspaceSessionTarget } from "../src/desktop-state";
import { toSessionRef } from "./app-store-utils";
import {
  formatSessionConfigStatus,
  hasRuntimeSlashCommand,
  incompleteComposerCommandMessage,
  parseComposerCommand,
} from "../src/composer-commands";
import { appendUserMessage, clearActiveAssistantMessage } from "./app-store-timeline";
import {
  cloneComposerImageAttachments,
  cloneTranscriptMessage,
  makeActivityItem,
  previewFromTranscript,
  toSessionAttachments,
  toTranscriptAttachments,
} from "./app-store-utils";
import type { AppStoreInternals } from "./app-store-internals";
import { app, clipboard, dialog, BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";

/* ── Public methods ─────────────────────────────────────── */

export async function updateComposerDraft(
  store: AppStoreInternals,
  composerDraft: string,
): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = store.selectedSessionRef();
  if (sessionRef) {
    const key = sessionKey(sessionRef);
    if (composerDraft) {
      store.sessionState.composerDraftsBySession.set(key, composerDraft);
    } else {
      store.sessionState.composerDraftsBySession.delete(key);
    }
  }
  store.state = {
    ...store.state,
    composerDraft,
    lastError: undefined,
    revision: store.state.revision + 1,
  };
  await store.persistUiState();
  return store.emit();
}

export async function addComposerImages(
  store: AppStoreInternals,
  attachments: readonly ComposerImageAttachment[],
): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = store.selectedSessionRef();
  if (!sessionRef || attachments.length === 0) {
    return store.emit();
  }

  const key = sessionKey(sessionRef);
  const existing = store.sessionState.composerAttachmentsBySession.get(key) ?? [];
  const next = [...existing, ...attachments];
  store.sessionState.composerAttachmentsBySession.set(key, next);
  store.state = {
    ...store.state,
    composerAttachments: next,
    revision: store.state.revision + 1,
  };
  await store.persistComposerAttachments(key, next);
  return store.emit();
}

export async function removeComposerImage(
  store: AppStoreInternals,
  attachmentId: string,
): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = store.selectedSessionRef();
  if (!sessionRef) {
    return store.emit();
  }

  const key = sessionKey(sessionRef);
  const existing = store.sessionState.composerAttachmentsBySession.get(key) ?? [];
  const next = existing.filter((attachment) => attachment.id !== attachmentId);
  if (next.length > 0) {
    store.sessionState.composerAttachmentsBySession.set(key, next);
  } else {
    store.sessionState.composerAttachmentsBySession.delete(key);
  }
  store.state = {
    ...store.state,
    composerAttachments: next,
    revision: store.state.revision + 1,
  };
  await store.persistComposerAttachments(key, next);
  return store.emit();
}

export async function submitComposer(store: AppStoreInternals, textInput: string): Promise<DesktopAppState> {
  await store.initialize();
  const text = textInput.trim();
  const sessionRef = store.selectedSessionRef();
  const attachments = sessionRef
    ? store.sessionState.composerAttachmentsBySession.get(sessionKey(sessionRef)) ?? []
    : [];
  if (!text && attachments.length === 0) {
    return store.emit();
  }
  if (!sessionRef) {
    return store.withError("Create or select a session before sending a message.");
  }

  const runtime = store.runtimeByWorkspace.get(sessionRef.workspaceId);
  const sessionCommands = store.sessionState.sessionCommandsBySession.get(sessionKey(sessionRef)) ?? [];
  const runtimeSlashCommand = hasRuntimeSlashCommand(text, runtime, sessionCommands);

  if (text.startsWith("/") && !runtimeSlashCommand) {
    const handled = await runComposerCommand(store, sessionRef, text);
    if (handled) {
      return handled;
    }
  }

  const key = sessionKey(sessionRef);
  try {
    await sendMessageToSession(store, sessionRef, text, attachments);
    if (runtimeSlashCommand) {
      await store.refreshSessionCommandsFor(sessionRef);
    }
    return store.refreshState({
      clearLastError: true,
    });
  } catch (error) {
    if (textInput) {
      store.sessionState.composerDraftsBySession.set(key, textInput);
    }
    if (attachments.length > 0) {
      store.sessionState.composerAttachmentsBySession.set(key, cloneComposerImageAttachments(attachments));
      await store.persistComposerAttachments(key, attachments);
    }
    return store.withError(error);
  }
}

export async function setSessionModel(
  store: AppStoreInternals,
  target: WorkspaceSessionTarget,
  provider: string,
  modelId: string,
): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = toSessionRef(target);
  const key = sessionKey(sessionRef);

  return store.withErrorHandling(async () => {
    await store.driver.setSessionModel(sessionRef, { provider, modelId });
    return finishComposerCommand(store, sessionRef, key, `Model set to ${provider}:${modelId}`);
  });
}

export async function setSessionThinkingLevel(
  store: AppStoreInternals,
  sessionRef: SessionRef,
  thinkingLevel: string,
): Promise<DesktopAppState> {
  await store.initialize();
  const key = sessionKey(sessionRef);
  return store.withErrorHandling(async () => {
    await store.driver.setSessionThinkingLevel(sessionRef, thinkingLevel);
    return finishComposerCommand(store, sessionRef, key, `Thinking set to ${thinkingLevel}`);
  });
}

export async function cancelCurrentRun(store: AppStoreInternals): Promise<DesktopAppState> {
  await store.initialize();
  const sessionRef = store.selectedSessionRef();
  if (!sessionRef) {
    return store.emit();
  }

  return store.withErrorHandling(async () => {
    await store.driver.cancelCurrentRun(sessionRef);
    clearActiveAssistantMessage(store.sessionState.activeAssistantMessageBySession, sessionRef);
    store.sessionState.sessionErrorsBySession.delete(sessionKey(sessionRef));
    store.state = {
      ...store.state,
      lastError: undefined,
      revision: store.state.revision + 1,
    };
    store.schedulePersistUiState();
    return store.emit();
  });
}

/* ── Internal helpers ───────────────────────────────────── */

export async function sendMessageToSession(
  store: AppStoreInternals,
  sessionRef: SessionRef,
  text: string,
  attachments: readonly ComposerImageAttachment[],
): Promise<void> {
  const key = sessionKey(sessionRef);
  if (!store.sessionState.loadedTranscriptKeys.has(key)) {
    await store.ensureSessionReady(sessionRef);
  }
  if (store.sessionFromState(sessionRef)?.archivedAt) {
    await store.driver.unarchiveSession(sessionRef);
  }
  appendUserMessage(
    store.sessionState.transcriptCache,
    sessionRef,
    text,
    toTranscriptAttachments(attachments),
  );
  store.persistTranscriptCacheForSession(sessionRef);
  clearActiveAssistantMessage(store.sessionState.activeAssistantMessageBySession, sessionRef);
  store.sessionState.sessionErrorsBySession.delete(key);
  store.sessionState.composerDraftsBySession.delete(key);
  store.sessionState.composerAttachmentsBySession.delete(key);
  // Clear state.composerDraft immediately so that any events emitted during
  // sendUserMessage don't push the stale draft text to the renderer.
  if (
    store.state.selectedWorkspaceId === sessionRef.workspaceId &&
    store.state.selectedSessionId === sessionRef.sessionId
  ) {
    store.state = { ...store.state, composerDraft: "" };
  }
  await store.persistComposerAttachments(key, []);
  try {
    await store.driver.sendUserMessage(sessionRef, {
      text,
      attachments: toSessionAttachments(attachments),
    });
  } catch (error) {
    const transcript = store.sessionState.transcriptCache.get(key) ?? [];
    store.sessionState.transcriptCache.set(key, transcript.slice(0, -1));
    store.persistTranscriptCacheForSession(sessionRef);
    throw error;
  }
}

async function runComposerCommand(
  store: AppStoreInternals,
  sessionRef: SessionRef,
  commandText: string,
): Promise<DesktopAppState | undefined> {
  const parsed = parseComposerCommand(commandText);
  if (!parsed) {
    const message = incompleteComposerCommandMessage(commandText);
    if (message) {
      return store.withError(message);
    }
    return undefined;
  }

  const key = sessionKey(sessionRef);

  if (parsed.type === "model") {
    await store.driver.setSessionModel(sessionRef, {
      provider: parsed.provider,
      modelId: parsed.modelId,
    });
    return finishComposerCommand(store, sessionRef, key, `Model set to ${parsed.provider}:${parsed.modelId}`);
  }

  if (parsed.type === "thinking") {
    await store.driver.setSessionThinkingLevel(sessionRef, parsed.thinkingLevel);
    return finishComposerCommand(store, sessionRef, key, `Thinking set to ${parsed.thinkingLevel}`);
  }

  if (parsed.type === "status") {
    return finishComposerCommand(
      store,
      sessionRef,
      key,
      formatSessionConfigStatus(store.sessionState.sessionConfigBySession.get(key)),
    );
  }

  if (parsed.type === "session") {
    const workspace = store.state.workspaces.find((entry) => entry.id === sessionRef.workspaceId);
    const session = workspace?.sessions.find((entry) => entry.id === sessionRef.sessionId);
    const parts = [
      `Session ${session?.title ?? sessionRef.sessionId}`,
      `ID ${sessionRef.sessionId}`,
      workspace ? `Workspace ${workspace.name}` : undefined,
      session ? `Status ${session.status}` : undefined,
    ].filter(Boolean);
    return finishComposerCommand(store, sessionRef, key, parts.join(" · "));
  }

  if (parsed.type === "name") {
    await store.driver.renameSession(sessionRef, parsed.title);
    return finishComposerCommand(store, sessionRef, key, `Session renamed to ${parsed.title}`);
  }

  if (parsed.type === "compact") {
    await store.driver.compactSession(sessionRef, parsed.customInstructions);
    await store.reloadTranscriptFromDriver(sessionRef);
    return finishComposerCommand(store, sessionRef, key, "Compacted session context");
  }

  if (parsed.type === "reload") {
    store.clearExtensionUiForSession(sessionRef);
    await store.driver.reloadSession(sessionRef);
    await store.refreshSessionCommandsFor(sessionRef);
    return finishComposerCommand(store, sessionRef, key, "Reloaded session resources");
  }

  if (parsed.type === "new") {
    store.sessionState.composerDraftsBySession.delete(key);
    store.state = {
      ...store.state,
      activeView: "new-thread",
      composerDraft: "",
      lastError: undefined,
      revision: store.state.revision + 1,
    };
    store.schedulePersistUiState();
    return store.emit();
  }

  if (parsed.type === "resume") {
    store.sessionState.composerDraftsBySession.delete(key);
    store.state = {
      ...store.state,
      activeView: "threads",
      composerDraft: "",
      lastError: undefined,
      revision: store.state.revision + 1,
    };
    store.schedulePersistUiState();
    return store.emit();
  }

  if (parsed.type === "copy") {
    const transcript = store.sessionState.transcriptCache.get(key) ?? [];
    const lastAssistant = [...transcript]
      .reverse()
      .find((m): m is TranscriptMessage & { kind: "message"; role: "assistant" } =>
        m.kind === "message" && "role" in m && m.role === "assistant",
      );
    if (lastAssistant) {
      clipboard.writeText(lastAssistant.text);
      return finishComposerCommand(store, sessionRef, key, "Copied last assistant message to clipboard");
    }
    return finishComposerCommand(store, sessionRef, key, "No assistant message to copy");
  }

  if (parsed.type === "export") {
    const transcript = store.sessionState.transcriptCache.get(key) ?? [];
    const workspace = store.state.workspaces.find((entry) => entry.id === sessionRef.workspaceId);
    const session = workspace?.sessions.find((entry) => entry.id === sessionRef.sessionId);
    const title = session?.title ?? sessionRef.sessionId;
    const html = buildExportHtml(transcript, title);
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      const defaultName = sanitizeFileName(title);
      const result = await dialog.showSaveDialog(win, {
        defaultPath: parsed.filePath ?? `${defaultName}.html`,
        filters: [{ name: "HTML Files", extensions: ["html"] }],
      });
      if (!result.canceled && result.filePath) {
        await writeFile(result.filePath, html, "utf-8");
        return finishComposerCommand(store, sessionRef, key, `Session exported to ${result.filePath}`);
      }
    }
    return finishComposerCommand(store, sessionRef, key, "Export cancelled");
  }

  if (parsed.type === "share") {
    const transcript = store.sessionState.transcriptCache.get(key) ?? [];
    const workspace = store.state.workspaces.find((entry) => entry.id === sessionRef.workspaceId);
    const session = workspace?.sessions.find((entry) => entry.id === sessionRef.sessionId);
    const title = session?.title ?? sessionRef.sessionId;
    const md = buildShareableMarkdown(transcript, title);
    clipboard.writeText(md);
    return finishComposerCommand(store, sessionRef, key, "Session transcript copied to clipboard as markdown");
  }

  if (parsed.type === "hotkeys") {
    const shortcuts = [
      "Ctrl+, — Settings",
      "Ctrl+Shift+O — New thread",
      "Ctrl+= — Zoom in",
      "Ctrl+- — Zoom out",
      "Ctrl+0 — Reset zoom",
      "Enter — Send message",
      "Shift+Enter — New line",
      "/ — Slash commands",
      "Escape — Cancel",
    ].join(" · ");
    return finishComposerCommand(store, sessionRef, key, `Keyboard shortcuts: ${shortcuts}`);
  }

  if (parsed.type === "changelog") {
    const version = app.getVersion();
    return finishComposerCommand(store, sessionRef, key, `pi desktop v${version}`);
  }

  if (parsed.type === "fork") {
    const workspace = store.state.workspaces.find((entry) => entry.id === sessionRef.workspaceId);
    const session = workspace?.sessions.find((entry) => entry.id === sessionRef.sessionId);
    if (!workspace) {
      return store.withError("No workspace found for fork");
    }
    const ws = store.workspaceRefFromState(workspace.id);
    if (!ws) {
      return store.withError("Workspace ref not found");
    }
    const forkedSnapshot = await store.driver.createSession(ws, {
      title: `Fork of ${session?.title ?? sessionRef.sessionId}`,
    });
    const forkedKey = sessionKey(forkedSnapshot.ref);
    store.sessionState.transcriptCache.set(forkedKey, []);
    store.sessionState.loadedTranscriptKeys.add(forkedKey);
    store.updateSessionConfig(forkedSnapshot.ref, forkedSnapshot.config);
    await store.ensureSessionSubscribed(forkedSnapshot.ref);
    return store.refreshState({
      selectedWorkspaceId: forkedSnapshot.ref.workspaceId,
      selectedSessionId: forkedSnapshot.ref.sessionId,
      composerDraft: "",
      clearLastError: true,
      activeView: "threads",
    });
  }

  if (parsed.type === "tree") {
    const workspace = store.state.workspaces.find((entry) => entry.id === sessionRef.workspaceId);
    const sessions = workspace?.sessions ?? [];
    const activeSessions = sessions.filter((s) => !s.archivedAt);
    const lines = activeSessions.map(
      (s) => `${s.id === sessionRef.sessionId ? "▸ " : "  "}${s.title ?? s.id} (${s.status})`,
    );
    return finishComposerCommand(
      store,
      sessionRef,
      key,
      `Sessions in ${workspace?.name ?? "workspace"}:\n${lines.join("\n") || "No sessions"}`,
    );
  }

  if (parsed.type === "quit") {
    try {
      await store.driver.cancelCurrentRun(sessionRef);
    } catch {
      /* session may not be running */
    }
    clearActiveAssistantMessage(store.sessionState.activeAssistantMessageBySession, sessionRef);
    store.sessionState.sessionErrorsBySession.delete(key);
    return finishComposerCommand(store, sessionRef, key, "Stopped current session");
  }

  if (parsed.type === "exit") {
    try {
      await store.driver.cancelCurrentRun(sessionRef);
    } catch {
      /* session may not be running */
    }
    app.quit();
    return store.emit();
  }

  return store.withError(`Unsupported slash command: ${commandText}`);
}

function appendLocalActivity(store: AppStoreInternals, sessionRef: SessionRef, label: string): void {
  const key = sessionKey(sessionRef);
  const transcript = [...(store.sessionState.transcriptCache.get(key) ?? [])];
  transcript.push(makeActivityItem(label));
  store.sessionState.transcriptCache.set(key, transcript);
  store.persistTranscriptCacheForSession(sessionRef);
}

function finishComposerCommand(
  store: AppStoreInternals,
  sessionRef: SessionRef,
  key: string,
  label: string,
): DesktopAppState {
  store.sessionState.composerDraftsBySession.delete(key);
  store.sessionState.composerAttachmentsBySession.delete(key);
  appendLocalActivity(store, sessionRef, label);
  const transcript = (store.sessionState.transcriptCache.get(key) ?? []).map(cloneTranscriptMessage);
  const preview = previewFromTranscript(transcript);
  store.state = {
    ...store.state,
    workspaces: store.state.workspaces.map((workspace) =>
      workspace.id === sessionRef.workspaceId
        ? {
            ...workspace,
            sessions: workspace.sessions.map((session) =>
              session.id === sessionRef.sessionId
                ? {
                    ...session,
                    preview: preview ?? session.preview,
                    config: store.sessionState.sessionConfigBySession.get(key),
                    transcript,
                  }
                : session,
            ),
          }
        : workspace,
    ),
    composerDraft: "",
    composerAttachments: [],
    lastError: undefined,
    revision: store.state.revision + 1,
  };
  store.schedulePersistUiState();
  return store.emit();
}

/* ── Export / share helpers ──────────────────────────────── */

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, "_").replace(/\s+/g, "-").slice(0, 100) || "session";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildExportHtml(transcript: readonly TranscriptMessage[], title: string): string {
  const messages = transcript
    .filter((m): m is TranscriptMessage & { kind: "message" } => m.kind === "message")
    .map((m) => {
      const role = "role" in m ? (m.role as string) : "system";
      const text = "text" in m ? escapeHtml(m.text as string) : "";
      const roleLabel = role === "user" ? "You" : "Assistant";
      const bgColor = role === "user" ? "#f0f0f0" : "#ffffff";
      return `<div style="padding:12px 16px;margin:8px 0;border-radius:8px;background:${bgColor}"><strong>${roleLabel}</strong><pre style="white-space:pre-wrap;margin:8px 0 0 0;font-family:inherit">${text}</pre></div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:800px;margin:0 auto;padding:24px;color:#1a1a1a}h1{font-size:1.4em;border-bottom:1px solid #eee;padding-bottom:8px}pre{font-size:0.95em}</style>
</head>
<body><h1>${escapeHtml(title)}</h1>${messages}</body></html>`;
}

function buildShareableMarkdown(transcript: readonly TranscriptMessage[], title: string): string {
  const lines = [`# ${title}`, ""];
  for (const m of transcript) {
    if (m.kind === "message" && "role" in m && "text" in m) {
      const role = m.role === "user" ? "**You**" : "**Assistant**";
      lines.push(role, "", m.text as string, "", "---", "");
    }
  }
  return lines.join("\n");
}
