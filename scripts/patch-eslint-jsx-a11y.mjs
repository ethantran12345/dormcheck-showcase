/**
 * Keep eslint-plugin-jsx-a11y 6.10.2 compatible with the patched minimatch 10 line.
 *
 * The upstream plugin still requests minimatch 3, whose brace-expansion dependency has
 * no patched release. This small compatibility patch switches its only two callable
 * minimatch uses to minimatch 10's named export. It fails closed whenever upstream
 * changes the plugin package or either compiled source shape.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const checkOnly = process.argv.includes("--check");
const pluginRoot = new URL("../node_modules/eslint-plugin-jsx-a11y/", import.meta.url);
const packagePath = new URL("package.json", pluginRoot);
const files = [
  "lib/util/mayContainChildComponent.js",
  "lib/util/mayHaveAccessibleLabel.js",
];

const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
if (packageJson.version !== "6.10.2") {
  throw new Error(
    `eslint-plugin-jsx-a11y compatibility patch only supports 6.10.2; found ${packageJson.version}.`,
  );
}

for (const relativePath of files) {
  const target = new URL(relativePath, pluginRoot);
  const original = await readFile(target, "utf8");
  const patched = original
    .replace(
      'var _minimatch = _interopRequireDefault(require("minimatch"));',
      'var _minimatch = require("minimatch");',
    )
    .replaceAll('_minimatch["default"]', "_minimatch.minimatch");

  if (patched === original) {
    if (!original.includes("_minimatch.minimatch")) {
      throw new Error(`Unexpected jsx-a11y source shape: ${fileURLToPath(target)}.`);
    }
    continue;
  }

  if (checkOnly) {
    throw new Error(`jsx-a11y compatibility patch is missing: ${fileURLToPath(target)}.`);
  }

  await writeFile(target, patched);
}

if (!checkOnly) {
  console.log("Applied eslint-plugin-jsx-a11y minimatch 10 compatibility patch.");
}
