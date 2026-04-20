import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const currentDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(currentDir, "..");
const backendDir = resolve(srcDir, "..");

export const paths = {
  adminDir: resolve(backendDir, "public/admin"),
  backendDir,
  documentsDir: resolve(backendDir, "documents"),
  publicDir: resolve(backendDir, "public"),
  siteDir: resolve(backendDir, "public/site"),
  widgetDir: resolve(backendDir, "public/widget"),
};
