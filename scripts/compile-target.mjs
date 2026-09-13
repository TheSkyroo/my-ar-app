// Compile an image into a MindAR .mind target using a headless browser.
// Usage: node scripts/compile-target.mjs [inputImage] [outputMind]
//   defaults: public/targets/card.png -> public/targets/card.mind
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

const COMPILER_SRC =
  "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js";

const root = process.cwd();
const inputPath = path.resolve(root, process.argv[2] || "public/targets/card.png");
const outputPath = path.resolve(root, process.argv[3] || "public/targets/card.mind");

const ext = path.extname(inputPath).slice(1).toLowerCase();
const mime = ext === "jpg" ? "jpeg" : ext || "png";

console.log(`> reading ${inputPath}`);
const imgBase64 = (await readFile(inputPath)).toString("base64");
const dataUrl = `data:image/${mime};base64,${imgBase64}`;

console.log("> launching headless browser…");
const browser = await puppeteer.launch({
  headless: "new",
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
  ],
});

try {
  const page = await browser.newPage();
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.startsWith("progress:")) process.stdout.write(`\r  ${t}   `);
  });
  page.on("pageerror", (e) => console.error("page error:", e.message));

  // Serve from a real https origin so the ES-module + its relative chunk
  // imports resolve. about:blank can't host module scripts with bare URLs.
  await page.goto("https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/", {
    waitUntil: "domcontentloaded",
  });
  await page.addScriptTag({ url: COMPILER_SRC, type: "module" });
  await page.waitForFunction(() => !!window.MINDAR?.IMAGE?.Compiler, {
    timeout: 60000,
  });

  console.log("> compiling (this can take a minute)…");
  const base64 = await page.evaluate(async (dataUrl) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error("image load failed"));
      img.src = dataUrl;
    });

    const compiler = new window.MINDAR.IMAGE.Compiler();
    await compiler.compileImageTargets([img], (p) =>
      console.log("progress:" + Math.round(p) + "%")
    );
    const buf = await compiler.exportData();
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++)
      binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }, dataUrl);

  const out = Buffer.from(base64, "base64");
  await writeFile(outputPath, out);
  console.log(`\n> wrote ${outputPath} (${out.length} bytes)`);
} finally {
  await browser.close();
}
