import { CHUNK_OVERLAP, CHUNK_SIZE } from "./config";
import type { Chunk } from "./types";

/**
 * Split text into overlapping chunks, preferring paragraph and sentence
 * boundaries over a fixed character count.
 *
 * The overlap matters more than people expect. Without it, a sentence that
 * straddles a boundary is split across two chunks and neither one retrieves
 * well, so the answer that depends on it simply never surfaces.
 */
export function splitText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length === 0) return [];
  if (clean.length <= size) return [clean];

  if (overlap >= size) {
    throw new Error("overlap must be smaller than size, otherwise chunking never advances");
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);

    // Prefer to cut at a paragraph break, then a sentence end, then a space.
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const breakAt = lastBreak(window);
      if (breakAt > size * 0.5) {
        end = start + breakAt;
      }
    }

    const piece = clean.slice(start, end).trim();
    if (piece.length > 0) chunks.push(piece);

    if (end >= clean.length) break;
    start = end - overlap;
  }

  return chunks;
}

function lastBreak(window: string): number {
  const paragraph = window.lastIndexOf("\n\n");
  if (paragraph > 0) return paragraph + 2;

  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
  );
  if (sentence > 0) return sentence + 2;

  const space = window.lastIndexOf(" ");
  return space > 0 ? space + 1 : -1;
}

/**
 * Build chunks with deterministic ids.
 *
 * The id is a hash of tenant, document, position and content, which makes
 * ingestion idempotent: re-ingesting an unchanged document overwrites the same
 * vectors instead of creating duplicates that then compete with each other at
 * query time. Edit one paragraph and only that chunk's id changes.
 */
export async function buildChunks(tenant: string, docId: string, text: string): Promise<Chunk[]> {
  const pieces = splitText(text);

  return Promise.all(
    pieces.map(async (piece, index) => ({
      id: await chunkId(tenant, docId, index, piece),
      text: piece,
      docId,
      index,
    })),
  );
}

export async function chunkId(
  tenant: string,
  docId: string,
  index: number,
  text: string,
): Promise<string> {
  const payload = `${tenant}\u0000${docId}\u0000${index}\u0000${text}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));

  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}
