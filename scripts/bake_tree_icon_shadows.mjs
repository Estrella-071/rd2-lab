import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeRgba8, encodeRgba8 } from "./lib/png_rgba.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = path.join(rootDir, "site");
const svgPath = path.join(siteDir, "data", "dice_tree.svg");
const sourceManifestPath = path.join(
  rootDir,
  "data",
  "tree-icon-shadow-sources.json",
);
const shadowColor = [0x0b, 0x08, 0x13];
const shadowBlur = 1.6;
const shadowOffsetY = 1.5;

function gaussianKernel(sigma) {
  if (!Number.isFinite(sigma) || sigma <= 0.05) {
    return { radius: 0, weights: Float64Array.of(1) };
  }
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const weights = new Float64Array(radius * 2 + 1);
  let total = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    weights[offset + radius] = weight;
    total += weight;
  }
  for (let index = 0; index < weights.length; index += 1) {
    weights[index] /= total;
  }
  return { radius, weights };
}

function blurAxisValue({ input, width, rowOffset, x, coordinateBase, limit, horizontal, kernel }) {
  let value = 0;
  for (let offset = -kernel.radius; offset <= kernel.radius; offset += 1) {
    const coordinate = coordinateBase + offset;
    if (coordinate < 0 || coordinate >= limit) continue;
    const sourceIndex = horizontal ? rowOffset + coordinate : coordinate * width + x;
    value += input[sourceIndex] * kernel.weights[offset + kernel.radius];
  }
  return value;
}

function blurAxis(input, width, height, kernel, horizontal) {
  const output = new Float32Array(input.length);
  const limit = horizontal ? width : height;
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      output[rowOffset + x] = blurAxisValue({
        input,
        width,
        rowOffset,
        x,
        coordinateBase: horizontal ? x : y,
        limit,
        horizontal,
        kernel
      });
    }
  }
  return output;
}

function blurAlpha(alpha, width, height, kernelX, kernelY) {
  const horizontal = blurAxis(alpha, width, height, kernelX, true);
  return blurAxis(horizontal, width, height, kernelY, false);
}

function copySourceAlpha(source, shadowAlpha, width, paddingLeft, shadowOriginY) {
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sourceOffset = (y * source.width + x) * 4;
      shadowAlpha[(shadowOriginY + y) * width + paddingLeft + x] = source.pixels[sourceOffset + 3] / 255;
    }
  }
}

function sourcePixelOffset(source, x, y, paddingLeft, paddingTop) {
  const sourceX = x - paddingLeft;
  const sourceY = y - paddingTop;
  if (sourceX < 0 || sourceX >= source.width || sourceY < 0 || sourceY >= source.height) return -1;
  return (sourceY * source.width + sourceX) * 4;
}

function compositeShadowPixel({ source, pixels, blurredAlpha, x, y, width, paddingLeft, paddingTop }) {
  const outputOffset = (y * width + x) * 4;
  const shadowA = Math.min(1, Math.max(0, blurredAlpha[y * width + x]));
  const sourceOffset = sourcePixelOffset(source, x, y, paddingLeft, paddingTop);
  const sourceA = sourceOffset >= 0 ? source.pixels[sourceOffset + 3] / 255 : 0;
  const outputA = sourceA + shadowA * (1 - sourceA);
  if (outputA <= 0) return;

  for (let channel = 0; channel < 3; channel += 1) {
    const sourceColor = sourceOffset >= 0 ? source.pixels[sourceOffset + channel] : 0;
    const premultiplied = sourceColor * sourceA + shadowColor[channel] * shadowA * (1 - sourceA);
    pixels[outputOffset + channel] = Math.round(premultiplied / outputA);
  }
  pixels[outputOffset + 3] = Math.round(outputA * 255);
}

function bakeShadow(source, sigmaX, sigmaY, offsetY) {
  const kernelX = gaussianKernel(sigmaX);
  const kernelY = gaussianKernel(sigmaY);
  const roundedOffsetY = Math.round(offsetY);
  const paddingLeft = kernelX.radius;
  const paddingRight = kernelX.radius;
  const paddingTop = kernelY.radius + Math.max(0, -roundedOffsetY);
  const paddingBottom = kernelY.radius + Math.max(0, roundedOffsetY);
  const width = source.width + paddingLeft + paddingRight;
  const height = source.height + paddingTop + paddingBottom;
  const shadowAlpha = new Float32Array(width * height);
  const shadowOriginY = paddingTop + roundedOffsetY;
  copySourceAlpha(source, shadowAlpha, width, paddingLeft, shadowOriginY);

  const blurredAlpha = blurAlpha(
    shadowAlpha,
    width,
    height,
    kernelX,
    kernelY,
  );
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      compositeShadowPixel({ source, pixels, blurredAlpha, x, y, width, paddingLeft, paddingTop });
    }
  }

  return {
    width,
    height,
    pixels,
    paddingLeft,
    paddingTop,
  };
}

