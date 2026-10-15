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
