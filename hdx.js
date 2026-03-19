const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs").promises;
const { exec } = require("child_process");

const PROGRESS_FILE = "progress.json";
const TEST_MODE = false;
const COMMIT_EVERY = 30;

// 🔥 เพิ่มหมวดได้ตรงนี้
const categories = [
  // 🔥 TAG
  { name: "หนังใหม่ 2026", type: "tag", id: "268" },
  { name: "หนังใหม่ 2025", type: "tag", id: "230" },

  // 🔥 CATEGORY
  { name: "หนังฝรั่ง", type: "category", id: "5" },
  { name: "หนังไทย", type: "category", id: "7" },
  { name: "หนังจีน", type: "category", id: "8" },
  { name: "หนังเกาหลี", type: "category", id: "6" },
  { name: "หนังญี่ปุ่น", type: "category", id: "9" },
  { name: "Netflix", type: "category", id: "11" },
  { name: "Marvel", type: "category", id: "221" },
  { name: "หนัง18+", type: "category", id: "49" },
  { name: "หนังภาคต่อ", type: "category", id: "10" }
];

// delay
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// progress
async function loadProgress() {
  try { return JSON.parse(await fs.readFile(PROGRESS_FILE, "utf-8")); }
  catch { return {}; }
}

async function saveProgress(progress) {
  await fs.writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// =========================
// 🔥 ดึง config จริงจากหน้าเว็บ
// =========================
async function getAjaxConfig(cat) {
  const url = cat.type === "tag"
    ? `https://lk-hdx.com/?tag_id=${cat.id}`
    : `https://lk-hdx.com/?cat=${cat.id}`;

  const res = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "text/html",
      "Referer": "https://lk-hdx.com/"
    }
  });

  const html = res.data;

  const secMatch = html.match(/"security":"(.*?)"/);
  if (!secMatch) throw new Error("❌ หา security ไม่เจอ");

  const rndMatch = html.match(/"rnd_id":"(.*?)"/);
  if (!rndMatch) throw new Error("❌ หา rnd_id ไม่เจอ");

  const cookies = res.headers["set-cookie"]
    ?.map(c => c.split(";")[0])
    .join("; ");

  return {
    security: secMatch[1],
    rnd_id: rndMatch[1],
    cookies,
    base: new URL(url).origin
  };
}
// =========================
// 🔥 AJAX (FIX 500)
// =========================
async function scrapePageAjax(cat, page, ajaxConfig) {
  try {
    const payload = new URLSearchParams({
  action: "blockajaxaction",
  security: ajaxConfig.security,

  "params[block_title]": "",
  "params[layout]": "grid-mv-4-col",
  "params[post_type]": "post",
  "params[filter_items]": "",
  "params[category]": "",
  "params[tag]": "",
  "params[ex_category]": "",
  "params[ids]": "",
  "params[ex_ids]": "",
  "params[order_by]": "date",
  "params[order]": "DESC",
  "params[offset]": "0",
  "params[pagination]": "infinite",
  "params[items_per_page]": "36",
  "params[post_count]": "-1",
  "params[image_ratio]": "",
  "params[display_categories]": "no",
  "params[display_excerpt]": "off",

  "params[link_to]": "default",
  "params[sub_class]": "movie-grid",
  "params[rnd_id]": ajaxConfig.rnd_id,
  "params[data_ajax]": "yes",
  "params[filter]": "0",
  "params[tax]": "all",
  "params[paged]": page
});

if (cat.type === "tag") {
  payload.set("params[tag]", cat.id);
} else {
  payload.set("params[category]", cat.id);
}


    const { data } = await axios.post(
      `${ajaxConfig.base}/wp-admin/admin-ajax.php`,
      payload,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": cat.type === "tag"
  ? `https://lk-hdx.com/?tag_id=${cat.id}`
  : `https://lk-hdx.com/?cat=${cat.id}`,
          "Origin": "https://lk-hdx.com",
          "Cookie": ajaxConfig.cookies
        },
        timeout: 15000
      }
    );

    const $ = cheerio.load(data);
    const movies = [];

    $("article.post-item").each((i, el) => {
      const a = $(el).find("h3.entry-title a");
      const img = $(el).find("img");

      const url = a.attr("href");
      const title = a.attr("title");
      const poster = img.attr("data-src") || img.attr("src");

      if (url && title) {
        movies.push({ title, url, poster });
      }
    });

    return movies;

  } catch (err) {
    console.log("❌ ajax error:", err.message);

    if (err.response) {
      console.log("STATUS:", err.response.status);
    }

    return [];
  }
}

// =========================
// 🔥 DETAIL → เอา embed เท่านั้น
// =========================
async function scrapeDetail(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000
    });

    const $ = cheerio.load(data);
    const embeds = [];

    $(".player-api iframe").each((i, el) => {
      const src = $(el).attr("src");
      if (src) embeds.push(src);
    });

    return embeds;

  } catch (err) {
    console.log("detail error:", err.message);
    return [];
  }
}

// commit
async function commitChanges(message) {
  return new Promise(resolve => {
    exec(`
      git config user.name "github-actions[bot]" &&
      git config user.email "github-actions[bot]@users.noreply.github.com" &&
      git add . &&
      git commit -m "${message}" &&
      git push origin main
    `, () => resolve());
  });
}

// =========================
// 🔥 MAIN
// =========================
async function run() {
  let allMovies = [];
  let progress = await loadProgress();

  // 🔥 INIT CONFIG
  const ajaxConfigs = {};
  for (const cat of categories) {
    console.log("🔑 INIT:", cat.name);
    ajaxConfigs[cat.name] = await getAjaxConfig(cat);
  }

  for (const cat of categories) {
    console.log("📁 SCRAPING:", cat.name);

    let catMovies = [];

    try {
      const old = await fs.readFile(`${cat.name}.json`, "utf-8");
      catMovies = JSON.parse(old);
      console.log("♻️ old:", catMovies.length);
    } catch {}

    let page = progress[cat.name] || 1;

    while (true) {
      console.log("📄 PAGE:", page);

      const movies = await scrapePageAjax(cat, page, ajaxConfigs[cat.name]);
      await sleep(1200);

      if (movies.length === 0) {
        console.log("📌 END");
        break;
      }

      const exist = new Set(catMovies.map(m => m.url));
      const fresh = movies.filter(m => !exist.has(m.url));

      if (fresh.length === 0) {
        console.log("🛑 DUP → STOP");
        break;
      }

      catMovies.push(...fresh);

      progress[cat.name] = page;
      await saveProgress(progress);

      if (TEST_MODE) break;

      page++;
    }

    // =====================
    // 🔥 DETAIL
    // =====================
    console.log("🎬 DETAIL START");

    for (let i = 0; i < catMovies.length; i++) {
      const movie = catMovies[i];

      if (movie.servers) continue;

      console.log(`🎬 ${i + 1}/${catMovies.length}`);

      const embeds = await scrapeDetail(movie.url);
      await sleep(800);

      movie.servers = embeds.map(e => ({
        type: "embed",
        url: e
      }));
    }

    await fs.writeFile(`${cat.name}.json`, JSON.stringify(catMovies, null, 2));
    allMovies.push(...catMovies);
  }

  await fs.writeFile("movies.json", JSON.stringify(allMovies, null, 2));

  await commitChanges("auto update");
}

run();