import { mkdir, rm } from "fs/promises";
import { resolve } from "path";
import { env as transformersEnv, pipeline } from "@huggingface/transformers";
import { logger } from "../middleware/logger.js";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DTYPE = process.env.EMBEDDING_DTYPE || "q8";
const CACHE_DIR = process.env.TRANSFORMERS_CACHE_DIR || "/tmp/transformers-cache";
const CORRUPTED_MODEL_REGEX = /protobuf parsing failed|load model from .*model\.onnx failed/i;

transformersEnv.cacheDir = CACHE_DIR;
transformersEnv.useFSCache = true;
transformersEnv.useBrowserCache = false;

let extractor = null;
let initPromise = null;

function getModelCachePath() {
  return resolve(CACHE_DIR, EMBEDDING_MODEL);
}

async function initializeExtractor() {
  await mkdir(CACHE_DIR, { recursive: true });

  const instance = await pipeline("feature-extraction", EMBEDDING_MODEL, {
    dtype: EMBEDDING_DTYPE,
  });

  await instance(["embedding warmup"], {
    pooling: "mean",
    normalize: true,
  });

  extractor = instance;
  logger.info("Embedding model initialized", {
    model: EMBEDDING_MODEL,
    dtype: EMBEDDING_DTYPE,
    cacheDir: CACHE_DIR,
  });
  return extractor;
}

async function getExtractor() {
  if (extractor) return extractor;

  if (!initPromise) {
    initPromise = initializeExtractor().finally(() => {
      initPromise = null;
    });
  }

  return initPromise;
}

function isCorruptedModelError(err) {
  const message = String(err?.message || err || "");
  return CORRUPTED_MODEL_REGEX.test(message);
}

async function resetModelCache() {
  const modelCachePath = getModelCachePath();
  extractor = null;
  await rm(modelCachePath, { recursive: true, force: true });
  logger.warn("Deleted corrupted embedding cache", {
    model: EMBEDDING_MODEL,
    modelCachePath,
  });
}

export async function warmupEmbeddings() {
  await getExtractor();
}

async function runEmbedding(texts) {
  const model = await getExtractor();
  const output = await model(texts, {
    pooling: "mean",
    normalize: true,
  });
  return output.tolist();
}

export async function generateEmbeddings(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  try {
    return await runEmbedding(texts);
  } catch (err) {
    if (!isCorruptedModelError(err)) {
      throw err;
    }

    logger.warn("Embedding model load failed. Resetting cache and retrying once.", {
      error: err.message,
    });

    await resetModelCache();
    return await runEmbedding(texts);
  }
}
