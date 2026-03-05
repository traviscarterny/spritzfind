// SpritzFind API — Netlify Function
// Proxies requests to Fragella API + eBay Browse API for real prices

const FRAGELLA_KEY = process.env.FRAGELLA_API_KEY;
const FRAGELLA_BASE = "https://api.fragella.com/api/v1";

// eBay API credentials
const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const EBAY_AUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// ===== eBay API =====
let ebayToken = null;
let ebayTokenExpiry = 0;

async function getEbayToken() {
  if (ebayToken && Date.now() < ebayTokenExpiry - 60000) return ebayToken;

  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(EBAY_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${credentials}`,
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });

  if (!res.ok) {
    console.error("[SPRITZFIND] eBay auth error:", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  ebayToken = data.access_token;
  ebayTokenExpiry = Date.now() + (data.expires_in * 1000);
  console.log("[SPRITZFIND] eBay token acquired, expires in", data.expires_in, "s");
  return ebayToken;
}

async function searchEbay(query, limit = 3) {
  try {
    const token = await getEbayToken();
    if (!token) return [];

    const params = new URLSearchParams({
      q: query,
      category_ids: "180345",
      limit: String(limit),
      sort: "price",
      filter: "conditionIds:{1000|1500|2000|2500},deliveryCountry:US,price:[5..],priceCurrency:USD,buyingOptions:{FIXED_PRICE}",
    });

    const res = await fetch(`${EBAY_BROWSE_URL}?${params.toString()}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });

    if (!res.ok) {
      console.error("[SPRITZFIND] eBay search error:", res.status);
      return [];
    }

    const data = await res.json();
    return (data.itemSummaries || []).map(item => ({
      price: item.price ? parseFloat(item.price.value) : null,
      url: item.itemWebUrl || null,
      title: item.title || "",
      authenticity: item.authenticityVerification?.status === "PASSED",
    })).filter(i => i.price && i.price > 5);
  } catch (err) {
    console.error("[SPRITZFIND] eBay search failed:", err.message);
    return [];
  }
}

// ===== Price Links Builder =====

// Detect store name from a purchase URL
function storeFromUrl(url) {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("fragrancex")) return "FragranceX";
    if (host.includes("fragrancenet")) return "FragranceNet";
    if (host.includes("sephora")) return "Sephora";
    if (host.includes("ulta")) return "Ulta";
    if (host.includes("nordstrom")) return "Nordstrom";
    if (host.includes("macys")) return "Macy's";
    if (host.includes("amazon")) return "Amazon";
    if (host.includes("ebay")) return "eBay";
    if (host.includes("jomalone")) return "Jo Malone";
    if (host.includes("bloomingdales")) return "Bloomingdale's";
    if (host.includes("neimanmarcus")) return "Neiman Marcus";
    return host.replace("www.", "").split(".")[0];
  } catch(e) { return null; }
}

// Extract bottle size from fragrance name (e.g. "100ml", "3.4 oz", "50 ml")
function extractSize(name) {
  if (!name) return null;
  // Match patterns like "100ml", "3.4oz", "50 ml", "3.4 oz", "100 ml", "1.7oz"
  const mlMatch = name.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
  if (mlMatch) {
    const ml = parseFloat(mlMatch[1]);
    const oz = (ml / 29.5735).toFixed(1);
    return `${ml}ml / ${oz} oz`;
  }
  const ozMatch = name.match(/(\d+(?:\.\d+)?)\s*oz\b/i);
  if (ozMatch) {
    const oz = parseFloat(ozMatch[1]);
    const ml = Math.round(oz * 29.5735);
    return `${oz} oz / ${ml}ml`;
  }
  return null;
}

// Clean fragrance name — remove size, concentration suffixes, and "for men/women"
function cleanName(name) {
  if (!name) return name;
  return name
    .replace(/\s*\d+(?:\.\d+)?\s*(?:ml|oz)\b/gi, "")
    .replace(/\s*(edt|edp|eau de toilette|eau de parfum|parfum|cologne)\s*$/i, "")
    .trim();
}

