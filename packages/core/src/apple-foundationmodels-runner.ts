/**
 * Apple Foundation Models runner bootstrap.
 *
 * Apple's on-device Foundation Models framework is exposed through the
 * Swift standard library — no first-party CLI exists. We bridge by
 * compiling a tiny Swift runner once per host and caching the binary
 * under `~/.sua/runners/apple_foundationmodels`. The runner reads
 * `PROMPT` and `SYSTEM_PROMPT` from its environment, calls
 * `SystemLanguageModel.default` via `LanguageModelSession`, and prints
 * a single line of JSON describing the outcome:
 *
 *   { "status": "ok" | "unavailable" | "unsupported" | "error",
 *     "response_text": "...",
 *     "model_name": "apple-foundationmodels",
 *     "error_message": null | "..." }
 *
 * The Swift source embedded here mirrors the user-agent demo at
 * `data/agent-state/apple-foundationmodels-prompt/apple_foundationmodels_prompt.swift`,
 * with a `--version` branch added so `detectLlms()` can probe install
 * status without spinning up a model session.
 *
 * Compilation requires `xcrun` (Apple Command Line Tools). On non-macOS
 * hosts or hosts without `xcrun` we return `status: 'unsupported'` and
 * the provider chain falls through to the next available provider.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chmod600Safe, ensureDir, ensureParentDir } from './fs-utils.js';

const APPLE_RUNNER_VERSION_STRING = 'apple-foundationmodels-runner 1.0.0';

/**
 * Swift source for the on-device runner. Compiled once and cached at
 * `~/.sua/runners/apple_foundationmodels` (binary) with a sidecar
 * `apple_foundationmodels.source-hash` file recording the SHA-256 of
 * this string. If the source ever changes, `ensureAppleRunner` detects
 * the hash mismatch and recompiles.
 */
export const APPLE_RUNNER_SWIFT_SOURCE = `import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

struct Output: Codable {
    let status: String
    let response_text: String
    let model_name: String
    let error_message: String?
}

func emit(_ output: Output) {
    let encoder = JSONEncoder()
    if let data = try? encoder.encode(output),
       let text = String(data: data, encoding: .utf8) {
        print(text)
    } else {
        print("{\\"status\\":\\"error\\",\\"response_text\\":\\"\\",\\"model_name\\":\\"apple-foundationmodels\\",\\"error_message\\":\\"Failed to encode output\\"}")
    }
}

@main
struct Runner {
    static func main() async {
        let args = CommandLine.arguments
        if args.contains("--version") {
            print("${APPLE_RUNNER_VERSION_STRING}")
            return
        }

        let env = ProcessInfo.processInfo.environment
        let prompt = (env["PROMPT"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let systemPrompt = (env["SYSTEM_PROMPT"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

        guard !prompt.isEmpty else {
            emit(Output(status: "error", response_text: "", model_name: "apple-foundationmodels", error_message: "PROMPT is required"))
            return
        }

        #if canImport(FoundationModels)
        if #available(macOS 26.0, iOS 26.0, *) {
            guard SystemLanguageModel.default.isAvailable else {
                emit(Output(status: "unavailable", response_text: "", model_name: "apple-foundationmodels", error_message: "Apple Foundation Models is not available on this device"))
                return
            }

            do {
                let session = systemPrompt.isEmpty
                    ? LanguageModelSession()
                    : LanguageModelSession(instructions: systemPrompt)
                let response = try await session.respond(to: prompt)
                emit(Output(status: "ok", response_text: String(describing: response.content), model_name: "apple-foundationmodels", error_message: nil))
            } catch {
                emit(Output(status: "error", response_text: "", model_name: "apple-foundationmodels", error_message: String(describing: error)))
            }
        } else {
            emit(Output(status: "unsupported", response_text: "", model_name: "apple-foundationmodels", error_message: "Requires Apple OS with Foundation Models support"))
        }
        #else
        emit(Output(status: "unsupported", response_text: "", model_name: "apple-foundationmodels", error_message: "FoundationModels framework is not available in this Swift toolchain"))
        #endif
    }
}
`;

export interface AppleRunnerHandle {
  /** Absolute path to the compiled binary. Only meaningful when status === 'ready'. */
  binaryPath: string;
  status: 'ready' | 'compile-failed' | 'unsupported';
  /** Human-readable message when status !== 'ready'. */
  message?: string;
}

