"use strict";
/*
 * dsh-web launcher
 *
 * A zero-dependency launcher that:
 *   1. keeps a private copy of @deepseek-ai/dsh under an app directory,
 *   2. checks the npm registry for a newer version on every start and
 *      auto-updates before booting,
 *   3. boots `dsh web` in the chosen workspace and opens the browser.
 *
 * Built as a standalone executable with Node's SEA (single executable
 * application): `build.ps1` on Windows (dsh-web.exe) and `build.sh` on
 * macOS/Linux (dsh-web). In SEA mode everything is portable: the app payload
 * lives in `<exe-dir>/runtime` and the Harness home (`DSH_HOME`) defaults to
 * `<exe-dir>/runtime/dsh-home`, so the whole folder can be copied anywhere.
 * Run `node launcher.cjs` for the same behaviour in source mode.
 */

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const LAUNCHER_VERSION = "0.2.6";
const PKG = "@deepseek-ai/dsh";
const PKG_REGISTRY_LATEST = "https://registry.npmjs.org/" + PKG + "/latest";
const DSH_BIN = ["node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"];
const UPDATE_TIMEOUT_MS = 20000;

let SEA = null;
try {
  SEA = require("node:sea");
} catch {
  SEA = null;
}
const EXE_DIR = SEA && SEA.isSea() ? path.dirname(process.execPath) : __dirname;

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function log(message) {
  console.log("[dsh] " + message);
}

function isWindows() {
  return process.platform === "win32";
}

function defaultAppDir() {
  if (process.env.DSH_APP_DIR) return path.resolve(process.env.DSH_APP_DIR);
  if (SEA && SEA.isSea()) return path.join(EXE_DIR, "runtime");
  const local =
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(local, "DeepSeekHarness");
}

function resolveDshHome(appDir, config) {
  if (config && config.dshHome) return path.resolve(config.dshHome);
  if (process.env.DSH_HOME) return path.resolve(process.env.DSH_HOME);
  return path.join(appDir, "dsh-home");
}

function fetchJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error("HTTP " + res.statusCode + " for " + url));
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
  });
}

async function isServerUp(port) {
  try {
    const res = await fetch("http://127.0.0.1:" + port + "/", {
      signal: AbortSignal.timeout(1500),
    });
    return res.status >= 200 && res.status < 500;
  } catch {
    return false;
  }
}

function installedVersion(appDir) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(appDir, "node_modules", "@deepseek-ai", "dsh", "package.json"),
        "utf8"
      )
    );
    return pkg.version;
  } catch {
    return null;
  }
}

function ensurePackageJson(appDir) {
  const file = path.join(appDir, "package.json");
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      JSON.stringify({ name: "dsh-app", version: "1.0.0", private: true }, null, 2) +
        os.EOL
    );
  }
}

function resolveNode(appDir) {
  const bundled = path.join(appDir, "node", isWindows() ? "node.exe" : "bin/node");
  if (fs.existsSync(bundled)) return bundled;
  const probe = spawnSync(isWindows() ? "where.exe" : "which", ["node"], {
    encoding: "utf8",
  });
  if (probe.status === 0 && probe.stdout) {
    const first = probe.stdout.split(/\r?\n/).find((line) => line.trim());
    if (first) return first.trim();
  }
  return isWindows() ? "node.exe" : "node";
}

function npmCliPath(nodeBin) {
  return path.join(path.dirname(nodeBin), "node_modules", "npm", "bin", "npm-cli.js");
}

function npmInstall(nodeBin, appDir, args) {
  const cli = npmCliPath(nodeBin);
  if (!fs.existsSync(cli)) {
    console.error("[dsh] npm-cli not found next to " + nodeBin);
    return 1;
  }
  log("npm install " + args.join(" ") + "  (cwd: " + appDir + ")");
  return spawnSync(nodeBin, [cli, "install", ...args], {
    cwd: appDir,
    stdio: "inherit",
    shell: false,
  }).status;
}

function loadConfig(appDir) {
  const candidates = [
    path.join(EXE_DIR, "launcher.json"),
    path.join(appDir, "launcher.json"),
  ];
  for (const file of candidates) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      /* try next */
    }
  }
  return {};
}

