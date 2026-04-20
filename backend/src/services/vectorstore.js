import { ChromaClient } from "chromadb";
import { pipeline } from "@xenova/transformers";
import { config } from "../config/env.js";
import { logger } from "../middleware/logger.js";

let extractor = null;
let collection = null;
let chromaClient = null;

async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return extractor;
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
    chromaClient = buildChromaClient();
    collection = await chromaClient.getCollection({ name: config.chroma.collection });
  }
  return collection;
}

async function embedQuery(text) {
  const model = await getExtractor();
  const output = await model([text], { pooling: "mean", normalize: true });
  return Array.from(output[0].data);
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
