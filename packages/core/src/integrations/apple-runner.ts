/**
 * Apple Reminders / Notes runner bootstrap (macOS-only, experimental).
 *
 * Apple Reminders is reachable from Swift via EventKit; Apple Notes has no
 * first-party API, so we drive Notes.app through AppleScript (`NSAppleScript`)
 * from the same binary. We bridge by compiling a tiny Swift runner once per
 * host and caching it under `~/.sua/runners/apple_reminders` — exactly the
 * pattern used by `apple-foundationmodels-runner.ts`.
 *
 * Invocation contract (argv subcommand + JSON on stdin, one JSON line on
 * stdout):
 *
 *   sua-apple <subcommand>        # reads one JSON object from stdin
 *   sua-apple --version           # prints the version string for probing
 *   sua-apple --dry-run <sub>     # validate + echo, NO EventKit/AppleScript, NO TCC
 *
 * Every response is a single JSON line:
 *   { "status": "ok"|"denied"|"unsupported"|"error", "data": <any>, "error_message": null|string }
 *
 * Compilation requires `xcrun` (Apple Command Line Tools). Off macOS, or
 * without `xcrun`, `ensureAppleRunner` returns `status: 'unsupported'` and
 * callers surface a clear macOS-only error.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chmod600Safe, ensureDir, ensureParentDir } from '../fs-utils.js';
import { spawnProcess } from '../node-spawner.js';

const APPLE_RUNNER_VERSION_STRING = 'apple-runner 1.0.0';

/**
 * Swift source for the Reminders/Notes runner. Compiled once and cached at
 * `~/.sua/runners/apple_reminders`, with a sidecar `.source-hash` recording
 * the SHA-256 of this string so `ensureAppleRunner` recompiles on drift.
 * This source is validated by compiling it directly before embedding.
 */
