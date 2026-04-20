import { ChromaClient } from "chromadb";
import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";
import { config } from "../config/env.js";
import { logger } from "../middleware/logger.js";

// Default embedding function for ChromaDB
const defaultEmbedder = new DefaultEmbeddingFunction();

let collection = null;
let chromaClient = null;

/**
 * Exponential backoff retry helper
 */
async function retryWithBackoff(operation, maxRetries = 5, baseDelay = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) break;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      logger.warn(`ChromaDB operation failed, retrying in ${delay}ms`, {
        attempt,
        maxRetries,
        error: err.message,
      });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function buildChromaClient() {
  const url = new URL(config.chroma.url.startsWith("http") ? config.chroma.url : `http://${config.chroma.url}`);
  return new ChromaClient({
    host: url.hostname,
    port: parseInt(url.port) || 8000,
    ssl: url.protocol === "https:",
  });
}

async function getCollection() {
  if (!collection) {
    await initializeChroma();
  }
  return collection;
}

async function initializeChroma() {
  try {
    chromaClient = buildChromaClient();
    
    // Log connection details (without sensitive info)
    const url = new URL(config.chroma.url.startsWith("http") ? config.chroma.url : `http://${config.chroma.url}`);
    logger.info(`Connecting to ChromaDB at ${url.hostname}:${url.port}...`);
    
    // Test connection with retry
    await retryWithBackoff(async () => {
      logger.info("Testing ChromaDB connection...");
      try {
        const heartbeat = await chromaClient.heartbeat();
        logger.info(`ChromaDB heartbeat successful: ${heartbeat}`);
      } catch (heartbeatErr) {
        logger.warn(`ChromaDB heartbeat failed: ${heartbeatErr.message}`);
        // Try alternative connection test
        await chromaClient.listCollections();
        logger.info("ChromaDB listCollections successful");
      }
    }, 3, 2000);
    
    logger.info("ChromaDB connected, getting or creating collection...");
    
    // Get or create collection with retry
    collection = await retryWithBackoff(async () => {
      const col = await chromaClient.getOrCreateCollection({
        name: config.chroma.collection,
        embeddingFunction: defaultEmbedder,
      });
      
      // Check if collection has documents
      const count = await col.count();
      logger.info(`Collection '${config.chroma.collection}' has ${count} documents`);
      
      return col;
    }, 3, 1000);
    
    logger.info(`ChromaDB collection '${config.chroma.collection}' ready`);
  } catch (err) {
    logger.error("Failed to initialize ChromaDB", { 
      error: err.message,
      url: config.chroma.url,
      collection: config.chroma.collection
    });
    throw new Error(`Vector store unavailable: ${err.message}`);
  }
}

async function embedQuery(text) {
  // Use ChromaDB's default embedding function
  const embeddings = await defaultEmbedder.generate([text]);
  const embedding = embeddings[0];
  // Ensure embedding is a flat array of numbers
  return Array.isArray(embedding) ? embedding.flat() : embedding;
}

/**
 * Retrieves candidate chunks from ChromaDB.
 * Fetches (topK * 2) candidates to give the re-ranker enough to work with,
 * then filters by similarity threshold.
 *
 * Returns raw chunks sorted by similarity descending.
 */
export async function retrieve(query) {
  // Fetch more candidates than needed — re-ranker will trim to topK
  const fetchCount = config.rag.topK * 2;

  const col = await getCollection().catch((err) => {
    logger.error("ChromaDB connection failed", { error: err.message });
    throw new Error("Vector store unavailable. Please try again later.");
  });

  const queryEmbedding = await embedQuery(query);

  const results = await col.query({
    queryEmbeddings: [queryEmbedding],
    nResults: fetchCount,
    include: ["documents", "metadatas", "distances"],
  });

  const docs = results.documents[0] || [];
  const distances = results.distances[0] || [];
  const metas = results.metadatas[0] || [];

  const chunks = [];

  for (let i = 0; i < docs.length; i++) {
    if (!docs[i] || docs[i].trim().length === 0) continue;

    // ChromaDB cosine distance: 0 = identical, 2 = opposite
    // Convert: similarity = 1 - (distance / 2)
    const similarity = 1 - distances[i] / 2;

    // Apply hard threshold — discard clearly irrelevant chunks before re-ranking
    if (similarity >= config.rag.similarityThreshold) {
      chunks.push({
        text: docs[i].trim(),
        similarity,
        source: metas[i]?.source || "unknown",
        chunkIndex: metas[i]?.chunkIndex ?? i,
      });
    }
  }

  // Sort by similarity descending before handing to re-ranker
  chunks.sort((a, b) => b.similarity - a.similarity);

  return chunks;
}

/**
 * Builds a structured context string from ranked chunks.
 * Uses numbered sections for clarity — helps the LLM cite sections.
 */
export function buildContext(chunks) {
  if (chunks.length === 0) return "";

  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] Source: ${c.source} | Score: ${(c.rerankScore ?? c.similarity * 100).toFixed ? (c.rerankScore ? (c.rerankScore * 100).toFixed(0) : (c.similarity * 100).toFixed(0)) : "N/A"}%\n${c.text}`
    )
    .join("\n\n---\n\n");
}

/**
 * Estimates token count for a text string.
 * Approximation: 1 token ≈ 4 characters.
 */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Trims context to stay within a maximum token budget.
 * Drops lower-ranked chunks first.
 */
export function trimContextToTokenLimit(chunks, maxTokens = 1800) {
  const kept = [];
  let total = 0;

  for (const chunk of chunks) {
    const tokens = estimateTokens(chunk.text);
    if (total + tokens > maxTokens) break;
    kept.push(chunk);
    total += tokens;
  }

  return { chunks: kept, totalTokens: total };
}

export function resetCollection() {
  collection = null;
}
