import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ValidationError } from "./validation";
import { documentFromText, type ExtractedDocument } from "./normalize";
import { parsePdf, MAX_EXTRACTED_CHARS } from "./parsers";

const MAX_URL_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 4;

/** True for loopback, private, link-local, CGNAT, multicast and other non-public ranges. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb") ||
      lower.startsWith("ff")
    );
  }
  return true;
}

export function parsePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ValidationError("Enter a valid URL starting with http:// or https://.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("Only http and https URLs are supported.");
  }
  if (url.username || url.password) throw new ValidationError("URLs with embedded credentials are not allowed.");
  if (url.port && !["80", "443", "8080", "8443"].includes(url.port)) {
    throw new ValidationError("This URL uses a port that is not allowed.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new ValidationError("Private or local addresses cannot be imported.");
  }
  return url;
}

export type HostResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

/** Rejects URLs whose host resolves to any non-public address (SSRF guard). */
export async function assertPublicHost(url: URL, resolve: HostResolver = defaultResolver) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => {
    throw new ValidationError("The website's address could not be resolved.");
  });
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new ValidationError("Private or local addresses cannot be imported.");
  }
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limit) throw new ValidationError("The page is too large to import.");
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new ValidationError("The page is too large to import.");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

export interface FetchedPage {
  finalUrl: string;
  document: ExtractedDocument;
}

/** Extracts the readable article text from an HTML page. */
export async function extractReadableHtml(html: string, url: string): Promise<ExtractedDocument> {
  const [{ parseHTML }, { Readability }] = await Promise.all([import("linkedom"), import("@mozilla/readability")]);
  const { document } = parseHTML(html);
  for (const el of document.querySelectorAll("script, style, noscript, iframe, svg, template")) el.remove();
  const pageTitle = document.querySelector("title")?.textContent?.trim();
  let text = "";
  let title = pageTitle;
  try {
    // linkedom's document is DOM-compatible enough for Readability.
    const article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
    if (article?.textContent) {
      text = article.textContent;
      title = article.title?.trim() || pageTitle;
    }
  } catch {
    // Fall back to body text below.
  }
  if (text.trim().length < 200) {
    // Preserve block structure as paragraph breaks.
    for (const el of document.querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6, br, tr, section, article")) {
      el.append("\n\n");
    }
    text = document.body?.textContent ?? "";
  }
  const doc = documentFromText(text, title || new URL(url).hostname);
  if (doc.text.length < 50) {
    throw new ValidationError("No readable text was found on this page. It may require JavaScript or a login.");
  }
  if (doc.text.length > MAX_EXTRACTED_CHARS) throw new ValidationError("This page is too long to import.");
  return doc;
}

/**
 * Fetches a public web page with SSRF protection: every hop (including
 * redirects) is re-validated, size and time are bounded, and only HTML,
 * plain text and PDF responses are accepted.
 */
export async function fetchUrlDocument(
  rawUrl: string,
  options: { resolve?: HostResolver; fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<FetchedPage> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let url = parsePublicUrl(rawUrl);
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url, options.resolve);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        redirect: "manual",
        signal,
        headers: {
          "user-agent": "MindLabAI/1.0 (+source import)",
          accept: "text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.1",
        },
      });
    } catch (error) {
      if (timeout.aborted) throw new ValidationError("The website took too long to respond.");
      throw new ValidationError(`The website could not be reached${error instanceof Error ? ` (${error.message})` : ""}.`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ValidationError("The website returned an invalid redirect.");
      url = parsePublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      throw new ValidationError(
        response.status === 401 || response.status === 403
          ? "This page requires a login or blocks automated access."
          : `The website returned an error (HTTP ${response.status}).`,
      );
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const bytes = await readLimited(response, MAX_URL_BYTES);
    if (contentType.includes("application/pdf")) {
      return { finalUrl: url.toString(), document: await parsePdf(bytes) };
    }
    if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
      const charset = contentType.match(/charset=([\w-]+)/)?.[1] ?? "utf-8";
      let html: string;
      try {
        html = new TextDecoder(charset).decode(bytes);
      } catch {
        html = new TextDecoder("utf-8").decode(bytes);
      }
      return { finalUrl: url.toString(), document: await extractReadableHtml(html, url.toString()) };
    }
    if (contentType.startsWith("text/plain") || contentType.startsWith("text/markdown")) {
      return { finalUrl: url.toString(), document: documentFromText(new TextDecoder().decode(bytes), url.hostname) };
    }
    throw new ValidationError("This URL does not point to a web page, text or PDF document.");
  }
  throw new ValidationError("The website redirected too many times.");
}
