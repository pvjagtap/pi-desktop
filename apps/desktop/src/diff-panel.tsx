import { useEffect } from "react";
import { CloseIcon, RefreshIcon } from "./icons";
import { SideBySideDiff } from "./diff-inline";

interface DiffPanelProps {
  readonly selectedFile: string | null;
  readonly diffText: string;
  readonly hasGit: boolean;
  readonly loading: boolean;
  readonly hasFiles: boolean;
  readonly onRefresh: () => void;
  readonly onStage: (filePath: string) => void;
  readonly onDiscard: (filePath: string) => void;
  readonly onClose: () => void;
}

export function DiffPanel({
  selectedFile,
  diffText,
  hasGit,
  loading,
  hasFiles,
  onRefresh,
  onStage,
  onDiscard,
  onClose,
}: DiffPanelProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="diff-fullscreen">
      <div className="diff-fullscreen__main">
        {selectedFile && diffText ? (
          <>
            <div className="diff-fullscreen__file-header">
              <span className="diff-fullscreen__file-header-name">{selectedFile}</span>
              <div className="diff-fullscreen__actions">
                {hasGit ? (
                  <>
                    <button
                      className="diff-action diff-action--accept"
                      type="button"
                      onClick={() => onStage(selectedFile)}
                      title="Accept (stage) this file"
                    >
                      ✓ Accept
                    </button>
                    <button
                      className="diff-action diff-action--reject"
                      type="button"
                      onClick={() => onDiscard(selectedFile)}
                      title="Reject (discard) changes"
                    >
                      ✗ Reject
                    </button>
                  </>
                ) : null}
                <button
                  className="icon-button"
                  type="button"
                  onClick={onRefresh}
                  aria-label="Refresh"
                  disabled={loading}
                >
                  <RefreshIcon />
                </button>
                <button
                  className="icon-button diff-fullscreen__close"
                  type="button"
                  onClick={onClose}
                  aria-label="Close diff (Esc)"
                  title="Close (Esc)"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>
            <SideBySideDiff diff={diffText} />
          </>
        ) : (
          <div className="diff-fullscreen__placeholder">
            <button
              className="icon-button diff-fullscreen__close"
              type="button"
              onClick={onClose}
              aria-label="Close diff (Esc)"
              title="Close (Esc)"
            >
              <CloseIcon />
            </button>
            {hasFiles
              ? "Select a file from the changed files bar to view the diff"
              : !hasGit
                ? "No git repository — edits will appear as the session runs"
                : "No changes to display"}
          </div>
        )}
      </div>
    </div>
  );
}
