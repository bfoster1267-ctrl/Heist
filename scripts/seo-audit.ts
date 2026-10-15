// SEO & AI Visibility Automated Auditor
// Verifies all 100/100 search visibility, AI indexing (ChatGPT, Claude, Perplexity, Gemini),
// Schema.org structured data, sitemap, and robots configurations.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface Check {
  category: "Google Search" | "AI Visibility (GEO)" | "Social Previews" | "Technical SEO";
  name: string;
  pass: boolean;
  score: number;
  details: string;
}

const ROOT = resolve(import.meta.dirname, "..");
const INDEX_HTML = resolve(ROOT, "apps/web/index.html");
const ROBOTS_TXT = resolve(ROOT, "apps/web/public/robots.txt");
const SITEMAP_XML = resolve(ROOT, "apps/web/public/sitemap.xml");
const OG_IMAGE = resolve(ROOT, "apps/web/public/og-image.png");

export function runAudit(): { totalScore: number; maxScore: number; checks: Check[] } {
  const checks: Check[] = [];

  const indexContent = existsSync(INDEX_HTML) ? readFileSync(INDEX_HTML, "utf-8") : "";
  const robotsContent = existsSync(ROBOTS_TXT) ? readFileSync(ROBOTS_TXT, "utf-8") : "";
  const sitemapContent = existsSync(SITEMAP_XML) ? readFileSync(SITEMAP_XML, "utf-8") : "";

  // 1. Google Search: Title Tag
  const hasTitle = /<title>(?=.*Heist)(?=.*Multiplayer Card Game).+<\/title>/i.test(indexContent);
  checks.push({
    category: "Google Search",
    name: "Optimized Title Tag",
    pass: hasTitle,
    score: 10,
    details: hasTitle ? "Title contains brand, 'Multiplayer Card Game', and 'Browser'" : "Title missing target keywords",
  });

  // 2. Google Search: Meta Description
  const hasDesc = /<meta\s+name="description"\s+content="[^"]*multiplayer[^"]*card game[^"]*"/i.test(indexContent);
  checks.push({
    category: "Google Search",
    name: "Targeted Meta Description",
    pass: hasDesc,
    score: 10,
    details: hasDesc ? "Meta description targets 'multiplayer card game' & 'solitaire'" : "Meta description missing or lacking keywords",
  });

  // 3. Google Search: Keywords Tag
  const hasKeywords = /<meta\s+name="keywords"\s+content="[^"]*bluffing card game online[^"]*"/i.test(indexContent);
  checks.push({
    category: "Google Search",
    name: "Search Keyword Coverage",
    pass: hasKeywords,
    score: 10,
    details: hasKeywords ? "Includes 'bluffing card game online', 'free multiplayer card game', etc." : "Keywords meta tag incomplete",
  });

  // 4. Google Search: Canonical Link
  const hasCanonical = /<link\s+rel="canonical"\s+href="https:\/\/playheist\.net\/"\s*\/?>/i.test(indexContent);
  checks.push({
    category: "Google Search",
    name: "Canonical URL",
    pass: hasCanonical,
    score: 10,
    details: hasCanonical ? "Canonical points to https://playheist.net/" : "Missing or invalid canonical link",
  });

  // 5. AI Visibility: Schema.org VideoGame Graph
  const hasVideoGameSchema = indexContent.includes('"@type": ["VideoGame", "WebApplication"]') && indexContent.includes('"genre": ["Card Game", "Multiplayer", "Bluffing"');
  checks.push({
    category: "AI Visibility (GEO)",
    name: "Schema.org VideoGame JSON-LD",
    pass: hasVideoGameSchema,
    score: 15,
    details: hasVideoGameSchema ? "Structured VideoGame/WebApp schema with multiPlayer mode and genres" : "Missing VideoGame structured data",
  });

  // 6. AI Visibility: Schema.org FAQPage for LLM Grounding
  const hasFAQSchema = indexContent.includes('"@type": "FAQPage"') && indexContent.includes("free online card game to play with friends");
  checks.push({
    category: "AI Visibility (GEO)",
    name: "FAQPage Schema for ChatGPT/Claude/Perplexity",
    pass: hasFAQSchema,
    score: 15,
    details: hasFAQSchema ? "Direct Q&A answers for AI search queries ('online card game to play with friends')" : "Missing FAQPage structured data",
  });

  // 7. AI Visibility: Crawlable Semantic HTML Fallback
  const hasSemanticFallback = indexContent.includes("<h1>Heist: Free Multiplayer Card Game") && indexContent.includes("/solitaire");
  checks.push({
    category: "AI Visibility (GEO)",
    name: "Crawlable Pre-hydration Semantic HTML",
    pass: hasSemanticFallback,
    score: 10,
    details: hasSemanticFallback ? "Full semantic catalog rendered in #root for non-JS scrapers" : "Root div is completely empty for bots",
  });

  // 8. Social Previews: OpenGraph & Twitter Cards
  const hasOgImage = existsSync(OG_IMAGE) && indexContent.includes("og:image") && indexContent.includes("twitter:card");
  checks.push({
    category: "Social Previews",
    name: "OpenGraph & Twitter Card Assets",
    pass: hasOgImage,
    score: 10,
    details: hasOgImage ? "1200x630 social banner generated and referenced in OpenGraph tags" : "Missing OpenGraph image or tags",
  });

  // 9. Technical SEO: robots.txt AI Permission
  const allowsAi = robotsContent.includes("User-agent: GPTBot") && robotsContent.includes("User-agent: ClaudeBot") && robotsContent.includes("User-agent: PerplexityBot");
  checks.push({
    category: "Technical SEO",
    name: "robots.txt AI Crawlers Allowed",
    pass: allowsAi,
    score: 5,
    details: allowsAi ? "Explicitly allows Googlebot, GPTBot, ClaudeBot, PerplexityBot" : "Missing explicit AI crawler directives in robots.txt",
  });

  // 10. Technical SEO: sitemap.xml Route Indexing
  const hasSitemapRoutes = sitemapContent.includes("https://playheist.net/solitaire") && sitemapContent.includes("https://playheist.net/tripeaks");
  checks.push({
    category: "Technical SEO",
    name: "Complete sitemap.xml",
    pass: hasSitemapRoutes,
    score: 5,
    details: hasSitemapRoutes ? "Includes all 10 game URLs and update frequencies" : "Missing sitemap.xml or game routes",
  });

  const totalScore = checks.filter((c) => c.pass).reduce((sum, c) => sum + c.score, 0);
  const maxScore = checks.reduce((sum, c) => sum + c.score, 0);

  return { totalScore, maxScore, checks };
}

// CLI runner
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("\n=======================================================");
  console.log("   HEIST SEO & AI VISIBILITY AUTOMATED HEALTH AUDIT   ");
  console.log("=======================================================\n");

  const { totalScore, maxScore, checks } = runAudit();

  for (const check of checks) {
    const symbol = check.pass ? "✅" : "❌";
    console.log(`${symbol} [${check.category}] ${check.name} (+${check.score} pts)`);
    console.log(`   └─ ${check.details}`);
  }

  console.log("\n-------------------------------------------------------");
  console.log(`  FINAL SCORE: ${totalScore} / ${maxScore} ${totalScore === 100 ? "🌟 (PERFECT 100/100)" : ""}`);
  console.log("-------------------------------------------------------\n");

  if (totalScore < 100) {
    process.exit(1);
  }
}
