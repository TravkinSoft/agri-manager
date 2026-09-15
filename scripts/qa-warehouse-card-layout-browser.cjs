const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.join(__dirname, "..");
const cssDir = path.join(root, ".next/static/css");
const cssFiles = fs.readdirSync(cssDir).filter((file) => file.endsWith(".css"));
const links = cssFiles.map((file) => `<link rel="stylesheet" href="/css/${file}">`).join("");
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${links}</head><body><main class="flex flex-col px-3" style="height:850px"><div class="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[repeat(auto-fill,240px)]"><article id="card" class="h-24 rounded-lg border">Мельница</article><article class="h-24 rounded-lg border">Погреб</article></div><footer id="footer" class="tf-desktop-footer hidden border-t text-center text-xs md:block sticky bottom-0 z-20 mt-auto py-2">Copyright</footer></main></body></html>`;

async function main() {
  const server = http.createServer((request, response) => {
    if (request.url === "/") return response.end(html);
    const file = path.join(cssDir, path.basename(request.url || ""));
    if (!fs.existsSync(file)) { response.statusCode = 404; return response.end(); }
    response.setHeader("Content-Type", "text/css");
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(3201, "127.0.0.1", resolve));
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await desktop.goto("http://127.0.0.1:3201");
    const card = await desktop.locator("#card").boundingBox();
    const footer = await desktop.locator("#footer").boundingBox();
    assert.equal(Math.round(card.width), 240);
    assert.equal(Math.round(footer.y + footer.height), 850);

    const mobile = await browser.newPage({ viewport: { width: 360, height: 780 } });
    await mobile.goto("http://127.0.0.1:3201");
    const mobileCard = await mobile.locator("#card").boundingBox();
    assert.equal(Math.round(mobileCard.width), 336);
    assert.equal(await mobile.locator("#footer").isVisible(), false);
    console.log("Warehouse card layout PASS");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
