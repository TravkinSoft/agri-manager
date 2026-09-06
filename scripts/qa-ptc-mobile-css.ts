import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import config from "../tailwind.config";

async function main() {
  const files = [
    "app/(dashboard)/traffic/page.tsx",
    "app/traffic-operator/page.tsx",
    "components/traffic/traffic-board.tsx",
  ];
  const result = await postcss([
    tailwindcss({
      ...config,
      content: files.map((file) => ({
        raw: readFileSync(file, "utf8"),
        extension: "tsx",
      })),
    }),
  ]).process("@tailwind utilities;", { from: undefined });
  const css = result.css;
  for (const pattern of [
    /min-height:\s*48px/,
    /min-height:\s*100dvh/,
    /max-height:\s*calc\(100dvh - 2rem\)/,
    /width:\s*calc\(100% - 2rem\)/,
    /font-size:\s*1rem/,
    /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/,
    /background-color:\s*rgb\(251 113 133/,
    /safe-area-inset-bottom/,
    /safe-area-inset-top/,
  ])
    assert.match(css, pattern);
  console.log(
    "PTC generated Tailwind mobile CSS PASS: 9 actual compiled rules. Browser DOM measurements are a separate gate.",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
