import { config } from "../config/env.js";

/**
 * Splits text into overlapping chunks for RAG indexing.
 * Uses paragraph-aware splitting before falling back to character-level splitting.
 */
export function chunkText(text, source) {
  const { chunkSize, chunkOverlap } = config.rag;
  const chunks = [];

  // Normalize line endings and collapse excessive blank lines
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  // Split on double newlines (paragraphs) first
  const paragraphs = normalized.split(/\n\n+/);
  let buffer = "";

  for (const paragraph of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;

    if (candidate.length <= chunkSize) {
      buffer = candidate;
    } else {
      if (buffer.length > 0) {
        chunks.push(createChunk(buffer.trim(), source, chunks.length));
      }
      // If a single paragraph exceeds chunkSize, split it by sentences
      if (paragraph.length > chunkSize) {
        const subChunks = splitBySentences(paragraph, chunkSize, chunkOverlap, source, chunks.length);
        chunks.push(...subChunks);
        buffer = "";
      } else {
        buffer = paragraph;
      }
    }
  }

  if (buffer.length > 0) {
    chunks.push(createChunk(buffer.trim(), source, chunks.length));
  }

  // Add overlap: prepend tail of previous chunk to current chunk's content
  return applyOverlap(chunks, chunkOverlap);
}

function splitBySentences(text, chunkSize, overlap, source, startIndex) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks = [];
  let buffer = "";

  for (const sentence of sentences) {
    const candidate = buffer ? `${buffer} ${sentence}` : sentence;
    if (candidate.length <= chunkSize) {
      buffer = candidate;
    } else {
      if (buffer.length > 0) {
        chunks.push(createChunk(buffer.trim(), source, startIndex + chunks.length));
      }
      buffer = sentence;
    }
  }

  if (buffer.length > 0) {
    chunks.push(createChunk(buffer.trim(), source, startIndex + chunks.length));
  }

  return chunks;
}

function applyOverlap(chunks, overlapSize) {
  if (chunks.length <= 1) return chunks;

  return chunks.map((chunk, i) => {
    if (i === 0) return chunk;
    const prev = chunks[i - 1].text;
    const tail = prev.slice(-overlapSize);
    return {
      ...chunk,
      text: `${tail}\n${chunk.text}`.trim(),
    };
  });
}

function createChunk(text, source, index) {
  return {
    id: `${source}_chunk_${index}`,
    text,
    metadata: {
      source,
      chunkIndex: index,
      charCount: text.length,
    },
  };
}