/* ------------------------------------------------------------------ */
/* argument parsing                                                    */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = {
    help: false,
    version: false,
    update: true,
    openBrowser: true,
    migrateHome: false,
    openMode: null,
    windowSize: null,
    appDir: null,
    workspace: null,
    port: null,
    rest: [],
  };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--") {
      opts.rest.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--version" || arg === "-V") opts.version = true;
    else if (arg === "--no-update") opts.update = false;
    else if (arg === "--no-open") opts.openBrowser = false;
    else if (arg === "--migrate-home") opts.migrateHome = true;
    else if (arg === "--open-mode" && argv[i + 1]) {
      const mode = argv[++i];
      if (mode === "browser" || mode === "app" || mode === "none") opts.openMode = mode;
      else console.error("[dsh] --open-mode must be browser|app|none");
    }
    else if (arg === "--window-size" && argv[i + 1]) opts.windowSize = argv[++i];
    else if (arg === "--app-dir" && argv[i + 1]) opts.appDir = argv[++i];
    else if (arg === "--cwd" && argv[i + 1]) opts.workspace = argv[++i];
    else if (arg === "--port" && argv[i + 1]) opts.port = argv[++i];
    else if (arg === "--port" && !argv[i + 1]) {
      console.error("[dsh] --port needs a value");
      opts.help = true;
    } else opts.rest.push(arg);
    i++;
  }
  return opts;
}

function printHelp() {
  console.log(
    [
      "Usage: dsh-web [options] [-- dsh-web args...]",
      "",
      "Boots the DeepSeek Harness browser UI (`dsh web`) and keeps",
      "@deepseek-ai/dsh up to date against the npm registry.",
      "",
      "Options:",
      "  -h, --help        show this help",
      "  -V, --version     print launcher and dsh versions",
      "  --no-update       skip the update check on this start",
      "  --no-open         do not open the browser automatically",
      "  --migrate-home    copy ~/.dsh user data into the portable home once",
      "  --open-mode <m>   how to show the UI: browser | app | none",
      "  --window-size <s> app window size in app mode, e.g. 1440x900",
      "  --app-dir <dir>   app home (portable default: <exe>\\runtime)",
      "  --cwd <dir>       workspace directory the server runs in",
      "  --port <n>        port for the web UI (default: 3080)",
      "  -- ...            everything after -- is passed to `dsh web`",
      "",
      "Config file: launcher.json next to the exe (fallback: <app-dir>\\launcher.json).",
      "Keys: workspace, port, openBrowser, openMode, windowSize, update, dshHome.",
      "DSH_HOME / DSH_APP_DIR env vars override defaults; CLI flags win over config.",
    ].join(os.EOL)
  );
}

function migrateHome(dshHome) {
  const src = path.join(os.homedir(), ".dsh");
  if (!fs.existsSync(src)) {
    log("no ~/.dsh to migrate");
    return;
  }
  if (fs.existsSync(dshHome) && fs.readdirSync(dshHome).length > 0) {
    log("portable home already has data, skipping migration");
    return;
  }
  fs.mkdirSync(dshHome, { recursive: true });
  const entries = [
    "settings.yaml",
    ".credentials.yaml",
    ".anonymous-user-id",
    "sessions",
    "storages",
  ];
  for (const name of entries) {
    const from = path.join(src, name);
    if (fs.existsSync(from)) {
      fs.cpSync(from, path.join(dshHome, name), { recursive: true, force: true });
      log("migrated " + name);
    }
  }
  log("migrated " + src + " -> " + dshHome);
}

/*
 * Portable relocation support: dsh writes absolute junctions under
 * `<dsh-home>\profiles\*\node_modules` that point at the app payload. When the
 * whole package is copied to a new location those junctions go stale and dsh
 * refuses to boot. Detect targets that no longer live under the current app
 * payload and remove only those managed node_modules dirs; dsh recreates them
 * on the next boot (offline, no re-download). User files such as
 * cordis.patch.yml are not touched.
 */
