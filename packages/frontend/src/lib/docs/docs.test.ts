// @vitest-environment node
// The Docs section's sources stay in step: every nav entry has its Markdown
// page and every page is in the nav, each page has the frontmatter
// DocsLayout reads, and every site link in the pages names a route that
// exists. Anchors and the built HTML are checked by tests/e2e/ui/docs.spec.ts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOCS, docHref } from "./nav";
import { docTexts, llmsFull, llmsIndex, type MarkdownModule } from "./llms";

const PAGES = fileURLToPath(new URL("../../pages/", import.meta.url));
const DOCS_DIR = join(PAGES, "docs");
const markdown = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));

function frontmatter(source: string): Record<string, string> {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(source)?.[1] ?? "";
  return Object.fromEntries(
    block.split("\n").map((line) => {
      const i = line.indexOf(":");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
}

/** Whether `path` (no query or hash) is a page the site builds. */
function routeExists(path: string): boolean {
  if (path === "/docs/llms.txt" || path === "/docs/llms-full.txt") return true;
  const clean = path.replace(/^\/|\/$/g, "");
  if (clean === "docs") return true;
  if (clean.startsWith("docs/")) return DOCS.some((d) => `docs/${d.slug}` === clean);
  return (
    clean === "" ||
    existsSync(join(PAGES, clean, "index.astro")) ||
    existsSync(join(PAGES, `${clean}.astro`))
  );
}

describe("docs section", () => {
  it("has one Markdown page per nav entry, and no page outside the nav", () => {
    expect(markdown.map((f) => f.replace(/\.md$/, "")).sort()).toEqual(
      DOCS.map((d) => d.slug).sort(),
    );
  });

  it("gives every page the layout, a title and a description", () => {
    for (const file of markdown) {
      const fm = frontmatter(readFileSync(join(DOCS_DIR, file), "utf-8"));
      expect(fm.layout, file).toBe("../../layouts/DocsLayout.astro");
      expect(fm.title, file).toBeTruthy();
      expect(fm.description, file).toBeTruthy();
    }
  });

  it("starts every page's body at h2, since the layout renders the h1", () => {
    for (const file of markdown) {
      const body = readFileSync(join(DOCS_DIR, file), "utf-8").replace(/^---[\s\S]*?\n---\n/, "");
      expect(body.replace(/```[\s\S]*?```/g, ""), file).not.toMatch(/^# /m);
    }
  });

  it("links only to routes the site builds", () => {
    for (const file of markdown) {
      const source = readFileSync(join(DOCS_DIR, file), "utf-8");
      for (const [, target] of source.matchAll(/\]\((\/[^)\s]*)\)/g)) {
        const path = target.split("#")[0].split("?")[0];
        expect(routeExists(path), `${file} links to ${target}`).toBe(true);
      }
    }
  });
});

describe("llms.txt", () => {
  const modules: Record<string, MarkdownModule> = Object.fromEntries(
    DOCS.map((d) => [
      `./${d.slug}.md`,
      {
        frontmatter: { title: `Title ${d.slug}`, description: `About ${d.slug}` },
        rawContent: () => `## ${d.slug}\n\nRevoking is <span class="docs-tag">Not available yet</span>.\n`,
      },
    ]),
  );

  it("indexes every page in nav order", () => {
    const index = llmsIndex(docTexts(modules));
    const positions = DOCS.map((d) => index.indexOf(`(${docHref(d.slug)})`));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(index).toContain("> About index");
    expect(index).toContain("(/docs/llms-full.txt)");
  });

  it("puts every page's Markdown in the full file, without display HTML", () => {
    const full = llmsFull(docTexts(modules));
    for (const d of DOCS) {
      expect(full).toContain(`# Title ${d.slug}`);
      expect(full).toContain(`Page: ${docHref(d.slug)}`);
    }
    expect(full).toContain("**Not available yet**");
    expect(full).not.toContain("<span");
  });

  it("refuses a nav entry with no page", () => {
    const { "./fees.md": _, ...missing } = modules;
    expect(() => docTexts(missing)).toThrow(/fees/);
  });
});
