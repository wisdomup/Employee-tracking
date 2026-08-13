import { Product } from '../services/productService';

/**
 * Client-side product lookup for the warehouse entry screens.
 *
 * The products endpoint returns the whole catalogue in one unpaginated call, so every screen that
 * needs "find me a product" already has the full list in memory. Before this, the only search was
 * react-select's own substring filter over a `name (barcode)` label, rebuilt per row — which is
 * both slow at 100+ rows and unable to rank an exact barcode above an incidental substring hit.
 *
 * Deliberately dependency-free: the ranking below is a few string comparisons over a prebuilt
 * array, which is cheaper than fuse.js on catalogues of this size and keeps the scoring legible.
 */

/** Lowercased, whitespace-trimmed. Used for name comparisons. */
function normalizeText(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Lowercased with every non-alphanumeric stripped. Used for barcodes so that a code typed with
 * spaces or dashes still matches the stored one.
 */
function normalizeCode(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface IndexEntry {
  product: Product;
  /** Normalized product name. */
  name: string;
  /** Normalized barcode, alphanumerics only. */
  code: string;
  /** `name barcode`, normalized — what a free-text query is matched against. */
  haystack: string;
}

export interface ProductIndex {
  products: Product[];
  entries: IndexEntry[];
  /** Normalized barcode -> product. First occurrence wins if the catalogue has duplicates. */
  byCode: Map<string, Product>;
  /** Normalized name -> product. First occurrence wins. */
  byName: Map<string, Product>;
}

export function buildProductIndex(products: Product[]): ProductIndex {
  const entries: IndexEntry[] = [];
  const byCode = new Map<string, Product>();
  const byName = new Map<string, Product>();

  for (const product of products) {
    const name = normalizeText(product.name ?? '');
    const code = normalizeCode(product.barcode ?? '');
    entries.push({ product, name, code, haystack: `${name} ${normalizeText(product.barcode ?? '')}` });

    if (code && !byCode.has(code)) byCode.set(code, product);
    if (name && !byName.has(name)) byName.set(name, product);
  }

  return { products, entries, byCode, byName };
}

export const EMPTY_PRODUCT_INDEX: ProductIndex = buildProductIndex([]);

/**
 * Higher is better; 0 means "no match, drop it".
 *
 * The tiers matter more than the exact numbers: a scanned/typed barcode must outrank every name
 * match, and a name the query starts must outrank a name that merely contains it somewhere.
 */
function scoreEntry(entry: IndexEntry, query: string, code: string, tokens: string[]): number {
  if (code) {
    if (entry.code === code) return 1000;
    // Short numeric fragments match half the catalogue, so only prefix-match from 3 characters.
    if (code.length >= 3 && entry.code.startsWith(code)) return 900;
  }

  if (entry.name === query) return 800;
  if (entry.name.startsWith(query)) return 700;
  // Word-start match: "cola" should find "Diet Cola 500ml".
  if (entry.name.includes(` ${query}`)) return 500;
  if (entry.haystack.includes(query)) return 300;

  // Out-of-order multi-word query: "500 cola" should still find "Diet Cola 500ml".
  if (tokens.length > 1 && tokens.every((token) => entry.haystack.includes(token))) return 200;

  return 0;
}

/**
 * Ranked matches for a free-text query, capped at `limit` so the dropdown stays cheap to render.
 * An empty query returns the first `limit` products, which is what an untouched combobox shows.
 */
export function searchProducts(index: ProductIndex, rawQuery: string, limit = 50): Product[] {
  const query = normalizeText(rawQuery);
  if (!query) return index.products.slice(0, limit);

  const code = normalizeCode(rawQuery);
  const tokens = query.split(' ').filter(Boolean);

  const scored: { product: Product; score: number; name: string }[] = [];
  for (const entry of index.entries) {
    const score = scoreEntry(entry, query, code, tokens);
    if (score > 0) scored.push({ product: entry.product, score, name: entry.name });
  }

  scored.sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((s) => s.product);
}

export type ResolveConfidence = 'exact' | 'ambiguous' | 'none';

export interface ResolveResult {
  /** The product to use when `confidence` is 'exact', or the best guess when 'ambiguous'. */
  product: Product | null;
  confidence: ResolveConfidence;
  /** Ranked alternatives, for a reconcile UI to offer. */
  suggestions: Product[];
}

/**
 * Turn one cell of pasted text into a product.
 *
 * `exact` means the text was an unambiguous barcode or an exact product name and can be imported
 * without review. Everything else is handed to the user to confirm — a bulk import that silently
 * guesses wrong writes bad stock into an append-only ledger.
 */
export function resolveProduct(index: ProductIndex, raw: string): ResolveResult {
  const text = (raw ?? '').trim();
  if (!text) return { product: null, confidence: 'none', suggestions: [] };

  const byCode = index.byCode.get(normalizeCode(text));
  if (byCode) return { product: byCode, confidence: 'exact', suggestions: [] };

  const byName = index.byName.get(normalizeText(text));
  if (byName) return { product: byName, confidence: 'exact', suggestions: [] };

  const suggestions = searchProducts(index, text, 8);
  if (suggestions.length === 0) return { product: null, confidence: 'none', suggestions: [] };

  return { product: suggestions[0], confidence: 'ambiguous', suggestions };
}