function healRelocatedProfiles(appDir, dshHome) {
  const expectedRoot = path.resolve(appDir, "node_modules").toLowerCase() + path.sep;
  const profilesDir = path.join(dshHome, "profiles");
  if (!fs.existsSync(profilesDir)) return;

  // Only the flat fallback `profiles/node_modules` is dsh-managed with
  // junctions. Per-profile `profiles/<name>/node_modules` are pnpm-managed
  // installs (plugins) and must never be touched.
  const nm = path.join(profilesDir, "node_modules");
  if (!fs.existsSync(nm)) return;
  let stale = false;
  try {
    const probe = path.join(nm, "@deepseek-ai", "dsh");
    const target = path.resolve(fs.readlinkSync(probe)).toLowerCase();
    stale = !target.startsWith(expectedRoot);
  } catch {
    stale = false; // broken or missing probe: dsh heals the fallback itself
  }
  if (stale) {
    log("package moved; resetting managed profile links under " + nm);
    fs.rmSync(nm, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* update + boot                                                       */
/* ------------------------------------------------------------------ */

async function ensureDsh(nodeBin, appDir, allowUpdate) {
  let installed = installedVersion(appDir);
  let latest = null;

  if (allowUpdate) {
    try {
      const data = await fetchJson(PKG_REGISTRY_LATEST, UPDATE_TIMEOUT_MS);
      latest = data && data.version ? data.version : null;
    } catch (error) {
      log("update check failed (" + error.message + "), continuing with installed version");
    }
  }

  if (latest && latest !== installed) {
    log(PKG + " " + (installed || "(not installed)") + " -> " + latest);
    const status = npmInstall(nodeBin, appDir, [PKG + "@" + latest, "--no-audit", "--no-fund"]);
    if (status !== 0) {
      console.error("[dsh] update install failed (exit " + status + ")");
      if (!installed) process.exit(1);
    } else {
      installed = installedVersion(appDir);
    }
  }

  if (!installed) {
    log(PKG + " is not installed; installing latest");
    const status = npmInstall(nodeBin, appDir, [PKG + "@latest", "--no-audit", "--no-fund"]);
    if (status !== 0) {
      console.error("[dsh] install failed (exit " + status + ")");
      process.exit(1);
    }
    installed = installedVersion(appDir);
  }

  if (!installed) {
    console.error("[dsh] " + PKG + " did not install; cannot continue");
    process.exit(1);
  }
  return installed;
}

function findChromium() {
  if (process.platform === "darwin") {
    const macApps = [
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
    for (const app of macApps) if (fs.existsSync(app)) return app;
    return null;
  }
  const roots = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
  ].filter(Boolean);
  const names = [
    ["Microsoft", "Edge", "Application", "msedge.exe"],
    ["Google", "Chrome", "Application", "chrome.exe"],
  ];
  for (const root of roots) {
    for (const parts of names) {
      const candidate = path.join(root, ...parts);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  const searchNames = isWindows()
    ? ["msedge.exe", "chrome.exe"]
    : ["msedge", "google-chrome", "chromium", "brave-browser"];
  for (const name of searchNames) {
    const probe = spawnSync(isWindows() ? "where.exe" : "which", [name], {
      encoding: "utf8",
    });
    if (probe.status === 0 && probe.stdout) {
      const first = probe.stdout.split(/\r?\n/).find((line) => line.trim());
      if (first) return first.trim();
    }
  }
  return null;
}

function openInAppWindow(appDir, url, windowSize) {
  const exe = findChromium();
  if (!exe) {
    log("no Edge/Chrome found for app mode, falling back to default browser");
    return false;
  }
  const profileDir = path.join(appDir, "edge-profile");
  const args = ["--app=" + url, "--user-data-dir=" + profileDir];
  if (windowSize === "max") args.push("--start-maximized");
  else args.push("--window-size=" + (windowSize || "1440,900"));
  log("opening app window: " + exe);
  const child = spawn(exe, args, { detached: true, stdio: "ignore" });
  child.on("error", (error) => {
    log("app window failed (" + error.message + "), falling back to default browser");
  });
  child.unref();
  return true;
}

/*
 * In app mode, stop the server when the Edge/Chrome app window is closed, so
 * the launcher behaves like a normal desktop app and the next start does not
 * collide with an orphaned server on the same port.
 */
function countAppWindowProcesses(url) {
  if (isWindows()) {
    const script =
      "Get-CimInstance Win32_Process -Filter \"Name = 'msedge.exe'\" | " +
      "Where-Object { $_.CommandLine -like '*--app=" + url + "*' } | " +
      "Measure-Object | Select-Object -ExpandProperty Count";
    const probe = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
    });
    return parseInt((probe.stdout || "").trim(), 10) || 0;
  }
  const probe = spawnSync("ps", ["-axo", "command"], {
    encoding: "utf8",
    timeout: 8000,
  });
  const needle = "--app=" + url;
  return (probe.stdout || "").split("\n").filter((line) => line.includes(needle)).length;
}

function watchAppWindow(url, child) {
  let seen = false;
  const timer = setInterval(() => {
    const count = countAppWindowProcesses(url);
    if (count > 0) {
      seen = true;
      return;
    }
    if (seen) {
      clearInterval(timer);
      log("app window closed; stopping dsh server");
      if (child && !child.killed) child.kill();
    }
  }, 3000);
  timer.unref();
  child.once("exit", () => clearInterval(timer));
}

function openBrowser(appDir, url, openMode, windowSize) {
  if (openMode === "none") {
    log("UI ready at " + url);
    return;
  }
  if (openMode === "app" && openInAppWindow(appDir, url, windowSize)) return;
  let cmd;
  let args;
  if (isWindows()) {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else if (process.platform === "darwin") {
    cmd = "open";
    args = [url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

function boot(nodeBin, appDir, dshHome, opts) {
  let workspace = path.resolve(opts.workspace || EXE_DIR);
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    log("workspace not found (" + workspace + "), using " + EXE_DIR);
    workspace = EXE_DIR;
  }
  const bin = path.join(appDir, ...DSH_BIN);
  const serverArgs = [bin, "web"];
  if (opts.port) serverArgs.push("--port", String(opts.port));
  serverArgs.push(...opts.rest);

  log("workspace: " + workspace);
  log("starting: node " + serverArgs.join(" "));

  const child = spawn(nodeBin, serverArgs, {
    cwd: workspace,
    env: { ...process.env, DSH_HOME: dshHome },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let opened = false;
  const onData = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (!opened && opts.openBrowser) {
      const match = text.match(/https?:\/\/[^\s]+/);
      if (match) {
        opened = true;
        log("opening " + match[0]);
        openBrowser(appDir, match[0], opts.openMode, opts.windowSize);
        if (opts.openMode === "app") watchAppWindow(match[0], child);
      }
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("error", (error) => {
    console.error("[dsh] failed to start: " + error.message);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    log("server exited (" + (signal || code) + ")");
    process.exit(code === null ? (signal ? 1 : 0) : code);
  });

  const forward = (name) => {
    try {
      process.on(name, () => {
        if (child && !child.killed) child.kill();
      });
    } catch {
      /* ignore */
    }
  };
  forward("SIGINT");
  forward("SIGTERM");
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    printHelp();
    return 0;
  }

  const appDir = path.resolve(cli.appDir || defaultAppDir());
  const config = loadConfig(appDir);
  const dshHome = resolveDshHome(appDir, config);
  const opts = {
    update: cli.update && config.update !== false,
    openBrowser: cli.openBrowser && config.openBrowser !== false,
    openMode: cli.openMode || config.openMode || "browser",
    windowSize: cli.windowSize || config.windowSize || null,
    workspace: cli.workspace || config.workspace || null,
    port: cli.port || config.port || null,
    migrateHome: cli.migrateHome,
    rest: cli.rest,
  };

  if (cli.version) {
    log("launcher " + LAUNCHER_VERSION);
    log(PKG + " " + (installedVersion(appDir) || "not installed"));
    return 0;
  }

  log("launcher " + LAUNCHER_VERSION);
  log("app dir: " + appDir);
  fs.mkdirSync(appDir, { recursive: true });
  ensurePackageJson(appDir);

  if (opts.migrateHome) migrateHome(dshHome);
  healRelocatedProfiles(appDir, dshHome);
  log("dsh home: " + dshHome);

  const nodeBin = resolveNode(appDir);
  log("node: " + nodeBin);

  await ensureDsh(nodeBin, appDir, opts.update);
  log(PKG + " " + installedVersion(appDir));

  const port = opts.port || 3080;
  if (await isServerUp(port)) {
    const url = "http://127.0.0.1:" + port;
    log("server already running at " + url + " - not starting a second instance");
    if (opts.openBrowser && opts.openMode !== "none") {
      openBrowser(appDir, url, opts.openMode, opts.windowSize);
    }
    return 0;
  }

  boot(nodeBin, appDir, dshHome, opts);
}

main().catch((error) => {
  console.error("[dsh] fatal: " + (error && error.stack ? error.stack : error));
  process.exit(1);
});
