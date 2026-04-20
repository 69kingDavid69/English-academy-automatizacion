import { Router } from "express";
import express from "express";
import { paths } from "../config/paths.js";

const router = Router();

// Serve landing page static assets
router.use("/site", express.static(paths.siteDir));

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
