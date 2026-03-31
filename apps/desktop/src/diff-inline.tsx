import { useCallback, useMemo, useRef } from "react";

interface DiffLine {
  readonly type: "added" | "removed" | "context" | "header";
  readonly content: string;
  readonly lineNumber?: number;
}

/** Unified inline diff (used in timeline tool-call bodies). */
export function InlineDiff({ diff }: { readonly diff: string }) {
  const lines = useMemo(() => parseDiff(diff), [diff]);
  if (lines.length === 0) {
    return null;
  }

  return (
    <pre className="diff-inline">
      {lines.map((line, index) => (
        <div className={`diff-line diff-line--${line.type}`} key={index}>
          {line.lineNumber !== undefined ? (
            <span className="diff-line__number">{line.lineNumber}</span>
          ) : (
            <span className="diff-line__number" />
          )}
          <span className="diff-line__content">{line.content}</span>
        </div>
      ))}
    </pre>
  );
}

/* ─── Side-by-side diff ─── */

interface SideBySideRow {
  readonly leftLineNo: number | null;
  readonly leftContent: string;
  readonly leftType: "removed" | "context" | "header" | "empty";
  readonly rightLineNo: number | null;
  readonly rightContent: string;
  readonly rightType: "added" | "context" | "header" | "empty";
}

function buildSideBySideRows(diff: string): SideBySideRow[] {
  const raw = parseDiff(diff);
  const rows: SideBySideRow[] = [];
  let i = 0;

  while (i < raw.length) {
    const line = raw[i]!;

    if (line.type === "header") {
      rows.push({
        leftLineNo: null, leftContent: line.content, leftType: "header",
        rightLineNo: null, rightContent: line.content, rightType: "header",
      });
      i++;
      continue;
    }

    if (line.type === "context") {
      // Need to compute left line number from the header
      rows.push({
        leftLineNo: getLeftLineNo(raw, i),
        leftContent: line.content,
        leftType: "context",
        rightLineNo: line.lineNumber ?? null,
        rightContent: line.content,
        rightType: "context",
      });
      i++;
      continue;
    }

    // Collect consecutive removed/added blocks for pairing
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (i < raw.length && raw[i]!.type === "removed") {
      removed.push(raw[i]!);
      i++;
    }
    while (i < raw.length && raw[i]!.type === "added") {
      added.push(raw[i]!);
      i++;
    }

    const maxLen = Math.max(removed.length, added.length);
    for (let j = 0; j < maxLen; j++) {
      const rem = removed[j];
      const add = added[j];
      rows.push({
        leftLineNo: rem ? getLeftLineNo(raw, raw.indexOf(rem)) : null,
        leftContent: rem?.content ?? "",
        leftType: rem ? "removed" : "empty",
        rightLineNo: add?.lineNumber ?? null,
        rightContent: add?.content ?? "",
        rightType: add ? "added" : "empty",
      });
    }
  }

  return rows;
}

/** Walk backwards from index to compute left-side line numbers. */
function getLeftLineNo(lines: DiffLine[], index: number): number | null {
  // Find the nearest header before this index
  let headerLineNo = 1;
  let offset = 0;
  for (let i = 0; i <= index; i++) {
    const l = lines[i]!;
    if (l.type === "header") {
      const match = /^@@ -(\d+)/.exec(l.content);
      headerLineNo = match ? parseInt(match[1]!, 10) : 1;
      offset = 0;
    } else if (l.type === "removed" || l.type === "context") {
      if (i < index) offset++;
    }
  }
  return headerLineNo + offset;
}

/** Full side-by-side diff viewer for the full-screen diff panel. */
export function SideBySideDiff({ diff }: { readonly diff: string }) {
  const rows = useMemo(() => buildSideBySideRows(diff), [diff]);
  const leftRef = useRef<HTMLPreElement>(null);
  const rightRef = useRef<HTMLPreElement>(null);
  const syncing = useRef(false);

  const syncScroll = useCallback((source: "left" | "right") => {
    if (syncing.current) return;
    syncing.current = true;
    const from = source === "left" ? leftRef.current : rightRef.current;
    const to = source === "left" ? rightRef.current : leftRef.current;
    if (from && to) {
      to.scrollTop = from.scrollTop;
    }
    syncing.current = false;
  }, []);

  if (rows.length === 0) return null;

  return (
    <div className="sbs-diff">
      <div className="sbs-diff__col">
        <div className="sbs-diff__col-header">Before</div>
        <pre className="sbs-diff__code" ref={leftRef} onScroll={() => syncScroll("left")}>
          {rows.map((row, i) => (
            <div className={`sbs-diff__line sbs-diff__line--${row.leftType}`} key={i}>
              <span className="sbs-diff__linenum">{row.leftLineNo ?? ""}</span>
              <span className="sbs-diff__content">{row.leftContent}</span>
            </div>
          ))}
        </pre>
      </div>
      <div className="sbs-diff__col">
        <div className="sbs-diff__col-header">After</div>
        <pre className="sbs-diff__code" ref={rightRef} onScroll={() => syncScroll("right")}>
          {rows.map((row, i) => (
            <div className={`sbs-diff__line sbs-diff__line--${row.rightType}`} key={i}>
              <span className="sbs-diff__linenum">{row.rightLineNo ?? ""}</span>
              <span className="sbs-diff__content">{row.rightContent}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

function parseDiff(diff: string): DiffLine[] {
  const lines = diff.split("\n");
  const result: DiffLine[] = [];
  let lineNumber = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
      lineNumber = match ? parseInt(match[1] ?? "0", 10) : 0;
      result.push({ type: "header", content: line });
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++")) {
      continue;
    }
    if (line.startsWith("+")) {
      result.push({ type: "added", content: line.slice(1), lineNumber });
      lineNumber += 1;
    } else if (line.startsWith("-")) {
      result.push({ type: "removed", content: line.slice(1) });
    } else if (line.startsWith(" ") || line === "") {
      result.push({ type: "context", content: line.slice(1), lineNumber });
      lineNumber += 1;
    }
  }

  return result;
}

export function extractDiffFromOutput(output: unknown): string | undefined {
  if (typeof output === "string" && (output.includes("@@") || output.startsWith("diff "))) {
    return output;
  }
  if (isObj(output)) {
    if (typeof output.diff === "string") {
      return output.diff;
    }
    if (isObj(output.details) && typeof output.details.diff === "string") {
      return output.details.diff;
    }
    if (Array.isArray(output.content)) {
      for (const part of output.content) {
        if (isObj(part) && part.type === "text" && typeof part.text === "string") {
          if (part.text.includes("@@") || part.text.startsWith("diff ")) {
            return part.text;
          }
        }
      }
    }
  }
  return undefined;
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
