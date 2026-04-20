import { runIngestion } from "./runIngestion.js";

runIngestion().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
