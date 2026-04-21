import { mkdir, rm } from "fs/promises";
import { resolve } from "path";
import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";
import { env as transformersEnv } from "@huggingface/transformers";
import { logger } from "../middleware/logger.js";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";
const CACHE_DIR = process.env.TRANSFORMERS_CACHE_DIR || "/tmp/transformers-cache";
const CORRUPTED_MODEL_REGEX = /protobuf parsing failed|load model from .*model\.onnx failed/i;

transformersEnv.cacheDir = CACHE_DIR;
transformersEnv.useFSCache = true;
transformersEnv.useBrowserCache = false;

let embedder = null;
let initPromise = null;

function getModelCachePath() {
  return resolve(CACHE_DIR, EMBEDDING_MODEL);
}

function createEmbedder() {
  return new DefaultEmbeddingFunction({ modelName: EMBEDDING_MODEL });
}

async function initializeEmbedder() {
  await mkdir(CACHE_DIR, { recursive: true });
  const instance = createEmbedder();
  await instance.generate(["embedding warmup"]);
  embedder = instance;
  logger.info("Embedding model initialized", {
    model: EMBEDDING_MODEL,
    cacheDir: CACHE_DIR,
  });
  return embedder;
}

async function getEmbedder() {
  if (embedder) return embedder;

  if (!initPromise) {
    initPromise = initializeEmbedder().finally(() => {
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
  embedder = null;
  await rm(modelCachePath, { recursive: true, force: true });
  logger.warn("Deleted corrupted embedding cache", {
    model: EMBEDDING_MODEL,
    modelCachePath,
  });
}

export async function warmupEmbeddings() {
  await getEmbedder();
}

export async function generateEmbeddings(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  try {
    const instance = await getEmbedder();
    return await instance.generate(texts);
  } catch (err) {
    if (!isCorruptedModelError(err)) {
      throw err;
    }

    logger.warn("Embedding model load failed. Resetting cache and retrying once.", {
      error: err.message,
    });

    await resetModelCache();
    const recovered = await getEmbedder();
    return await recovered.generate(texts);
  }
}
