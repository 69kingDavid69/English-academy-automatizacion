import { Router } from "express";
import { paths } from "../config/paths.js";

const router = Router();

// Landing page at root
router.get("/", (req, res) => {
  res.sendFile(`${paths.siteDir}/index.html`);
});

router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

export default router;
