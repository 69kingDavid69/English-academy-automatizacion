import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config/env.js";
import { logger, requestLogger } from "./middleware/logger.js";
import { paths } from "./config/paths.js";
import adminRouter from "./routes/admin.js";
import apiRouter from "./routes/api.js";
import siteRouter from "./routes/site.js";
import { setupTelegram } from "./routes/telegram.js";
const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "https:"],
    },
  },
}));

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-admin-token", "Authorization"],
  credentials: false,
}));

app.use(express.json({ limit: "1mb" }));
app.use(requestLogger);

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});
app.use("/api", limiter);

// Static frontend
app.get("/admin", (req, res) => {
  res.sendFile(`${paths.adminDir}/index.html`);
});

app.use("/admin", express.static(paths.adminDir));

app.get("/widget", (req, res) => {
  res.sendFile(`${paths.widgetDir}/index.html`);
});

app.use("/widget", express.static(paths.widgetDir));

// API routes
app.use("/api/admin", adminRouter);
app.use("/api", apiRouter);
app.use("/", siteRouter);

// Telegram routes must be registered before the catch-all 404 handler.
setupTelegram(app);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error("Unhandled error", { error: err.message, stack: err.stack });
  res.status(500).json({ error: "Internal server error" });
});

export default app;