export const APPLE_SWIFT_SOURCE = `import Foundation
import EventKit

let RUNNER_VERSION = "apple-runner 1.0.0"

// ── JSON I/O helpers ────────────────────────────────────────────────────

func emit(status: String, data: Any?, error: String?) {
    var obj: [String: Any] = ["status": status]
    obj["data"] = data ?? NSNull()
    obj["error_message"] = error ?? NSNull()
    if JSONSerialization.isValidJSONObject(obj),
       let d = try? JSONSerialization.data(withJSONObject: obj),
       let s = String(data: d, encoding: .utf8) {
        print(s)
    } else {
        print("{\\"status\\":\\"error\\",\\"data\\":null,\\"error_message\\":\\"failed to encode output\\"}")
    }
}

func jsonValue(_ v: Any?) -> Any { return v ?? NSNull() }
func emitOk(_ data: Any) { emit(status: "ok", data: data, error: nil) }
func emitError(_ msg: String) { emit(status: "error", data: nil, error: msg) }
func emitDenied(_ msg: String) { emit(status: "denied", data: nil, error: msg) }

func readStdinJSON() -> [String: Any] {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    if data.isEmpty { return [:] }
    if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        return obj
    }
    return [:]
}

let iso = ISO8601DateFormatter()
func parseDate(_ s: String?) -> Date? {
    guard let s = s, !s.isEmpty else { return nil }
    return iso.date(from: s)
}
func isoString(_ d: Date?) -> Any {
    guard let d = d else { return NSNull() }
    return iso.string(from: d)
}

// ── AppleScript helper (Notes has no first-party framework) ─────────────

func runAppleScript(_ src: String) -> (String?, String?) {
    // Wrap in \`with timeout\` so a blocked Apple event — e.g. driving Notes.app
    // from a process without a GUI session or Automation grant, which otherwise
    // hangs until the caller's 30s spawn timeout — fails fast with a clear error.
    let wrapped = "with timeout of 10 seconds\\n" + src + "\\nend timeout"
    guard let script = NSAppleScript(source: wrapped) else {
        return (nil, "could not compile AppleScript")
    }
    var errorDict: NSDictionary?
    let result = script.executeAndReturnError(&errorDict)
    if let err = errorDict {
        let num = (err["NSAppleScriptErrorNumber"] as? Int) ?? 0
        let msg = (err["NSAppleScriptErrorMessage"] as? String) ?? "AppleScript error"
        if num == -1712 {
            return (nil, "Notes did not respond (AppleEvent timed out after 10s). The worker likely lacks a GUI session — run it via \`sua worker install-launchagent\` and approve the macOS prompt.")
        }
        if num == -1743 {
            return (nil, "Automation access to Notes is denied. Grant it in System Settings > Privacy & Security > Automation, or run \`sua apple authorize\`.")
        }
        return (nil, "AppleScript error \\(num): \\(msg)")
    }
    return (result.stringValue ?? "", nil)
}

// AppleScript string-literal escaping: backslash and double-quote.
func asEscape(_ s: String) -> String {
    return s.replacingOccurrences(of: "\\\\", with: "\\\\\\\\")
            .replacingOccurrences(of: "\\"", with: "\\\\\\"")
}

// ── EventKit (Reminders) permission ─────────────────────────────────────

func requestReminderAccess(_ store: EKEventStore) async -> Bool {
    if #available(macOS 14.0, *) {
        return (try? await store.requestFullAccessToReminders()) ?? false
    } else {
        return await withCheckedContinuation { cont in
            store.requestAccess(to: .reminder) { granted, _ in cont.resume(returning: granted) }
        }
    }
}

func reminderCalendars(_ store: EKEventStore, named: String?) -> [EKCalendar] {
    let all = store.calendars(for: .reminder)
    if let named = named, !named.isEmpty {
        return all.filter { $0.title == named }
    }
    return all
}

func fetchReminders(_ store: EKEventStore, predicate: NSPredicate) async -> [EKReminder] {
    return await withCheckedContinuation { cont in
        store.fetchReminders(matching: predicate) { cont.resume(returning: $0 ?? []) }
    }
}

// ── Subcommand handlers ─────────────────────────────────────────────────

func cmdLists(dryRun: Bool) async {
    if dryRun { emitOk(["reminder_lists": [], "note_folders": []]); return }
    let store = EKEventStore()
    guard await requestReminderAccess(store) else {
        emitDenied("Reminders access denied. Grant it in System Settings > Privacy & Security > Reminders, or run: sua apple authorize")
        return
    }
    let lists = store.calendars(for: .reminder).map { ["id": $0.calendarIdentifier, "title": $0.title] }
    // Notes folders via AppleScript (best-effort; Automation permission bucket).
    var folders: [[String: String]] = []
    let (out, err) = runAppleScript("set text item delimiters to \\"\\\\n\\"\\ntell application \\"Notes\\" to get name of folders as text")
    if err == nil, let out = out {
        for line in out.split(separator: "\\n") {
            let name = String(line).trimmingCharacters(in: .whitespacesAndNewlines)
            if !name.isEmpty { folders.append(["id": name, "name": name]) }
        }
    }
    emitOk(["reminder_lists": lists, "note_folders": folders])
}

func cmdReminderCreate(_ input: [String: Any], dryRun: Bool) async {
    let title = (input["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !title.isEmpty else { emitError("title is required"); return }
    let notes = input["notes"] as? String
    let listName = input["list"] as? String
    let due = parseDate(input["dueDate"] as? String)
    if dryRun {
        emitOk(["id": NSNull(), "title": title, "list": jsonValue(listName), "dryRun": true])
        return
    }
    let store = EKEventStore()
    guard await requestReminderAccess(store) else {
        emitDenied("Reminders access denied. Run: sua apple authorize")
        return
    }
    let reminder = EKReminder(eventStore: store)
    reminder.title = title
    if let notes = notes { reminder.notes = notes }
    if let listName = listName, !listName.isEmpty {
        let matches = reminderCalendars(store, named: listName)
        guard let cal = matches.first else { emitError("No reminder list named \\"\\(listName)\\""); return }
        reminder.calendar = cal
    } else {
        guard let cal = store.defaultCalendarForNewReminders() else {
            emitError("No default reminder list available")
            return
        }
        reminder.calendar = cal
    }
    if let due = due {
        reminder.dueDateComponents = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute, .second], from: due)
    }
    do {
        try store.save(reminder, commit: true)
        emitOk(["id": reminder.calendarItemIdentifier, "title": reminder.title ?? title, "list": reminder.calendar.title])
    } catch {
        emitError("Failed to save reminder: \\(error.localizedDescription)")
    }
}

func cmdReminderRead(_ input: [String: Any], dryRun: Bool) async {
    let listName = input["list"] as? String
    let completedFilter = input["completed"] as? Bool
    let limit = (input["limit"] as? Int) ?? 100
    if dryRun { emitOk(["reminders": [], "count": 0, "dryRun": true]); return }
    let store = EKEventStore()
    guard await requestReminderAccess(store) else {
        emitDenied("Reminders access denied. Run: sua apple authorize")
        return
    }
    let cals = reminderCalendars(store, named: listName)
    if let listName = listName, !listName.isEmpty, cals.isEmpty {
        emitError("No reminder list named \\"\\(listName)\\"")
        return
    }
    let predicate = store.predicateForReminders(in: cals.isEmpty ? nil : cals)
    var reminders = await fetchReminders(store, predicate: predicate)
    if let want = completedFilter {
        reminders = reminders.filter { $0.isCompleted == want }
    }
    let capped = Array(reminders.prefix(max(0, limit)))
    let rows: [[String: Any]] = capped.map { r in
        return [
            "id": r.calendarItemIdentifier,
            "title": r.title ?? "",
            "notes": r.notes ?? NSNull(),
            "completed": r.isCompleted,
            "dueDate": isoString(r.dueDateComponents?.date),
            "list": r.calendar?.title ?? NSNull(),
        ]
    }
    emitOk(["reminders": rows, "count": rows.count])
}

func cmdReminderUpdate(_ input: [String: Any], dryRun: Bool) async {
    let id = (input["id"] as? String) ?? ""
    guard !id.isEmpty else { emitError("id is required"); return }
    if dryRun { emitOk(["id": id, "completed": input["completed"] ?? NSNull(), "dryRun": true]); return }
    let store = EKEventStore()
    guard await requestReminderAccess(store) else {
        emitDenied("Reminders access denied. Run: sua apple authorize")
        return
    }
    guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else {
        emitError("No reminder found with id \\"\\(id)\\"")
        return
    }
    if let completed = input["completed"] as? Bool { reminder.isCompleted = completed }
    if let title = input["title"] as? String { reminder.title = title }
    if let notes = input["notes"] as? String { reminder.notes = notes }
    if let due = parseDate(input["dueDate"] as? String) {
        reminder.dueDateComponents = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute, .second], from: due)
    }
    do {
        try store.save(reminder, commit: true)
        emitOk(["id": reminder.calendarItemIdentifier, "completed": reminder.isCompleted])
    } catch {
        emitError("Failed to update reminder: \\(error.localizedDescription)")
    }
}

func cmdNoteCreate(_ input: [String: Any], dryRun: Bool) {
    let title = (input["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !title.isEmpty else { emitError("title is required"); return }
    let body = (input["body"] as? String) ?? ""
    let folder = input["folder"] as? String
    if dryRun { emitOk(["id": NSNull(), "title": title, "folder": jsonValue(folder), "dryRun": true]); return }
    // Notes' AppleScript body is HTML; wrap plaintext minimally.
    let htmlBody = "<div><b>" + asEscape(title) + "</b></div><div>" + asEscape(body) + "</div>"
    let nameLit = "\\"" + asEscape(title) + "\\""
    let bodyLit = "\\"" + asEscape(htmlBody) + "\\""
    var script: String
    if let folder = folder, !folder.isEmpty {
        let folderLit = "\\"" + asEscape(folder) + "\\""
        script = "tell application \\"Notes\\"\\ntell folder \\(folderLit)\\nmake new note with properties {name:\\(nameLit), body:\\(bodyLit)}\\nend tell\\nend tell"
    } else {
        script = "tell application \\"Notes\\"\\nmake new note with properties {name:\\(nameLit), body:\\(bodyLit)}\\nend tell"
    }
    let (_, err) = runAppleScript(script)
    if let err = err {
        emitDenied("Could not create note: \\(err). Grant Automation access for Notes in System Settings > Privacy & Security > Automation, or run: sua apple authorize")
        return
    }
    emitOk(["id": NSNull(), "title": title, "folder": jsonValue(folder)])
}

func cmdNoteRead(_ input: [String: Any], dryRun: Bool) {
    let folder = input["folder"] as? String
    let limit = (input["limit"] as? Int) ?? 20
    if dryRun { emitOk(["notes": [], "count": 0, "dryRun": true]); return }
    // Best-effort: enumerate note names+bodies via AppleScript with field/record delimiters.
    let scope: String
    if let folder = folder, !folder.isEmpty {
        scope = "notes of folder \\"" + asEscape(folder) + "\\""
    } else {
        scope = "notes"
    }
    let script = """
    set out to ""
    tell application "Notes"
    set theNotes to \\(scope)
    set n to count of theNotes
    if n > \\(limit) then set n to \\(limit)
    repeat with i from 1 to n
    set aNote to item i of theNotes
    set out to out & (name of aNote) & "\\\\t" & (body of aNote) & "\\\\n---REC---\\\\n"
    end repeat
    end tell
    return out
    """
    let (out, err) = runAppleScript(script)
    if let err = err {
        emitDenied("Could not read notes: \\(err). Grant Automation access for Notes, or run: sua apple authorize")
        return
    }
    var rows: [[String: Any]] = []
    if let out = out {
        let records = out.components(separatedBy: "\\n---REC---\\n")
        for rec in records {
            let trimmed = rec.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { continue }
            let parts = rec.components(separatedBy: "\\t")
            let name = parts.first ?? ""
            let bodyHtml = parts.count > 1 ? parts[1] : ""
            rows.append(["id": NSNull(), "title": name, "body": bodyHtml, "folder": folder ?? NSNull()])
        }
    }
    emitOk(["notes": rows, "count": rows.count])
}

// ── Entry point ─────────────────────────────────────────────────────────

@main
struct Runner {
    static func main() async {
        var args = Array(CommandLine.arguments.dropFirst())
        if args.contains("--version") {
            print(RUNNER_VERSION)
            return
        }
        var dryRun = false
        if let idx = args.firstIndex(of: "--dry-run") {
            dryRun = true
            args.remove(at: idx)
        }
        guard let sub = args.first else {
            emitError("no subcommand given")
            return
        }
        let input = (sub == "lists") ? [:] : readStdinJSON()
        switch sub {
        case "lists": await cmdLists(dryRun: dryRun)
        case "reminder-create": await cmdReminderCreate(input, dryRun: dryRun)
        case "reminder-read", "reminder-list": await cmdReminderRead(input, dryRun: dryRun)
        case "reminder-update", "reminder-complete": await cmdReminderUpdate(input, dryRun: dryRun)
        case "note-create": cmdNoteCreate(input, dryRun: dryRun)
        case "note-read", "note-list": cmdNoteRead(input, dryRun: dryRun)
        default: emit(status: "unsupported", data: nil, error: "unknown subcommand: \\(sub)")
        }
    }
}
`;

