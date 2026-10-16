// Automated IndexNow Search Engine Submission
// Submits all 10 canonical playheist.net URLs directly to Microsoft Bing, Yandex,
// and partner search crawlers for instant indexing without waiting for weekly crawls.

const INDEXNOW_KEY = "d7e93f8b1c4a2e5d6f8a9b0c1d2e3f4a";
const HOST = "playheist.net";
const KEY_LOCATION = `https://${HOST}/${INDEXNOW_KEY}.txt`;

const URLS = [
  `https://${HOST}/`,
  `https://${HOST}/solitaire`,
  `https://${HOST}/freecell`,
  `https://${HOST}/spider`,
  `https://${HOST}/tripeaks`,
  `https://${HOST}/pyramid`,
  `https://${HOST}/yukon`,
  `https://${HOST}/ers`,
  `https://${HOST}/scoundrel`,
  `https://${HOST}/checkers`,
  `https://${HOST}/card-games`,
  `https://${HOST}/arcade`,
  `https://${HOST}/blog`,
  `https://${HOST}/blog/best-free-online-card-games`,
];

const ENDPOINTS = [
  "https://api.indexnow.org/IndexNow",
  "https://www.bing.com/IndexNow",
];

async function submitIndexNow() {
  console.log(`\n=======================================================`);
  console.log(`   HEIST INSTANT SEARCH ENGINE INDEXING (INDEXNOW)    `);
  console.log(`=======================================================\n`);
  console.log(`📡 Host: ${HOST}`);
  console.log(`🔑 Key Location: ${KEY_LOCATION}`);
  console.log(`📋 Submitting ${URLS.length} URLs:\n${URLS.map((u) => `   - ${u}`).join("\n")}\n`);

  const payload = {
    host: HOST,
    key: INDEXNOW_KEY,
    keyLocation: KEY_LOCATION,
    urlList: URLS,
  };

  for (const endpoint of ENDPOINTS) {
    try {
      console.log(`🚀 Pinging ${endpoint}...`);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
      });

      if (res.status === 200 || res.status === 202) {
        console.log(`   ✅ Success! Status: ${res.status} (${res.statusText || "Accepted"})`);
      } else {
        const text = await res.text().catch(() => "");
        console.log(`   ⚠️ Endpoint returned status ${res.status}: ${text}`);
      }
    } catch (err: unknown) {
      console.log(`   ❌ Error pinging ${endpoint}: ${(err as Error).message}`);
    }
  }

  console.log(`\n✨ Search engines notified for immediate crawling.\n`);
}

submitIndexNow();
