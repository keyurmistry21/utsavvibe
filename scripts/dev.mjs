#!/usr/bin/env node
// Cross-platform "start everything" (Windows, macOS, Linux): the same steps as `make up`, without needing a POSIX shell.
//   npm run up            start MySQL + mail catcher, sync the schema, seed markets, run API (:4000) and website (:5173)
//   npm run up -- --no-docker   use a MySQL 8 you already run (the DATABASE_URL in backend/.env) instead of Docker
//   node scripts/dev.mjs --no-run   do the setup steps only
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const win = process.platform === "win32";
const noRun = process.argv.includes("--no-run");
const noDocker = process.argv.includes("--no-docker");

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) { console.error(`Node 20 or newer is needed (you have ${process.versions.node}). Install it from https://nodejs.org`); process.exit(1); }

// shell:true so "npm" and "docker" resolve to npm.cmd / docker.exe on Windows
const run = (cmd, quiet = false) => spawnSync(cmd, { shell: true, stdio: quiet ? "ignore" : "inherit" });
const must = (cmd, what) => { const r = run(cmd); if (r.status !== 0) { console.error(`\nStep failed: ${what} (${cmd})`); process.exit(r.status ?? 1); } };

console.log("1/5 dependencies");
if (!existsSync("node_modules")) must("npm install", "installing packages");
if (!existsSync("backend/.env")) { copyFileSync("backend/.env.example", "backend/.env"); console.log("    created backend/.env from the template"); }

// where the app will look for MySQL (backend/.env)
const dbUrl = (() => { try { return new URL(/^DATABASE_URL="?([^"\r\n]+)"?/m.exec(readFileSync("backend/.env", "utf8"))?.[1] ?? ""); } catch { return null; } })();
const dbHost = dbUrl?.hostname || "localhost", dbPort = Number(dbUrl?.port || 3306);
const reachable = (host, port) => new Promise((ok) => { const s = net.connect({ host, port, timeout: 1500 }); s.on("connect", () => { s.destroy(); ok(true); }); s.on("error", () => ok(false)); s.on("timeout", () => { s.destroy(); ok(false); }); });
const dockerRunning = run("docker info", true).status === 0;

let useDocker = !noDocker && dockerRunning;
if (!useDocker) {
  if (!(await reachable(dbHost, dbPort))) {
    console.error(`
Docker is ${noDocker ? "skipped" : "not installed or not running"}, and no MySQL answers at ${dbHost}:${dbPort}.
Pick one:
  A) Install Docker Desktop (https://www.docker.com/products/docker-desktop), start it, then run:  npm run up
  B) Use a MySQL 8 server you already have: create an empty database and user, put its address in backend/.env as DATABASE_URL, then run:  npm run up -- --no-docker
     (see "Run without Docker" in README.md)`);
    process.exit(1);
  }
  console.log(`2/5 using the MySQL already running at ${dbHost}:${dbPort} (no Docker). Dev emails are not caught: set SMTP_* in backend/.env to send, or they are skipped.`);
  console.log("3/5 MySQL reachable");
} else {
  console.log("2/5 database and mail catcher (Docker)");
  must("docker compose up -d mysql mailpit", "starting MySQL (is Docker Desktop running?)");
  console.log("3/5 waiting for MySQL");
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    ready = run("docker exec utsavvibe-mysql mysqladmin ping -h127.0.0.1 -uroot -proot --silent", true).status === 0;
    if (!ready) { process.stdout.write("."); await new Promise((r) => setTimeout(r, 2000)); }
  }
  if (!ready) { console.error("\nMySQL did not become ready. Check `docker compose logs mysql`."); process.exit(1); }
  console.log(" ready");
}

console.log("4/5 schema and markets");
must("npm run db:push --silent", "syncing the database schema");
must("npm run seed --silent", "seeding markets");

if (noRun) { console.log("5/5 skipped (--no-run)"); process.exit(0); }
console.log("5/5 starting\n  API  -> http://localhost:4000\n  Site -> http://localhost:5173  (admin: /admin)\n" + (useDocker ? "  Mail -> http://localhost:8026  (dev inbox)\n" : "") + "  Create your login in another terminal:  npm run create-admin -- you@example.com \"a long password\" \"Your Name\"\n  Ctrl-C stops both.\n");

const kids = ["dev:server", "dev:web"].map((s) => spawn(`npm run ${s}`, { shell: true, stdio: "inherit" }));
let stopping = false;
const stop = () => {
  if (stopping) return; stopping = true;
  for (const k of kids) {
    if (!k.pid) continue;
    if (win) spawnSync(`taskkill /PID ${k.pid} /T /F`, { shell: true, stdio: "ignore" }); // npm starts child processes: kill the whole tree
    else k.kill("SIGTERM");
  }
};
process.on("SIGINT", () => { stop(); process.exit(0); });
process.on("SIGTERM", () => { stop(); process.exit(0); });
for (const k of kids) k.on("exit", (code) => { if (!stopping && code) { console.error(`\nA server stopped (exit ${code}). Stopping the other one.`); stop(); process.exit(code); } });