/** Snapshot of what the owner authorized, stored on the integration row. */
export interface AppleSnapshot {
  reminderLists: { id: string; title: string }[];
  noteFolders: { id: string; name: string }[];
  introspectedAt: string;
}

export interface AppleRunnerHandle {
  /** Absolute path to the compiled binary. Only meaningful when status === 'ready'. */
  binaryPath: string;
  status: 'ready' | 'compile-failed' | 'unsupported';
  /** Human-readable message when status !== 'ready'. */
  message?: string;
}

/** Where the compiled binary lives. Override via `SUA_APPLE_RUNNERS_DIR` for tests. */
export function appleRunnersDir(): string {
  return process.env.SUA_APPLE_RUNNERS_DIR ?? join(homedir(), '.sua', 'runners');
}

export function appleReminderBinaryPath(): string {
  return join(appleRunnersDir(), 'apple_reminders');
}

function appleReminderSourceHashPath(): string {
  return join(appleRunnersDir(), 'apple_reminders.source-hash');
}

function hashSource(): string {
  return createHash('sha256').update(APPLE_SWIFT_SOURCE).digest('hex');
}

export function appleRunnerVersionString(): string {
  return APPLE_RUNNER_VERSION_STRING;
}

/**
 * Ensure the runner is compiled and cached. Idempotent (cache hit returns
 * immediately). On non-macOS hosts, or hosts without `xcrun`, returns
 * `status: 'unsupported'` without raising.
 */