function buildPriceLinks(fragrance, ebayResults) {
  const name = fragrance.Name || "";
  const brand = fragrance.Brand || "";
  const query = encodeURIComponent(`${brand} ${name}`.trim());
  const prices = [];

  // eBay — REAL prices from Browse API
  if (ebayResults && ebayResults.length > 0) {
    const best = ebayResults[0];
    prices.push({
      store: best.authenticity ? "eBay ✓" : "eBay",
      storeId: "ebay",
      price: `$${Math.round(best.price)}`,
      url: best.url || `https://www.ebay.com/sch/i.html?_nkw=${query}&_sacat=180345`,
    });
    if (ebayResults.length > 1 && Math.round(ebayResults[1].price) !== Math.round(best.price)) {
      prices.push({
        store: ebayResults[1].authenticity ? "eBay #2 ✓" : "eBay #2",
        storeId: "ebay",
        price: `$${Math.round(ebayResults[1].price)}`,
        url: ebayResults[1].url || `https://www.ebay.com/sch/i.html?_nkw=${query}&_sacat=180345`,
      });
    }
  } else {
    prices.push({
      store: "eBay", storeId: "ebay", price: "Check Price",
      url: `https://www.ebay.com/sch/i.html?_nkw=${query}&_sacat=180345`,
    });
  }

  // Amazon with affiliate tag
  prices.push({ store: "Amazon", storeId: "amazon", price: "Check Price", url: `https://www.amazon.com/s?k=${query}&tag=spritzfind-20` });

  return prices;
}

// ===== Format Fragrance =====
function formatFragrance(f, ebayResults) {
  let badge = "trending";
  if (f.Popularity === "Very high" || f.Popularity === "High") badge = "trending";
  else if (f["Price Value"] === "good_value" || f["Price Value"] === "great_value") badge = "deal";
  else if (f.Popularity === "Niche" || f.Popularity === "Low") badge = "luxury";

  const popMap = { "Very high": 97, "High": 88, "Medium": 72, "Low": 55, "Niche": 45 };
  const popularity = popMap[f.Popularity] || 60;

  const topNotes = (f.Notes?.Top || []).map(n => n.name).slice(0, 3).join(", ");
  const midNotes = (f.Notes?.Middle || []).map(n => n.name).slice(0, 2).join(", ");
  const baseNotes = (f.Notes?.Base || []).map(n => n.name).slice(0, 2).join(", ");
  const notesSummary = [topNotes, midNotes, baseNotes].filter(Boolean).join(" · ");

  const slug = (f.Name || "").toLowerCase().replace(/['']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return {
    brand: f.Brand || "Unknown",
    name: cleanName(f.Name) || f.Name || "Unknown",
    size: f.OilType || null,
    bottleSize: extractSize(f.Name || "") || null,
    retail: (f.Price && parseFloat(f.Price) >= 10 && parseFloat(f.Price) <= 800) ? `$${parseFloat(f.Price).toFixed(0)}` : null,
    notes: notesSummary || null,
    badge, popularity,
    image: f["Image URL"] || null,
    imageFallbacks: f["Image Fallbacks"] || [],
    source: "Fragella" + (ebayResults && ebayResults.length > 0 ? " + eBay" : ""),
    slug, gender: f.Gender || null, year: f.Year || null, country: f.Country || null,
    rating: f.rating || null, longevity: f.Longevity || null, sillage: f.Sillage || null,
    priceValue: f["Price Value"] || null, confidence: f.Confidence || null,
    accords: f["Main Accords"] || [], accordPercentages: f["Main Accords Percentage"] || {},
    seasonRanking: f["Season Ranking"] || [], occasionRanking: f["Occasion Ranking"] || [],
    generalNotes: f["General Notes"] || [], notesDetail: f.Notes || {},
    purchaseUrl: f["Purchase URL"] || null,
    prices: buildPriceLinks(f, ebayResults),
  };
}

// ===== Batch eBay enrichment =====
async function enrichWithEbay(fragrances) {
  // Fetch eBay prices in parallel — limit to first 10 to stay within rate limits
  const batch = fragrances.slice(0, 10);
  const ebayPromises = batch.map(f => {
    const q = `${f.Brand || ""} ${f.Name || ""}`.trim();
    return searchEbay(q, 3).catch(() => []);
  });

  const ebayResults = await Promise.all(ebayPromises);

  return fragrances.map((f, i) => {
    const ebay = i < ebayResults.length ? ebayResults[i] : [];
    return formatFragrance(f, ebay);
  });
}

// ===== Fragella API =====
async function callFragella(endpoint, params = {}) {
  const url = new URL(`${FRAGELLA_BASE}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  console.log(`[SPRITZFIND] Fragella: ${url.toString()}`);
  const res = await fetch(url.toString(), { headers: { "x-api-key": FRAGELLA_KEY } });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[SPRITZFIND] Fragella error ${res.status}: ${errText}`);
    throw new Error(`Fragella API error: ${res.status}`);
  }
  return res.json();
}

