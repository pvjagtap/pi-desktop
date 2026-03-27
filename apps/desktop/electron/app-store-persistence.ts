import type { AppView, NotificationPreferences, PromptTemplate } from "../src/desktop-state";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export interface PersistedUiState {
  readonly version?: 2 | 3 | 4;
  readonly selectedWorkspaceId?: string;
  readonly selectedSessionId?: string;
  readonly activeView?: AppView;
  readonly composerDraft?: string;
  readonly composerDraftsBySession?: Record<string, string>;
  readonly notificationPreferences?: NotificationPreferences;
  readonly lastViewedAtBySession?: Record<string, string>;
  readonly promptTemplates?: readonly PromptTemplate[];
}

export interface LegacyPersistedUiState extends PersistedUiState {
  readonly composerAttachmentsBySession?: Record<string, readonly unknown[]>;
  readonly transcripts?: Record<string, readonly unknown[]>;
}

export async function readPersistedUiState(uiStateFilePath: string): Promise<LegacyPersistedUiState> {
  let raw: string;
  try {
    raw = await readFile(uiStateFilePath, "utf8");
  } catch {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as LegacyPersistedUiState;
    return {
      version: parsed.version === 4 ? 4 : parsed.version === 3 ? 3 : parsed.version === 2 ? 2 : undefined,
      selectedWorkspaceId: parsed.selectedWorkspaceId,
      selectedSessionId: parsed.selectedSessionId,
      activeView: parsed.activeView,
      composerDraft: parsed.composerDraft ?? "",
      composerDraftsBySession: parsed.composerDraftsBySession,
      notificationPreferences: parsed.notificationPreferences,
      lastViewedAtBySession: parsed.lastViewedAtBySession,
      promptTemplates: Array.isArray(parsed.promptTemplates) ? parsed.promptTemplates : undefined,
      composerAttachmentsBySession: parsed.composerAttachmentsBySession,
      transcripts: parsed.transcripts,
    };
  } catch {
    // JSON is corrupted — back it up and start fresh
    try {
      await rename(uiStateFilePath, `${uiStateFilePath}.corrupted`);
    } catch { /* best effort backup */ }
    return {};
  }
}

export async function writePersistedUiState(
  uiStateFilePath: string,
  payload: PersistedUiState,
): Promise<void> {
  const tmpPath = `${uiStateFilePath}.tmp`;
  await mkdir(dirname(uiStateFilePath), { recursive: true });
  await writeFile(
    tmpPath,
    `${JSON.stringify(
      {
        version: 4,
        ...payload,
      } satisfies PersistedUiState,
      null,
      2,
    )}\n`,
    { encoding: "utf8", flush: true },
  );
  try {
    await rename(tmpPath, uiStateFilePath);
  } catch {
    // Fallback: write directly if atomic rename fails (e.g. first launch race).
    await writeFile(uiStateFilePath, await readFile(tmpPath, "utf8"), "utf8");
  }
}
