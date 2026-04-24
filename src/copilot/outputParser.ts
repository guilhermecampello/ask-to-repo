// Matches ANSI escape sequences (colors, cursor movement, etc.)
const ANSI_RE = /\x1b\[[0-9;]*[mGKHFJA-Za-z]/g;

export type SegmentKind = "text" | "tool";

export type ParsedSegment = { kind: SegmentKind; content: string };

export type ParserLogger = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
};

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

// Patterns that identify a line as tool-call output (tested on ANSI-stripped text).
// Matched against the actual Copilot CLI format:
//   ● ToolName args          <- tool call header (success)
//   ✗ ToolName args          <- tool call header (failure)
//   │ content line           <- tool input/param line
//   └ result summary line    <- tool result line
export const TOOL_LINE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /^\s*[●✗]\s+\S/, label: "tool-header" },
  { re: /^\s*[│└]\s/, label: "tool-content" },
];

function matchedToolPattern(clean: string): string | null {
  for (const { re, label } of TOOL_LINE_PATTERNS) {
    if (re.test(clean)) return label;
  }
  return null;
}

/**
 * Stateful streaming parser that classifies Copilot CLI output into
 * model text ("text") vs tool-call activity ("tool") segments.
 *
 * Feed raw chunks via push(). Call flush() when the stream ends to
 * emit any remaining buffered content.
 * Pass a logger to get per-line debug traces for pattern tuning.
 */
export class OutputStreamParser {
  private lineBuffer = "";
  private toolAccum = "";
  private lineIndex = 0;
  private readonly log: ParserLogger | null;

  constructor(logger?: ParserLogger) {
    this.log = logger ?? null;
  }

  private classifyLine(raw: string, isPartial: boolean): SegmentKind {
    const clean = stripAnsi(raw);
    const match = matchedToolPattern(clean);
    this.log?.debug(
      {
        lineIndex: this.lineIndex++,
        isPartial,
        kind: match ? "tool" : "text",
        matchedPattern: match ?? "none",
        hasAnsi: raw !== clean,
        rawLen: raw.length,
        preview: clean.slice(0, 120),
      },
      "parser:line"
    );
    return match ? "tool" : "text";
  }

  push(raw: string): ParsedSegment[] {
    const out: ParsedSegment[] = [];
    this.lineBuffer += raw;

    // Process complete (newline-terminated) lines
    let nl: number;
    while ((nl = this.lineBuffer.indexOf("\n")) !== -1) {
      const line = this.lineBuffer.slice(0, nl + 1);
      this.lineBuffer = this.lineBuffer.slice(nl + 1);
      const clean = stripAnsi(line);
      const kind = this.classifyLine(line, false);

      if (kind === "tool") {
        this.toolAccum += clean;
      } else {
        if (this.toolAccum) {
          this.log?.debug({ toolAccumLen: this.toolAccum.length }, "parser:flush-tool-block");
          out.push({ kind: "tool", content: this.toolAccum });
          this.toolAccum = "";
        }
        if (clean) out.push({ kind: "text", content: clean });
      }
    }

    // Partial line (no trailing newline yet)
    if (this.lineBuffer) {
      const partial = this.lineBuffer;
      this.lineBuffer = "";
      const kind = this.classifyLine(partial, true);

      if (kind === "tool") {
        this.toolAccum += stripAnsi(partial);
      } else {
        if (this.toolAccum) {
          this.log?.debug({ toolAccumLen: this.toolAccum.length }, "parser:flush-tool-block");
          out.push({ kind: "tool", content: this.toolAccum });
          this.toolAccum = "";
        }
        const clean = stripAnsi(partial);
        if (clean) out.push({ kind: "text", content: clean });
      }
    }

    return out;
  }

  /** Flush remaining buffered content at end of stream. */
  flush(): ParsedSegment[] {
    const out: ParsedSegment[] = [];
    const remaining = this.toolAccum + stripAnsi(this.lineBuffer);
    if (remaining) {
      const kind: SegmentKind = this.toolAccum ? "tool" : "text";
      this.log?.debug({ kind, remainingLen: remaining.length }, "parser:flush-final");
      out.push({ kind, content: remaining });
    }
    this.lineBuffer = "";
    this.toolAccum = "";
    return out;
  }
}