// ===== Main Handler =====
exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: HEADERS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: "Method not allowed" }) };

  let body;
  try { body = JSON.parse(event.body); } catch (e) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { action, query, brand, name, limit = 50 } = body;

  try {
    let data;

    if (action === "search" && query) {
      const raw = await callFragella("/fragrances", { search: query, limit });
      let results = Array.isArray(raw) ? raw : [];
      if (results.length > 0 && results.length < limit && results.length === 20) {
        try {
          const raw2 = await callFragella("/fragrances", { search: query + " eau", limit: 30 });
          const items2 = Array.isArray(raw2) ? raw2 : [];
          const seen = new Set(results.map(r => (r.Name || "").toLowerCase()));
          for (const item of items2) {
            if (!seen.has((item.Name || "").toLowerCase())) { results.push(item); seen.add((item.Name || "").toLowerCase()); }
            if (results.length >= limit) break;
          }
        } catch (e) {}
      }
      data = await enrichWithEbay(results);

    } else if (action === "brand" && brand) {
      const raw = await callFragella(`/brands/${encodeURIComponent(brand)}`, { limit });
      let results = Array.isArray(raw) ? raw : [];
      if (results.length > 0 && results.length < limit && results.length === 20) {
        try {
          const raw2 = await callFragella("/fragrances", { search: brand, limit: 30 });
          const items2 = Array.isArray(raw2) ? raw2 : [];
          const seen = new Set(results.map(r => (r.Name || "").toLowerCase()));
          for (const item of items2) {
            if (!seen.has((item.Name || "").toLowerCase())) { results.push(item); seen.add((item.Name || "").toLowerCase()); }
            if (results.length >= limit) break;
          }
        } catch (e) {}
      }
      data = await enrichWithEbay(results);

    } else if (action === "similar" && name) {
      const raw = await callFragella("/fragrances/similar", { name, limit });
      if (raw && raw.similar_fragrances) {
        const enriched = await enrichWithEbay(raw.similar_fragrances);
        data = enriched.map((f, i) => ({ ...f, similarityScore: raw.similar_fragrances[i]?.SimilarityScore || null }));
      } else { data = []; }

    } else if (action === "trending") {
      const searches = ["Dior Sauvage", "Chanel", "Tom Ford", "Creed Aventus", "Versace"];
      const allResults = [];
      const seen = new Set();
      for (const term of searches) {
        if (allResults.length >= limit) break;
        try {
          const raw = await callFragella("/fragrances", { search: term, limit: 20 });
          for (const item of (Array.isArray(raw) ? raw : [])) {
            const key = (item.Name || "").toLowerCase();
            if (!seen.has(key)) { seen.add(key); allResults.push(item); }
            if (allResults.length >= limit) break;
          }
        } catch (e) { console.error(`[SPRITZFIND] Trending "${term}" failed:`, e.message); }
      }
      data = await enrichWithEbay(allResults);

    } else if (action === "notes" && query) {
      data = await callFragella("/notes", { search: query, limit });

    } else if (action === "match") {
      const params = {};
      if (body.accords) params.accords = body.accords;
      if (body.top) params.top = body.top;
      if (body.middle) params.middle = body.middle;
      if (body.base) params.base = body.base;
      params.limit = limit;
      const raw = await callFragella("/fragrances/match", params);
      data = await enrichWithEbay(Array.isArray(raw) ? raw : []);

    } else {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "Invalid action" }) };
    }

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ data, count: data?.length || 0 }) };

  } catch (err) {
    console.error("[SPRITZFIND] Error:", err.message);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