export function ensureAppleRunner(): AppleRunnerHandle {
  const binaryPath = appleReminderBinaryPath();

  if (process.platform !== 'darwin') {
    return { binaryPath, status: 'unsupported', message: 'Apple Reminders/Notes is macOS-only.' };
  }

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
  const sourcePath = join(dir, 'apple_reminders.swift');
  const hashPath = appleReminderSourceHashPath();
  const currentHash = hashSource();

  if (existsSync(binaryPath) && existsSync(hashPath)) {
    try {
      const cachedHash = readFileSync(hashPath, 'utf-8').trim();
      if (cachedHash === currentHash) {
        const binStat = statSync(binaryPath);
        const hashStat = statSync(hashPath);
        if (binStat.mtimeMs >= hashStat.mtimeMs - 5_000) {
          return { binaryPath, status: 'ready' };
        }
      }
    } catch {
      // fall through to recompile
    }
  }

  ensureParentDir(sourcePath);
  writeFileSync(sourcePath, APPLE_SWIFT_SOURCE, 'utf-8');
  chmod600Safe(sourcePath);

  const compile = spawnSync('xcrun', ['swiftc', '-parse-as-library', sourcePath, '-o', binaryPath], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (compile.status !== 0) {
    const stderr = (compile.stderr ?? '').trim() || (compile.stdout ?? '').trim();
    return { binaryPath, status: 'compile-failed', message: stderr || `xcrun swiftc exited with code ${compile.status}` };
  }

  writeFileSync(hashPath, currentHash, 'utf-8');
  chmod600Safe(hashPath);
  return { binaryPath, status: 'ready' };
}

/** Parsed response from one runner subcommand invocation. */
export interface AppleRunResult {
  status: 'ok' | 'denied' | 'unsupported' | 'error';
  data: unknown;
  errorMessage: string | null;
}

export interface RunAppleOptions {
  dryRun?: boolean;
  timeoutSec?: number;
}

/**
 * Run one runner subcommand: spawn the binary with `[subcommand]` (plus
 * `--dry-run` when requested), pipe `payload` as JSON on stdin, and parse the
 * last JSON line of stdout. Throws on spawn/timeout/parse failure so a tool's
 * `execute()` fails the node visibly.
 */
export async function runAppleSubcommand(
  binaryPath: string,
  subcommand: string,
  payload: unknown,
  opts: RunAppleOptions = {},
): Promise<AppleRunResult> {
  const args = opts.dryRun ? ['--dry-run', subcommand] : [subcommand];
  const res = await spawnProcess(binaryPath, args, {
    env: {},
    timeoutSec: opts.timeoutSec ?? 30,
    stdinInput: JSON.stringify(payload ?? {}),
  });
  const stdout = (res.result ?? '').trim();
  // Take the last non-empty line — the runner prints exactly one JSON line,
  // but defend against stray framework logging on stderr/stdout.
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) {
    throw new Error(
      `apple runner produced no output (exit ${res.exitCode})${res.error ? `: ${res.error}` : ''}`,
    );
  }
  let parsed: { status?: string; data?: unknown; error_message?: string | null };
  try {
    parsed = JSON.parse(last) as typeof parsed;
  } catch {
    throw new Error(`apple runner returned non-JSON output: ${last.slice(0, 200)}`);
  }
  const status = (parsed.status as AppleRunResult['status']) ?? 'error';
  return { status, data: parsed.data ?? null, errorMessage: parsed.error_message ?? null };
}