function number(value) {
  return Number.parseFloat(value);
}

function format(value) {
  return Number(value.toFixed(7)).toString();
}

let svgText = fs.readFileSync(svgPath, "utf8");
const existingSourceManifest = fs.existsSync(sourceManifestPath)
  ? JSON.parse(fs.readFileSync(sourceManifestPath, "utf8"))
  : { schemaVersion: 1, symbols: {} };
if (
  existingSourceManifest.schemaVersion !== 1 ||
  !existingSourceManifest.symbols ||
  typeof existingSourceManifest.symbols !== "object"
) {
  throw new Error("data/tree-icon-shadow-sources.json has an unsupported shape");
}
const sourceManifest = {
  schemaVersion: 1,
  symbols: { ...existingSourceManifest.symbols },
};
const displayBySymbol = new Map();
for (const match of svgText.matchAll(/<use class="node-icon"([^>]+)>/g)) {
  const attributes = match[1];
  const symbolId = attributes.match(/\shref="#([^"]+)"/)?.[1];
  const width = number(attributes.match(/\swidth="([^"]+)"/)?.[1]);
  const height = number(attributes.match(/\sheight="([^"]+)"/)?.[1]);
  if (!symbolId || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Unable to parse node-icon use: ${match[0]}`);
  }
  const prior = displayBySymbol.get(symbolId);
  if (prior && (prior.width !== width || prior.height !== height)) {
    throw new Error(
      `${symbolId} is used at multiple sizes; create distinct source symbols before baking`,
    );
  }
  displayBySymbol.set(symbolId, { width, height });
}

const replacements = [];
const generatedFiles = [];
const symbolPattern = /<symbol id="([^"]+)"([^>]*)>([\s\S]*?)<\/symbol>/g;
for (const match of svgText.matchAll(symbolPattern)) {
  const [symbolBlock, symbolId, symbolAttributes, symbolBody] = match;
  const display = displayBySymbol.get(symbolId);
  if (!display) continue;

  const imageMatch = symbolBody.match(/<image\b[^>]*\/>/);
  if (!imageMatch) {
    throw new Error(`${symbolId} has no image element`);
  }
  const imageTag = imageMatch[0];
  const embeddedSourcePath =
    imageTag.match(/\sdata-shadow-source="([^"]+)"/)?.[1] ||
    imageTag.match(/\shref="(icons\/(?!TreeShadow_)[^"]+\.png)"/)?.[1];
  const manifestRecord = sourceManifest.symbols[symbolId];
  const sourcePath =
    manifestRecord?.path ||
    (embeddedSourcePath ? `site/${embeddedSourcePath}` : null);
  if (
    !sourcePath ||
    !/^(?:site\/icons|assets\/tree-icon-sources)\/[A-Za-z0-9][A-Za-z0-9_.-]*\.png$/.test(
      sourcePath,
    )
  ) {
    throw new Error(`${symbolId} has an unsafe or missing source image path`);
  }
  const sourceFit =
    manifestRecord?.fit ||
    imageTag.match(/\sdata-shadow-source-fit="([^"]+)"/)?.[1] ||
    (
      imageTag.match(/\spreserveAspectRatio="([^"]+)"/)?.[1] === "none"
        ? "none"
        : "meet"
    );
  if (sourceFit !== "none" && sourceFit !== "meet") {
    throw new Error(`${symbolId} uses unsupported source fit ${sourceFit}`);
  }
  if (
    symbolAttributes.match(/\sviewBox="([^"]+)"/)?.[1] !== "0 0 1 1"
  ) {
    throw new Error(`${symbolId} must use viewBox 0 0 1 1`);
  }

  sourceManifest.symbols[symbolId] = {
    path: sourcePath,
    fit: sourceFit,
  };
  const sourceFile = path.resolve(rootDir, ...sourcePath.split("/"));
  if (
    sourceFile !== rootDir &&
    !sourceFile.startsWith(`${rootDir}${path.sep}`)
  ) {
    throw new Error(`${symbolId} resolves outside the repository`);
  }
  const source = decodeRgba8(fs.readFileSync(sourceFile), sourcePath);
  const symbolFitNone =
    symbolAttributes.match(/\spreserveAspectRatio="([^"]+)"/)?.[1] === "none";
  const symbolScaleX = symbolFitNone
    ? display.width
    : Math.min(display.width, display.height);
  const symbolScaleY = symbolFitNone
    ? display.height
    : Math.min(display.width, display.height);

  let sourceX;
  let sourceY;
  let sourcePixelScaleX;
  let sourcePixelScaleY;
  if (sourceFit === "none") {
    sourceX = 0;
    sourceY = 0;
    sourcePixelScaleX = 1 / source.width;
    sourcePixelScaleY = 1 / source.height;
  } else {
    const sourcePixelScale = 1 / Math.max(source.width, source.height);
    const fittedWidth = source.width * sourcePixelScale;
    const fittedHeight = source.height * sourcePixelScale;
    sourceX = (1 - fittedWidth) / 2;
    sourceY = (1 - fittedHeight) / 2;
    sourcePixelScaleX = sourcePixelScale;
    sourcePixelScaleY = sourcePixelScale;
  }

  const sigmaX =
    shadowBlur / Math.max(0.000001, symbolScaleX * sourcePixelScaleX);
  const sigmaY =
    shadowBlur / Math.max(0.000001, symbolScaleY * sourcePixelScaleY);
  const offsetY =
    shadowOffsetY / Math.max(0.000001, symbolScaleY * sourcePixelScaleY);
  const baked = bakeShadow(source, sigmaX, sigmaY, offsetY);
  const targetName = `TreeShadow_${symbolId.replaceAll(/[^A-Za-z0-9_-]/g, "_")}.png`;
  const targetPath = `icons/${targetName}`;
  const targetFile = path.join(siteDir, "icons", targetName);
  const encoded = encodeRgba8(
    source.chunks,
    baked.width,
    baked.height,
    baked.pixels,
  );
  fs.writeFileSync(targetFile, encoded);
  generatedFiles.push(targetPath);

  const imageX = sourceX - baked.paddingLeft * sourcePixelScaleX;
  const imageY = sourceY - baked.paddingTop * sourcePixelScaleY;
  const imageWidth = baked.width * sourcePixelScaleX;
  const imageHeight = baked.height * sourcePixelScaleY;
  const bakedImageTag = imageTag
    .replace(/\sdata-shadow-source="[^"]+"/, "")
    .replace(/\sdata-shadow-source-fit="[^"]+"/, "")
    .replace(/\shref="[^"]+"/, ` href="${targetPath}"`)
    .replace(/\sxlink:href="[^"]+"/, ` xlink:href="${targetPath}"`)
    .replace(/\sx="[^"]+"/, ` x="${format(imageX)}"`)
    .replace(/\sy="[^"]+"/, ` y="${format(imageY)}"`)
    .replace(/\swidth="[^"]+"/, ` width="${format(imageWidth)}"`)
    .replace(/\sheight="[^"]+"/, ` height="${format(imageHeight)}"`)
    .replace(
      /\spreserveAspectRatio="[^"]+"/,
      ' preserveAspectRatio="none"',
    )
    ;
  const openingSymbol = symbolBlock.match(/^<symbol[^>]+>/)[0];
  const bakedOpeningSymbol = /\soverflow=/.test(openingSymbol)
    ? openingSymbol.replace(/\soverflow="[^"]+"/, ' overflow="visible"')
    : openingSymbol.replace(/>$/, ' overflow="visible">');
  const bakedSymbolBlock = symbolBlock
    .replace(openingSymbol, bakedOpeningSymbol)
    .replace(imageTag, bakedImageTag);
  replacements.push([symbolBlock, bakedSymbolBlock]);
}

if (replacements.length !== displayBySymbol.size) {
  throw new Error(
    `Expected ${displayBySymbol.size} baked symbols, generated ${replacements.length}`,
  );
}
for (const [before, after] of replacements) {
  svgText = svgText.replace(before, after);
}
svgText = svgText.replace(
  /\r?\n?<filter id="node-icon-shadow"[\s\S]*?<\/filter>/,
  "",
);
fs.writeFileSync(svgPath, svgText, "utf8");
sourceManifest.symbols = Object.fromEntries(
  Object.entries(sourceManifest.symbols).sort(([left], [right]) =>
    left.localeCompare(right, "en"),
  ),
);
fs.writeFileSync(
  sourceManifestPath,
  `${JSON.stringify(sourceManifest, null, 2)}\n`,
  "utf8",
);

console.log(
  JSON.stringify({
    svg: path.relative(rootDir, svgPath),
    bakedSymbols: replacements.length,
    generatedFiles: generatedFiles.length,
    sourceManifest: path.relative(rootDir, sourceManifestPath),
    shadow: {
      color: "#0b0813",
      blur: shadowBlur,
      offsetY: shadowOffsetY,
    },
  }),
);
