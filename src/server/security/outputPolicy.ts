const MAX_OUTPUT_CHARS = 20_000;

const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9]{36}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
];

export function sanitizeOutputChunk(input: string): string {
  let output = input;
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}

export function truncateIfNeeded(input: string): { value: string; truncated: boolean } {
  if (input.length <= MAX_OUTPUT_CHARS) {
    return { value: input, truncated: false };
  }

  return {
    value:
      input.slice(0, MAX_OUTPUT_CHARS) +
      "\n\n[Output truncated by policy: maximum size exceeded.]",
    truncated: true,
  };
}
