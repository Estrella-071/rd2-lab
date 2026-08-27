import { spawnSync } from "node:child_process";

const browsers = process.argv.slice(2);
const requested = browsers.length > 0 ? browsers : ["chromium"];
const args = ["playwright", "install"];
if (process.platform === "linux") args.push("--with-deps");
args.push(...requested);

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(command, args, { stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
