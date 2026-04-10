import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let cachedToken: string | null = null;

async function readTokenFromGhCli(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], {
      env: process.env,
      maxBuffer: 1024 * 1024,
    });
    const token = stdout.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export async function getGitHubApiToken(): Promise<string> {
  if (cachedToken) {
    return cachedToken;
  }

  const envToken =
    process.env.GITHUB_API_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.COPILOT_GITHUB_TOKEN;

  if (envToken && envToken.trim().length > 0) {
    cachedToken = envToken.trim();
    return cachedToken;
  }

  const ghToken = await readTokenFromGhCli();
  if (ghToken) {
    cachedToken = ghToken;
    return ghToken;
  }

  throw new Error(
    "GitHub API authentication missing. Set GITHUB_API_TOKEN (recommended), or run 'gh auth login'."
  );
}
