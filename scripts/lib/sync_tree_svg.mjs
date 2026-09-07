import fs from "node:fs";
import path from "node:path";

function extractSymbolIcon(source, id, svgPath) {
  const symbolPattern = new RegExp(String.raw`<symbol id="${id}"[^>]*>[\s\S]*?</symbol>`);
  const symbol = source.match(symbolPattern)?.[0];
  if (!symbol) throw new Error(`Missing source symbol ${id}`);
  const encoded = symbol.match(/data:image\/png;base64,([^" ]+)/)?.[1];
  if (!encoded) throw new Error(`Missing source symbol pixels ${id}`);
  const file = `Version110-${id}.png`;
  const iconPath = path.resolve(path.dirname(svgPath), "..", "icons", file);
  fs.writeFileSync(iconPath, Buffer.from(encoded, "base64"));
  return { file, newId: `version110-${id}` };
}

function syncMissingNode(svg, node, source, svgPath) {
  if (svg.includes(`data-node-id="${node.id}"`)) return svg;
  const line = source.split("\n").find((value) => value.includes(`data-node-id="${node.id}"`));
  if (!line) throw new Error(`Missing source SVG node ${node.id}`);
  let markup = line;
  const symbolIds = new Set([...line.matchAll(/(?:href|xlink:href)="#([^"]+)"/g)].map((m) => m[1]));
  let updatedSvg = svg;
  for (const id of symbolIds) {
    const { file, newId } = extractSymbolIcon(source, id, svgPath);
    if (!updatedSvg.includes(`id="${newId}"`)) {
      updatedSvg = updatedSvg.replace("</defs>", `<symbol id="${newId}" viewBox="0 0 1 1"><image href="icons/${file}" xlink:href="icons/${file}" width="1" height="1" preserveAspectRatio="xMidYMid meet"/></symbol>\n</defs>`);
    }
    markup = markup.replaceAll(`#${id}"`, `#${newId}"`);
  }
  return updatedSvg.replace("</svg>", `${markup}\n</svg>`);
}

function generateEdges(edges, positions) {
  return edges.map((edge) => {
    const a = positions.get(String(edge.from));
    const b = positions.get(String(edge.to));
    if (!a || !b) throw new Error(`Missing edge position ${edge.from}->${edge.to}`);
    return `<path class="edge" d="M ${a.replace(",", " ")} L ${b.replace(",", " ")}"/>`;
  }).join("\n");
}

// Keep the published styling while refreshing the client's node positions and
// topology. New node markup comes from the same source-tree renderer as JSON.
export function syncTreeSvg(svgPath, raw, canonical) {
  const source = fs.readFileSync(path.join(raw.sourceRoot, "dice_tree_full.svg"), "utf8");
  let svg = fs.readFileSync(svgPath, "utf8");
  const positions = new Map();
  for (const match of source.matchAll(/<g\b[^>]*data-node-id="([^"]+)"[^>]*transform="translate\(([^)]+)\)"[^>]*>/g)) {
    positions.set(match[1], match[2]);
  }
  svg = svg.replace(/(<g\b[^>]*data-node-id="([^"]+)"[^>]*transform=")translate\([^)]+\)/g,
    (all, prefix, id) => positions.has(id) ? `${prefix}translate(${positions.get(id)})` : all);
  for (const node of canonical.nodes) {
    svg = syncMissingNode(svg, node, source, svgPath);
  }
  svg = svg.replace(/<path class="edge"[^>]*\/>\s*/g, "");
  const renderedEdges = generateEdges(canonical.edges, positions);
  svg = svg.replace("</defs>", `</defs>\n${renderedEdges}`);
  fs.writeFileSync(svgPath, svg);
}
