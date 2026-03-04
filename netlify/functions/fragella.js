// SpritzFind API — Netlify Function
// Proxies requests to Fragella API and formats data for the frontend

const FRAGELLA_KEY = process.env.FRAGELLA_API_KEY || "e49d480fc7f564d234dcb1b222266f544e451b577c8646f54dad84c57ef44010";
const FRAGELLA_BASE = "https://api.fragella.com/api/v1";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// Build affiliate links for price comparison
function buildPriceLinks(fragrance) {
  const name = fragrance.Name || "";
  const brand = fragrance.Brand || "";
  const query = encodeURIComponent(`${brand} ${name}`.trim());
  
  const prices = [];
  
  // If Fragella provides a price, use it as reference
  if (fragrance.Price) {
    prices.push({
      store: "Best Available",
      storeId: "fragrancex",
      price: `$${parseFloat(fragrance.Price).toFixed(0)}`,
      url: fragrance["Purchase URL"] || `https://www.fragrancex.com/search?q=${query}`,
    });
  }

  // Amazon search link with affiliate tag
  prices.push({
    store: "Amazon",
    storeId: "amazon",
    price: "Check Price",
    url: `https://www.amazon.com/s?k=${query}&tag=spritzfind-20`,
  });

  // Sephora search link
  prices.push({
    store: "Sephora",
    storeId: "sephora",
    price: "Check Price",
    url: `https://www.sephora.com/search?keyword=${query}`,
  });

  // Ulta search link
  prices.push({
    store: "Ulta",
    storeId: "ulta",
    price: "Check Price",
    url: `https://www.ulta.com/ulta/a/_/Ntt-${query}`,
  });

  // FragranceX search link
  prices.push({
    store: "FragranceX",
    storeId: "fragrancex",
    price: "Check Price",
    url: `https://www.fragrancex.com/search?q=${query}`,
  });

  // FragranceNet search link
  prices.push({
    store: "FragranceNet",
    storeId: "fragrancenet",
    price: "Check Price",
    url: `https://www.fragrancenet.com/search?q=${query}`,
  });

  return prices;
}

// Convert Fragella response to SpritzFind card format
function formatFragrance(f) {
  // Determine badge
  let badge = "trending";
  if (f.Popularity === "Very high" || f.Popularity === "High") badge = "trending";
  else if (f["Price Value"] === "good_value" || f["Price Value"] === "great_value") badge = "deal";
  else if (f.Popularity === "Niche" || f.Popularity === "Low") badge = "luxury";

  // Popularity score
  const popMap = { "Very high": 97, "High": 88, "Medium": 72, "Low": 55, "Niche": 45 };
  const popularity = popMap[f.Popularity] || 60;

  // Build notes string
  const topNotes = (f.Notes?.Top || []).map(n => n.name).slice(0, 3).join(", ");
  const midNotes = (f.Notes?.Middle || []).map(n => n.name).slice(0, 2).join(", ");
  const baseNotes = (f.Notes?.Base || []).map(n => n.name).slice(0, 2).join(", ");
  const notesSummary = [topNotes, midNotes, baseNotes].filter(Boolean).join(" · ");

  // Build slug
  const slug = (f.Name || "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return {
    brand: f.Brand || "Unknown",
    name: f.Name || "Unknown",
    size: f.OilType || "Eau de Parfum",
    retail: f.Price ? `$${parseFloat(f.Price).toFixed(0)}` : null,
    notes: notesSummary || null,
    badge: badge,
    popularity: popularity,
    image: f["Image URL"] || null,
    imageFallbacks: f["Image Fallbacks"] || [],
    source: "Fragella",
    slug: slug,
    gender: f.Gender || null,
    year: f.Year || null,
    country: f.Country || null,
    rating: f.rating || null,
    longevity: f.Longevity || null,
    sillage: f.Sillage || null,
    priceValue: f["Price Value"] || null,
    confidence: f.Confidence || null,
    accords: f["Main Accords"] || [],
    accordPercentages: f["Main Accords Percentage"] || {},
    seasonRanking: f["Season Ranking"] || [],
    occasionRanking: f["Occasion Ranking"] || [],
    generalNotes: f["General Notes"] || [],
    notesDetail: f.Notes || {},
    purchaseUrl: f["Purchase URL"] || null,
    prices: buildPriceLinks(f),
  };
}

async function callFragella(endpoint, params = {}) {
  const url = new URL(`${FRAGELLA_BASE}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  console.log(`[SPRITZFIND] Fragella request: ${url.toString()}`);

  const res = await fetch(url.toString(), {
    headers: { "x-api-key": FRAGELLA_KEY },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[SPRITZFIND] Fragella error ${res.status}: ${errText}`);
    throw new Error(`Fragella API error: ${res.status}`);
  }

  return res.json();
}

exports.handler = async function (event) {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { action, query, brand, name, limit = 20 } = body;

  try {
    let data;

    if (action === "search" && query) {
      // Fuzzy search fragrances
      const raw = await callFragella("/fragrances", { search: query, limit });
      data = (Array.isArray(raw) ? raw : []).map(formatFragrance);

    } else if (action === "brand" && brand) {
      // Get all fragrances for a brand
      const raw = await callFragella(`/brands/${encodeURIComponent(brand)}`, { limit });
      data = (Array.isArray(raw) ? raw : []).map(formatFragrance);

    } else if (action === "similar" && name) {
      // Find similar fragrances
      const raw = await callFragella("/fragrances/similar", { name, limit });
      if (raw && raw.similar_fragrances) {
        data = raw.similar_fragrances.map(f => ({
          ...formatFragrance(f),
          similarityScore: f.SimilarityScore || null,
        }));
      } else {
        data = [];
      }

    } else if (action === "trending") {
      // Get popular fragrances — search for popular terms
      const searches = ["Sauvage", "Aventus", "Bleu de Chanel", "Eros", "Baccarat Rouge"];
      const pick = searches[Math.floor(Math.random() * searches.length)];
      const raw = await callFragella("/fragrances", { search: pick, limit });
      data = (Array.isArray(raw) ? raw : []).map(formatFragrance);

    } else if (action === "notes" && query) {
      // Search notes
      const raw = await callFragella("/notes", { search: query, limit });
      data = raw;

    } else if (action === "match") {
      // Trait match — find fragrances by accords/notes
      const params = {};
      if (body.accords) params.accords = body.accords;
      if (body.top) params.top = body.top;
      if (body.middle) params.middle = body.middle;
      if (body.base) params.base = body.base;
      params.limit = limit;
      const raw = await callFragella("/fragrances/match", params);
      data = (Array.isArray(raw) ? raw : []).map(formatFragrance);

    } else {
      return {
        statusCode: 400,
        headers: HEADERS,
        body: JSON.stringify({ error: "Invalid action. Use: search, brand, similar, trending, notes, match" }),
      };
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ data, count: data?.length || 0 }),
    };

  } catch (err) {
    console.error("[SPRITZFIND] API error:", err.message);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
