import { describe, expect, it } from "vitest";
import { pageHtml, ROBOTS, SITEMAP } from "../src/seo";

const APP = `<html><head><title>Heist</title></head><body><div id="root"></div></body></html>`;

describe("seo", () => {
  it("gives /solitaire its own title, description, canonical and crawlable text", () => {
    const html = pageHtml(APP, "/solitaire");
    expect(html).toContain("<title>Solitaire: Play Free Klondike Solitaire Online");
    expect(html).toContain('name="description"');
    expect(html).toContain('rel="canonical" href="https://playheist.net/solitaire"');
    expect(html).toContain("<h1>Free Klondike Solitaire</h1>");
    expect(html).not.toContain("<title>Heist</title>");
  });
  it("leaves other paths alone", () => {
    expect(pageHtml(APP, "/somewhere")).toBe(APP);
  });
  it("lists the pages in the sitemap and keeps admin out of robots", () => {
    expect(SITEMAP).toContain("<loc>https://playheist.net/solitaire</loc>");
    expect(ROBOTS).toContain("Disallow: /admin");
  });
});

import { blogPage, POSTS } from "../src/blog";

describe("blog", () => {
  it("serves the index and every post with a link into the game", () => {
    expect(blogPage("/blog")).toContain("The Heist Blog");
    for (const p of POSTS) {
      const html = blogPage("/blog/" + p.slug)!;
      expect(html).toContain(`<link rel="canonical" href="https://playheist.net/blog/${p.slug}"`);
      expect(html).toContain('href="/">Play Heist free');
      expect(SITEMAP).toContain(`/blog/${p.slug}</loc>`);
    }
    expect(blogPage("/blog/nope")).toBeNull();
  });
});

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { serveStatic } from "../src/static";

describe("hardening", () => {
  it("turns away a malformed escape in the path instead of throwing (it used to crash the server)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "heist-web-"));
    writeFileSync(join(dir, "index.html"), APP);
    const req = { method: "GET", url: "/%E0%A4%A" } as IncomingMessage;
    const res = { writeHead() { return this; }, end() {} } as unknown as ServerResponse;
    await expect(serveStatic(dir, req, res)).resolves.toBe(false);
  });
  it("keeps $-patterns in a challenge link from rewriting the page", () => {
    const html = pageHtml(APP, "/solitaire", new URLSearchParams({ challenge: "12", ctime: "$'", cmoves: "$&" }));
    expect(html.match(/<body>/g)).toHaveLength(1);
    expect(html).not.toContain("$'");
  });
  it("puts only a deal number, a m:ss time and a move count in a challenge title", () => {
    const ok = pageHtml(APP, "/solitaire", new URLSearchParams({ challenge: "12", ctime: "1:23", cmoves: "45" }));
    expect(ok).toContain("Beat My 1:23 Score");
    const junk = pageHtml(APP, "/solitaire", new URLSearchParams({ challenge: "12", ctime: "anything you like" }));
    expect(junk).not.toContain("anything you like");
    expect(pageHtml(APP, "/solitaire", new URLSearchParams({ challenge: "not a deal" }))).not.toContain("Challenge:");
  });
});
