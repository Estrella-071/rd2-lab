import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const svg = fs.readFileSync(path.join(rootDir, "site/data/dice_tree.svg"), "utf8");
const missing = [];
const regex = /href="icons\/([^"]+)"/g;
let match;
while ((match = regex.exec(svg)) !== null) {
  const f = path.join(rootDir, "site/icons", match[1]);
  if (!fs.existsSync(f)) {
    missing.push(match[1]);
  }
}
console.log("Missing SVG icons:", missing);

const diceTree = JSON.parse(fs.readFileSync(path.join(rootDir, "site/data/dice_tree.json"), "utf8"));
const node1501 = diceTree.nodes.find((n) => n.id === "1501");
const node1601 = diceTree.nodes.find((n) => n.id === "1601");
console.log("1501 icon:", node1501?.icon_file, fs.existsSync(path.join(rootDir, "site", node1501?.icon_file || "")));
console.log("1601 icon:", node1601?.icon_file, fs.existsSync(path.join(rootDir, "site", node1601?.icon_file || "")));
