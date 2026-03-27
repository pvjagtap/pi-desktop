import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PiDesktopApi } from "./ipc";
import type { TranscriptMessage } from "./desktop-state";
import { InlineDiff } from "./diff-inline";
import { RefreshIcon } from "./icons";

interface ChangedFile {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
}

/** Tool names that indicate a file write/edit operation. */
const FILE_MUTATION_TOOLS = /^(write|edit|edit-diff|create|multiEdit|multi_edit|patch)$/i;

function extractEditedFiles(transcript: readonly TranscriptMessage[]): readonly ChangedFile[] {
  const seen = new Set<string>();
  const result: ChangedFile[] = [];
  for (const msg of transcript) {
    if (msg.kind !== "tool" || msg.status === "running") continue;
    if (!FILE_MUTATION_TOOLS.test(msg.toolName)) continue;
    const input = msg.input as Record<string, unknown> | undefined;
    const filePath =
      typeof input?.path === "string" ? input.path :
      typeof input?.filePath === "string" ? input.filePath :
      typeof input?.file_path === "string" ? input.file_path :
      undefined;
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    result.push({ path: filePath, status: msg.status === "error" ? "modified" : "modified" });
  }
  return result;
}

interface DiffPanelProps {
  readonly workspaceId: string;
  readonly api: PiDesktopApi;
  readonly sessionStatus: string | undefined;
  readonly transcript: readonly TranscriptMessage[];
}

export function DiffPanel({ workspaceId, api, sessionStatus, transcript }: DiffPanelProps) {
  const [gitFiles, setGitFiles] = useState<readonly ChangedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffText, setDiffText] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasGit, setHasGit] = useState(true);

  // Derive edited files from session transcript (always available, even without git)
  const sessionFiles = useMemo(() => extractEditedFiles(transcript), [transcript]);

  // Only show session-derived files, enriched with git status when available.
  // Git-only changes (pre-existing uncommitted work) are NOT shown — the Changes
  // panel reflects what THIS session touched, not the full repo state.
  const files = useMemo(() => {
    if (gitFiles.length === 0) return sessionFiles;
    const gitByPath = new Map(gitFiles.map((gf) => [gf.path, gf]));
    return sessionFiles.map((sf) => gitByPath.get(sf.path) ?? sf);
  }, [sessionFiles, gitFiles]);

  const refresh = useCallback(() => {
    setLoading(true);
    void api.getChangedFiles(workspaceId).then((result) => {
      setGitFiles(result);
      setHasGit(true);
      setSelectedFile((current) => {
        if (current && !sessionFiles.some((f) => f.path === current)) {
          return null;
        }
        return current;
      });
      setLoading(false);
    }).catch(() => {
      setHasGit(false);
      setLoading(false);
    });
  }, [api, workspaceId, sessionFiles]);

  // Auto-refresh on mount and when session transitions from running to idle/failed
  const prevStatusRef = useRef(sessionStatus);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = sessionStatus;
    if (prev === "running" && sessionStatus !== "running") {
      refresh();
    }
  }, [sessionStatus, refresh]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [workspaceId, refresh]);

  // Fetch diff when file selected
  useEffect(() => {
    if (!selectedFile) {
      setDiffText("");
      return;
    }
    void api.getFileDiff(workspaceId, selectedFile).then(setDiffText).catch(() => setDiffText(""));
  }, [api, workspaceId, selectedFile]);

  const handleStage = (filePath: string) => {
    void api.stageFile(workspaceId, filePath).then(refresh);
  };

  return (
    <aside className="diff-panel">
      <div className="diff-panel__header">
        <h2 className="diff-panel__title">Changes</h2>
        <button
          className="icon-button"
          type="button"
          onClick={refresh}
          aria-label="Refresh"
          disabled={loading}
        >
          <RefreshIcon />
        </button>
      </div>

      {files.length === 0 ? (
        <div className="diff-panel__empty">
          {!hasGit ? "No git repository — edits will appear as the session runs" : "No changes"}
        </div>
      ) : (
        <>
          <div className="diff-panel__file-list">
            {files.map((file) => (
              <div
                className={`diff-panel__file ${selectedFile === file.path ? "diff-panel__file--selected" : ""}`}
                key={file.path}
              >
                <button
                  className="diff-panel__file-name"
                  type="button"
                  onClick={() => setSelectedFile(file.path === selectedFile ? null : file.path)}
                >
                  <span className={`diff-panel__status-dot diff-panel__status-dot--${file.status}`} />
                  <span>{file.path}</span>
                </button>
                {hasGit ? (
                  <button
                    className="diff-panel__stage-btn"
                    type="button"
                    onClick={() => handleStage(file.path)}
                  >
                    Stage
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          {selectedFile && diffText ? (
            <div className="diff-panel__viewer">
              <div className="diff-panel__viewer-header">{selectedFile}</div>
              <InlineDiff diff={diffText} />
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}
