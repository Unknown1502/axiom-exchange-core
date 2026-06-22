/**
 * Render docs/architecture-diagram.svg to a PNG raster (for submission upload).
 * Keeps the PNG in sync with the SVG source — re-run after editing the SVG.
 *
 * Usage: `npx tsx scripts/render-diagram.ts`
 */

import { readFileSync, statSync } from 'node:fs';
import sharp from 'sharp';

const SVG_PATH = 'docs/architecture-diagram.svg';
const PNG_PATH = 'docs/architecture-diagram.png';

const svg = readFileSync(SVG_PATH);
await sharp(svg, { density: 200 }).png().toFile(PNG_PATH);
console.log(`Rendered ${PNG_PATH} (${statSync(PNG_PATH).size} bytes) from ${SVG_PATH}`);
