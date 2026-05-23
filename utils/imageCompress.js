const path = require('path');
const fs = require('fs');

let sharpModule = null;

function getSharp() {
  if (!sharpModule) {
    try {
      sharpModule = require('sharp');
    } catch (e) {
      sharpModule = false;
    }
  }
  return sharpModule || null;
}

/**
 * Compress an image buffer and write JPEG to destPath.
 * Falls back to writing the original buffer if sharp is unavailable.
 */
async function compressImageToJpeg(inputBuffer, destPath, { maxWidth = 1600, quality = 82 } = {}) {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sharp = getSharp();
  if (sharp) {
    await sharp(inputBuffer)
      .rotate()
      .resize({ width: maxWidth, withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toFile(destPath);
    return destPath;
  }

  fs.writeFileSync(destPath, inputBuffer);
  return destPath;
}

module.exports = { compressImageToJpeg, getSharp };
