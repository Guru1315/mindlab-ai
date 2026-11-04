import { describe, expect, it } from "vitest";
import { extractReadableHtml, fetchUrlDocument, isPrivateAddress, parsePublicUrl } from "@/lib/ingestion/url";
import { ValidationError } from "@/lib/ingestion/validation";

const publicResolver = async () => ["93.184.216.34"];

function htmlResponse(html: string, init: ResponseInit = {}) {
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });
}

const ARTICLE = `<!doctype html><html><head><title>Ocean heat explained</title><script>alert(1)</script></head>
<body><nav>Menu Home About</nav><article><h1>Ocean heat explained</h1>
${Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i}: The ocean absorbs more than ninety percent of the excess heat trapped by greenhouse gases, which raises sea levels through thermal expansion.</p>`).join("")}
</article><footer>Copyright</footer></body></html>`;

describe("SSRF protection", () => {
  it("classifies private, loopback, link-local and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("rejects non-http schemes, credentials, odd ports and local hostnames", () => {
    expect(() => parsePublicUrl("file:///etc/passwd")).toThrow(ValidationError);
    expect(() => parsePublicUrl("javascript:alert(1)")).toThrow(ValidationError);
    expect(() => parsePublicUrl("http://user:pass@example.com")).toThrow(/credentials/);
    expect(() => parsePublicUrl("http://example.com:6379")).toThrow(/port/);
    expect(() => parsePublicUrl("http://localhost/admin")).toThrow(/Private/);
    expect(parsePublicUrl("https://example.com/a").hostname).toBe("example.com");
  });

  it("blocks hosts that resolve to private addresses", async () => {
    await expect(
      fetchUrlDocument("https://internal.example.com", { resolve: async () => ["10.0.0.5"], fetchImpl: async () => htmlResponse(ARTICLE) }),
    ).rejects.toThrow(/Private or local/);
  });

  it("re-validates every redirect hop", async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      if (String(url).startsWith("https://example.com")) {
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
      }
      return htmlResponse("secret");
    };
    await expect(fetchUrlDocument("https://example.com/start", { resolve: publicResolver, fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow(/Private or local/);
  });

  it("enforces a response size limit", async () => {
    const big = "x".repeat(11 * 1024 * 1024);
    await expect(
      fetchUrlDocument("https://example.com", { resolve: publicResolver, fetchImpl: (async () => htmlResponse(big)) as typeof fetch }),
    ).rejects.toThrow(/too large/);
  });

  it("rejects unsupported content types", async () => {
    await expect(
      fetchUrlDocument("https://example.com/file.zip", {
        resolve: publicResolver,
        fetchImpl: (async () => new Response("PK", { headers: { "content-type": "application/zip" } })) as typeof fetch,
      }),
    ).rejects.toThrow(/does not point to a web page/);
  });
});

describe("readable extraction", () => {
  it("extracts article text and title, dropping scripts and chrome", async () => {
    const doc = await extractReadableHtml(ARTICLE, "https://example.com/ocean");
    expect(doc.title).toBe("Ocean heat explained");
    expect(doc.text).toContain("ninety percent of the excess heat");
    expect(doc.text).not.toContain("alert(1)");
  });

  it("fetches and extracts through the full pipeline", async () => {
    const page = await fetchUrlDocument("https://example.com/ocean", { resolve: publicResolver, fetchImpl: (async () => htmlResponse(ARTICLE)) as typeof fetch });
    expect(page.finalUrl).toBe("https://example.com/ocean");
    expect(page.document.text).toContain("thermal expansion");
  });

  it("explains when a page has no readable text", async () => {
    await expect(extractReadableHtml("<html><body><div id=app></div></body></html>", "https://spa.example.com")).rejects.toThrow(/No readable text/);
  });
});
