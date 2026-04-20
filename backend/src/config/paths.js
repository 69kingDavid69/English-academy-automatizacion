import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const currentDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(currentDir, "..");
const backendDir = resolve(srcDir, "..");
const rootDir = resolve(backendDir, "..");
const frontendDir = resolve(rootDir, "frontend");

export const paths = {
  adminDir: resolve(frontendDir, "admin"),
  backendDir,
  documentsDir: resolve(backendDir, "documents"),
  frontendDir,
  siteDir: resolve(frontendDir, "site"),
  widgetDir: resolve(frontendDir, "widget"),
};
