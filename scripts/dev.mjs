#!/usr/bin/env node
// Cross-platform "start everything" (Windows, macOS, Linux): the same steps as `make up`, without needing a POSIX shell.
//   npm run up            start MySQL + mail catcher, sync the schema, seed markets, run API (:4000) and website (:5173)
//   node scripts/dev.mjs --no-run   do the setup steps only
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const win = process.platform === "win32";
const noRun = process.argv.includes("--no-run");

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) { console.error(`Node 20 or newer is needed (you have ${process.versions.node}). Install it from https://nodejs.org`); process.exit(1); }

// shell:true so "npm" and "docker" resolve to npm.cmd / docker.exe on Windows
const run = (cmd, quiet = false) => spawnSync(cmd, { shell: true, stdio: quiet ? "ignore" : "inherit" });
const must = (cmd, what) => { const r = run(cmd); if (r.status !== 0) { console.error(`\nStep failed: ${what} (${cmd})`); process.exit(r.status ?? 1); } };

console.log("1/5 dependencies");
if (!existsSync("node_modules")) must("npm install", "installing packages");
if (!existsSync("backend/.env")) { copyFileSync("backend/.env.example", "backend/.env"); console.log("    created backend/.env from the template"); }

console.log("2/5 database and mail catcher (Docker)");
if (run("docker --version", true).status !== 0) { console.error("Docker is not installed or not running. Install Docker Desktop (https://www.docker.com/products/docker-desktop), start it, then run this again."); process.exit(1); }
must("docker compose up -d mysql mailpit", "starting MySQL (is Docker Desktop running?)");

console.log("3/5 waiting for MySQL");
let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  ready = run("docker exec utsavvibe-mysql mysqladmin ping -h127.0.0.1 -uroot -proot --silent", true).status === 0;
  if (!ready) { process.stdout.write("."); await new Promise((r) => setTimeout(r, 2000)); }
}
if (!ready) { console.error("\nMySQL did not become ready. Check `docker compose logs mysql`."); process.exit(1); }
console.log(" ready");

console.log("4/5 schema and markets");
must("npm run db:push --silent", "syncing the database schema");
must("npm run seed --silent", "seeding markets");

if (noRun) { console.log("5/5 skipped (--no-run)"); process.exit(0); }
console.log("5/5 starting\n  API  -> http://localhost:4000\n  Site -> http://localhost:5173  (admin: /admin)\n  Mail -> http://localhost:8026  (dev inbox)\n  Create your login in another terminal:  npm run create-admin -- you@example.com \"a long password\" \"Your Name\"\n  Ctrl-C stops both.\n");

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
