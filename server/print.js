import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const run = promisify(execFile);

// The app runs on the shop's laptop, which is where the Bluetooth printer is
// paired. Browser `window.print()` can only reach printers attached to the
// device it runs on, so a phone tapping Print used to get the phone's own print
// dialog. This module turns the receipt HTML into a PDF with headless Chrome and
// queues it on the laptop's CUPS printer instead.
const CHROME_BIN = process.env.CHROME_BIN || "/usr/bin/google-chrome-stable";
const PRINTER_NAME = process.env.PRINTER_NAME || "Netum58";
const PRINT_TIMEOUT_MS = Number(process.env.PRINT_TIMEOUT_MS) || 45000;

// The printer's PPD offers three fixed media heights: 210mm, 297mm and 3276mm.
// A receipt shorter than the chosen page gets centred vertically by CUPS, which
// pushed 50-150mm of blank paper above the first line. Rendering the page at the
// full 3276mm continuous-roll height and letting the driver trim the trailing
// blank (BlankSpace=NoPrint) keeps the receipt top-aligned and uses only as much
// paper as the ink needs. FeedDist is dropped from 30mm to 3mm for the same
// reason.
const ROLL_MEDIA = "X58mmY3276mm";
const ROLL_HEIGHT_MM = 3276;
const FEED_DIST = "0feed3mm";

const ROLL_PAGE_STYLE = `<style id="__roll-page-58">@page{size:58mm ${ROLL_HEIGHT_MM}mm;margin:0}</style>`;

function withRollPage(html) {
  if (!html || typeof html !== "string") throw new Error("Receipt HTML is required");
  if (html.includes("__roll-page-58")) return html;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${ROLL_PAGE_STYLE}</head>`);
  return html.replace(/<\/body>/i, `${ROLL_PAGE_STYLE}</body>`);
}

async function renderPdf(html, dir) {
  const htmlPath = path.join(dir, "receipt.html");
  const pdfPath = path.join(dir, "receipt.pdf");
  const profileDir = path.join(dir, "chrome-profile");

  await writeFile(htmlPath, withRollPage(html), "utf8");

  await run(
    CHROME_BIN,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--user-data-dir=${profileDir}`,
      "--no-pdf-header-footer",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=4000",
      "--window-size=219,100",
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`
    ],
    { timeout: PRINT_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 }
  );

  return pdfPath;
}

async function queuePdf(pdfPath) {
  const { stdout } = await run(
    "lp",
    [
      "-d",
      PRINTER_NAME,
      "-o",
      `media=${ROLL_MEDIA}`,
      "-o",
      `FeedDist=${FEED_DIST}`,
      "-o",
      "BlankSpace=1NoPrint",
      pdfPath
    ],
    {
      timeout: PRINT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    }
  );
  const match = String(stdout || "").match(/([A-Za-z0-9_.-]+-\d+)/);
  return match ? match[1] : null;
}

export function printerName() {
  return PRINTER_NAME;
}

export async function printReceipt58(html) {
  const dir = await mkdtemp(path.join(tmpdir(), "store-print-"));
  try {
    const pdfPath = await renderPdf(html, dir);
    const job = await queuePdf(pdfPath);
    return { printer: PRINTER_NAME, job };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