/**
 * Where the compiled binary lives. Override via `SUA_APPLE_RUNNERS_DIR`
 * for tests; production callers should leave it unset so the path stays
 * stable across invocations on a host.
 */
export function appleRunnersDir(): string {
  return process.env.SUA_APPLE_RUNNERS_DIR ?? join(homedir(), '.sua', 'runners');
}

export function appleRunnerBinaryPath(): string {
  return join(appleRunnersDir(), 'apple_foundationmodels');
}

function appleRunnerSourceHashPath(): string {
  return join(appleRunnersDir(), 'apple_foundationmodels.source-hash');
}

function hashSource(): string {
  return createHash('sha256').update(APPLE_RUNNER_SWIFT_SOURCE).digest('hex');
}

/**
 * Ensure the runner is compiled and cached. Idempotent:
 *   1. If the cached binary exists AND its sidecar hash matches the
 *      current source hash, return immediately (`status: 'ready'`).
 *   2. Otherwise, write the source, compile via `xcrun swiftc
 *      -parse-as-library`, and write the sidecar.
 *   3. On non-macOS hosts (or hosts where `xcrun` isn't on PATH) return
 *      `status: 'unsupported'` without raising — the provider waterfall
 *      treats this as `binary_missing` and falls through.
 *
 * Test note: callers can stub `process.platform` / `SUA_APPLE_RUNNERS_DIR`
 * to exercise the non-macOS branches without an Xcode install.
 */
export function ensureAppleRunner(): AppleRunnerHandle {
  const binaryPath = appleRunnerBinaryPath();

  if (process.platform !== 'darwin') {
    return {
      binaryPath,
      status: 'unsupported',
      message: 'Apple Foundation Models is macOS-only.',
    };
  }

  // xcrun is required to compile. If it's not on PATH, the host doesn't
  // have Xcode CLI tools installed and we can't build the runner.
  try {
    execFileSync('xcrun', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return {
      binaryPath,
      status: 'unsupported',
      message: 'xcrun not found. Install Apple Command Line Tools (`xcode-select --install`).',
    };
  }

  const dir = appleRunnersDir();
  ensureDir(dir);
  const sourcePath = join(dir, 'apple_foundationmodels.swift');
  const hashPath = appleRunnerSourceHashPath();
  const currentHash = hashSource();

  // Cache hit: binary present, sidecar hash matches, source hasn't drifted.
  if (existsSync(binaryPath) && existsSync(hashPath)) {
    try {
      const cachedHash = readFileSync(hashPath, 'utf-8').trim();
      if (cachedHash === currentHash) {
        // Sanity check: binary mtime is at or after the hash file.
        const binStat = statSync(binaryPath);
        const hashStat = statSync(hashPath);
        if (binStat.mtimeMs >= hashStat.mtimeMs - 5_000) {
          return { binaryPath, status: 'ready' };
        }
      }
    } catch {
      // Fall through to recompile.
    }
  }

  // (Re)compile.
  ensureParentDir(sourcePath);
  writeFileSync(sourcePath, APPLE_RUNNER_SWIFT_SOURCE, 'utf-8');
  chmod600Safe(sourcePath);

  const compile = spawnSync('xcrun', ['swiftc', '-parse-as-library', sourcePath, '-o', binaryPath], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (compile.status !== 0) {
    const stderr = (compile.stderr ?? '').trim() || (compile.stdout ?? '').trim();
    return {
      binaryPath,
      status: 'compile-failed',
      message: stderr || `xcrun swiftc exited with code ${compile.status}`,
    };
  }

  writeFileSync(hashPath, currentHash, 'utf-8');
  chmod600Safe(hashPath);
  return { binaryPath, status: 'ready' };
}

/**
 * Stable identifier string the runner prints under `--version`. The
 * provider `detectLlms()` probe runs `apple_foundationmodels --version`
 * and compares the trimmed stdout against this value to confirm the
 * binary on disk matches what we expect (vs. a stale/foreign binary
 * sitting at the same path).
 */
export function appleRunnerVersionString(): string {
  return APPLE_RUNNER_VERSION_STRING;
}
