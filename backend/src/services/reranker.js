/**
 * Lightweight re-ranker for retrieved chunks.
 *
 * Combines two signals into a final relevance score:
 *   - Vector similarity (from ChromaDB cosine distance)
 *   - Keyword overlap ratio (BM25-inspired, zero cost)
 *
 * Final score = (SIMILARITY_WEIGHT * similarity) + (KEYWORD_WEIGHT * keywordScore)
 *
 * This avoids an extra LLM call while still improving chunk ordering
 * significantly for domain-specific queries.
 */

const SIMILARITY_WEIGHT = 0.65;
const KEYWORD_WEIGHT = 0.35;

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "to", "of", "in",
  "on", "at", "for", "with", "about", "by", "from", "up", "into",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us",
  "my", "your", "his", "its", "our", "their", "what", "how", "when",
  "where", "who", "which", "that", "this", "these", "those", "and",
  "or", "but", "if", "so", "as", "not", "no", "yes",
]);

function extractKeywords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function keywordOverlapScore(queryKeywords, chunkText) {
  if (queryKeywords.length === 0) return 0;
  const chunkLower = chunkText.toLowerCase();
  const matched = queryKeywords.filter((kw) => chunkLower.includes(kw)).length;
  return matched / queryKeywords.length;
}

/**
 * Re-ranks chunks by combined similarity + keyword overlap score.
 * Also deduplicates chunks that are too similar to each other.
 *
 * @param {string} query
 * @param {Array<{text, similarity, source}>} chunks
 * @param {number} maxChunks - maximum chunks to keep after re-ranking
 * @returns {Array<{text, similarity, source, rerankScore}>}
 */
export function rerank(query, chunks, maxChunks = 4) {
  if (chunks.length === 0) return [];

  const queryKeywords = extractKeywords(query);

  // Step 1: Score each chunk
  const scored = chunks.map((chunk) => {
    const kw = keywordOverlapScore(queryKeywords, chunk.text);
    const rerankScore = SIMILARITY_WEIGHT * chunk.similarity + KEYWORD_WEIGHT * kw;
    return { ...chunk, keywordScore: kw, rerankScore };
  });

  // Step 2: Sort by final score descending
  scored.sort((a, b) => b.rerankScore - a.rerankScore);

  // Step 3: Deduplicate - remove chunks that share >70% content with a higher-ranked chunk
  const deduplicated = [];
  for (const chunk of scored) {
    const isDuplicate = deduplicated.some(
      (kept) => jaccardSimilarity(chunk.text, kept.text) > 0.70
    );
    if (!isDuplicate) deduplicated.push(chunk);
    if (deduplicated.length >= maxChunks) break;
  }

  return deduplicated;
}

function jaccardSimilarity(textA, textB) {
  const setA = new Set(extractKeywords(textA));
  const setB = new Set(extractKeywords(textB));
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = new Set([...setA].filter((w) => setB.has(w)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * Computes retrieval statistics for observability and escalation decisions.
 */
export function computeRetrievalStats(chunks) {
  if (chunks.length === 0) {
    return { count: 0, topScore: 0, avgScore: 0, minScore: 0, spreadScore: 0 };
  }

  const scores = chunks.map((c) => c.similarity);
  const topScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const avgScore = scores.reduce((s, v) => s + v, 0) / scores.length;
  const spreadScore = topScore - minScore; // high spread = mixed relevance

  return {
    count: chunks.length,
    topScore: +topScore.toFixed(4),
    avgScore: +avgScore.toFixed(4),
    minScore: +minScore.toFixed(4),
    spreadScore: +spreadScore.toFixed(4),
  };
}
