/** Private Windows installer versioning; run after the normal release builds. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const appDir = join(root, "apps/desktop");

export async function reserveDevelopBuild(outputRoot, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const date = [parts.year, parts.month, parts.day].map(Number).join(".");
  const pattern = new RegExp(`^${date.replaceAll(".", "\\.")}-dev\\.(\\d+)$`);
  await mkdir(outputRoot, { recursive: true });
  let number = 1;
  for (const name of await readdir(outputRoot)) {
    const match = name.match(pattern);
    if (match) number = Math.max(number, Number(match[1]) + 1);
  }
  for (; number <= 65535; number++) {
    const version = `${date}-dev.${number}`;
    const directory = join(outputRoot, version);
    try {
      await mkdir(directory);
      return { version, buildVersion: `${date}.${number}`, number, directory };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Daily Windows build number exhausted");
}

export async function packageDevelopWindows({
  outputRoot = join(appDir, "release"), now = new Date(), build,
} = {}) {
  const manifest = JSON.parse(await readFile(join(appDir, "package.json"), "utf8"));
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const reserved = await reserveDevelopBuild(resolve(outputRoot), now);
  const builder = build ?? createRequire(join(appDir, "package.json"))("electron-builder").build;
  console.log(`Packaging private develop ${reserved.version} (upstream ${manifest.version}, ${sourceCommit.slice(0, 9)})`);
  await builder({
    projectDir: appDir, win: ["nsis"], x64: true, publish: "never",
    config: {
      directories: { output: reserved.directory },
      buildVersion: reserved.buildVersion,
      buildNumber: String(reserved.number),
      extraMetadata: {
        version: reserved.version,
        piUpstreamVersion: manifest.version,
        piBuildCommit: sourceCommit,
        piDistribution: "installed",
        piUpdatesDisabled: true,
      },
    },
  });
  const installer = `PI-Desktop-Setup-${reserved.version}.exe`;
  const bytes = await readFile(join(reserved.directory, installer));
  const info = {
    version: reserved.version, buildVersion: reserved.buildVersion,
    upstreamVersion: manifest.version, sourceCommit,
    appId: manifest.build.appId, productName: manifest.build.productName,
    installer, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  await writeFile(join(reserved.directory, "build-info.json"), `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const info = await packageDevelopWindows({ outputRoot: process.argv[2] });
    console.log(`Created ${info.installer}\nSHA-256: ${info.sha256}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
