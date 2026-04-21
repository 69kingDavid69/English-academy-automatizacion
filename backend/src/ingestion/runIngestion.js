import { readdir, readFile } from "fs/promises";
import { resolve, extname, basename } from "path";
import { ChromaClient } from "chromadb";
import { chunkText } from "./chunker.js";
import { config } from "../config/env.js";
import { paths } from "../config/paths.js";
import { generateEmbeddings, warmupEmbeddings } from "../services/embeddings.js";
const SUPPORTED_EXTENSIONS = [".txt", ".md"];

function createLogger(logger) {
  if (!logger) {
    return {
      info: (message) => console.log(message),
      warn: (message) => console.warn(message),
      error: (message) => console.error(message),
    };
  }

  if (typeof logger === "function") {
    return { info: logger, warn: logger, error: logger };
  }

  return {
    info: (message, meta) => logger.info ? logger.info(message, meta) : console.log(message, meta || ""),
    warn: (message, meta) => logger.warn ? logger.warn(message, meta) : console.warn(message, meta || ""),
    error: (message, meta) => logger.error ? logger.error(message, meta) : console.error(message, meta || ""),
  };
}

function createChromaClient() {
  const chromaUrl = new URL(
    config.chroma.url.startsWith("http") ? config.chroma.url : `http://${config.chroma.url}`
  );
  console.log(`Connecting to ChromaDB server at ${chromaUrl.hostname}:${chromaUrl.port}`);
  return new ChromaClient({
    host: chromaUrl.hostname,
    port: parseInt(chromaUrl.port) || 8000,
    ssl: chromaUrl.protocol === "https:",
  });
}

async function loadEmbeddingModel(log) {
  log.info("Loading embedding model...");
  await warmupEmbeddings();
  log.info("Embedding function ready.");
}

async function embed(texts) {
  return await generateEmbeddings(texts);
}

async function loadDocuments(log) {
  const files = await readdir(paths.documentsDir);
  const docs = [];

  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) continue;

    const fullPath = resolve(paths.documentsDir, file);
    const content = await readFile(fullPath, "utf-8");
    docs.push({ name: basename(file, ext), content });
    log.info(`Loaded: ${file} (${content.length} chars)`);
  }

  return docs;
}

async function getExistingCollection(client) {
  try {
    return await client.getCollection({ name: config.chroma.collection });
  } catch {
    return null;
  }
}

async function collectionCount(collection) {
  if (!collection) return 0;
  if (typeof collection.count !== "function") return 0;
  return collection.count();
}

export async function runIngestion({
  resetCollection = true,
  skipIfPopulated = false,
  logger,
} = {}) {
  const log = createLogger(logger);
  log.info("=== Academy RAG Ingestion Pipeline ===");

  const documents = await loadDocuments(log);
  if (documents.length === 0) {
    throw new Error(`No documents found in ${paths.documentsDir}`);
  }

  const allChunks = [];
  for (const doc of documents) {
    const chunks = chunkText(doc.content, doc.name);
    log.info(`Chunked "${doc.name}": ${chunks.length} chunks`);
    allChunks.push(...chunks);
  }
  log.info(`Total chunks to index: ${allChunks.length}`);

  const client = createChromaClient();

  if (skipIfPopulated) {
    const existing = await getExistingCollection(client);
    const existingCount = await collectionCount(existing);

    if (existingCount > 0) {
      log.info("Knowledge base already indexed. Skipping ingestion.", {
        collection: config.chroma.collection,
        existingCount,
      });
      return { skipped: true, chunkCount: existingCount };
    }
  }

  if (resetCollection) {
    try {
      await client.deleteCollection({ name: config.chroma.collection });
      log.info(`Deleted existing collection: ${config.chroma.collection}`);
    } catch {
      // Collection did not exist yet
    }
  }

  let collection = await getExistingCollection(client);
  if (!collection) {
    collection = await client.createCollection({
      name: config.chroma.collection,
      metadata: { "hnsw:space": "cosine" },
    });
    log.info(`Created collection: ${config.chroma.collection}`);
  }

  await loadEmbeddingModel(log);
  const batchSize = 32;

  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    const texts = batch.map((chunk) => chunk.text);
    const embeddings = await embed(texts);

    await collection.upsert({
      ids: batch.map((chunk) => chunk.id),
      embeddings,
      documents: texts,
      metadatas: batch.map((chunk) => chunk.metadata),
    });

    log.info(
      `Indexed chunks ${i + 1}-${Math.min(i + batchSize, allChunks.length)} / ${allChunks.length}`
    );
  }

  log.info("Ingestion complete. Vector store is ready.");
  return { skipped: false, chunkCount: allChunks.length };
}

export async function ensureKnowledgeBase(options = {}) {
  return runIngestion({
    resetCollection: false,
    skipIfPopulated: true,
    ...options,
  });
}
