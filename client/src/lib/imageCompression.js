const MAX_DIMENSION = 1800;
const PRESERVE_BYTES = 400 * 1024;
const TARGET_BYTES = 900 * 1024;
const QUALITY_STEPS = [0.72, 0.62, 0.52, 0.42];

function dataUrlBytes(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return dataUrl.length;
  return Math.floor((dataUrl.slice(comma + 1).length * 3) / 4);
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = src;
  });
}

export async function compressBillImage(file) {
  const original = await readAsDataUrl(file);
  if (!/^data:image\/(png|jpe?g|webp|gif|bmp);base64,/i.test(original)) return original;
  if (dataUrlBytes(original) <= PRESERVE_BYTES) return original;

  try {
    const img = await loadImage(original);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return original;

    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    let best = "";
    for (const quality of QUALITY_STEPS) {
      best = canvas.toDataURL("image/jpeg", quality);
      if (dataUrlBytes(best) <= TARGET_BYTES) break;
    }
    return dataUrlBytes(best) < dataUrlBytes(original) ? best : original;
  } catch {
    return original;
  }
}
