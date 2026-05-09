const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs"); 
const fsp = require("fs/promises"); 
const { exec } = require("child_process");
const WISEPLAY_DIR = "wiseplay";
const DOMAIN = "https://lk-hds.com";
// =========================
// 🔥 GENERATE M3U
// =========================
async function generateM3U(filename, movies) {
  let lines = ["#EXTM3U"];

  for (const movie of movies) {
    if (!movie.servers || movie.servers.length === 0) continue;

    // ✅ เอาเฉพาะ M3U8 (ลื่นสุด)
    const server = movie.servers.find(s => s.name === "M3U8");
    if (!server?.url) continue;

    const title = movie.title || "No Title";
    const group = movie.group || "Movies";
    const logo = movie.logo || "";

    lines.push(
      `#EXTINF:-1 group-title="${group}" tvg-logo="${logo}",${title}`
    );
    lines.push(server.url);
  }

  await fsp.writeFile(filename, lines.join("\n"), "utf-8");
  console.log("📺 M3U CREATED:", filename);
}
const PROGRESS_FILE = "progress.json";
const TEST_MODE = false;
const COMMIT_EVERY = 30;
let savedCategories = {};

const categories = [
  // 🔥 TAG
  { name: "หนังใหม่ 2026", type: "tag", id: "268", file: "หนังใหม่ 2026" },
  { name: "หนังใหม่ 2025", type: "tag", id: "230", file: "หนังใหม่ 2025" },

  // 🔥 CATEGORY
  { name: "หนังฝรั่ง", type: "category", id: "5", file: "หนังฝรั่ง" },
  { name: "หนังไทย", type: "category", id: "7", file: "หนังไทย" },
  { name: "หนังจีน", type: "category", id: "8", file: "หนังจีน" },
  { name: "หนังเกาหลี", type: "category", id: "6", file: "หนังเกาหลี" },
  { name: "หนังญี่ปุ่น", type: "category", id: "9", file: "หนังญี่ปุ่น" },
  { name: "Netflix", type: "category", id: "11", file: "Netflix" },
  { name: "Marvel", type: "category", id: "221", file: "Marvel" },
  { name: "หนังภาคต่อ", type: "category", id: "10", file: "หนังภาคต่อ" }
];

// delay
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// progress
async function loadProgress() {
  try { return JSON.parse(await fsp.readFile(PROGRESS_FILE, "utf-8")); }
  catch { return {}; }
}

async function saveProgress(progress) {
  await fsp.writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// =========================
// 🔥 ดึง config จริงจากหน้าเว็บ
// =========================
async function getAjaxConfig(cat) {
  const url = cat.type === "tag"
    ? `https://lk-hds.com/?tag_id=${cat.id}`
    : `https://lk-hds.com/?cat=${cat.id}`;

  const res = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "text/html",
      "Referer": "https://lk-hds.com/"
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
  ? `https://lk-hds.com/?tag_id=${cat.id}`
  : `https://lk-hds.com/?cat=${cat.id}`,
          "Origin": "https://lk-hds.com",
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

    // 🔥 1. iframe ปกติ
    $(".player-api iframe").each((i, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src");
if (src) {
  const clean = src.replace(/\/1$/, ""); // 🔥 ตัด /1 ทิ้ง
  embeds.push(clean);
}
    });

    // 🔥 2. fallback: playercheck
    if (embeds.length === 0) {
      const scriptMatch = data.match(/playercheck\.php\?vid=([a-zA-Z0-9_]+)/);
      if (scriptMatch) {
        const vid = scriptMatch[1];
        embeds.push(`https://player.enjoy24cdn.com/embed/${vid}/`);
      }
    }

    // 🔥 3. fallback: embed ตรง
    if (embeds.length === 0) {
      const match = data.match(/embed\/([a-zA-Z0-9]+)/);
      if (match) {
        embeds.push(`https://player.enjoy24cdn.com/embed/${match[1]}/`);
      }
    }

    // 🔥 ถ้ามี embed → ไป extract m3u8
    if (embeds.length > 0) {
      const results = [];

      for (const embedUrl of embeds) {
        const result = await extractM3U8(embedUrl);

        results.push({
          embed: result?.playUrl || embedUrl,
          m3u8: result?.m3u8 || null
        });
      }

      return results;
    }

    // 🔥 หา vid ตรง
    const vidMatch = data.match(/vid["'\s:=]+([a-zA-Z0-9_]+)/);

    if (vidMatch) {
      const vid = vidMatch[1];

      try {
        // STEP 1
        const { data: dataRes } = await axios.get(
          `https://player.enjoy24cdn.com/data.php?vid=${vid}&uid=1`,
          {
            headers: {
              "User-Agent": "Mozilla/5.0",
              "Referer": `https://player.enjoy24cdn.com/embed/${vid}/1`,
              "x-auth-token": "195610202"
            }
          }
        );

        if (!dataRes?.data?.length) return [];

        const apiUrl = dataRes.data[0].api;

        // STEP 2
        const { data: jsonRes } = await axios.get(apiUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Referer": `https://player.enjoy24cdn.com/embed/${vid}/1`
          }
        });

        // STEP 3
        let realId = JSON.stringify(jsonRes).match(/hlsr2\/([a-z0-9]+)\//i)?.[1];
        if (!realId) realId = vid;

        return [{
          embed: `https://original.enjoy24cdn.com/play/${realId}`,
          m3u8: `https://original.enjoy24cdn.com/hlsr2/${realId}/master.m3u8`
        }];

      } catch (err) {
        console.log("❌ vid flow error:", err.message);
        return [];
      }
    }

    return [];

  } catch (err) {
    console.log("detail error:", err.message);
    return [];
  }
}

async function extractM3U8(embedUrl) {
  try {
    // 🔹 1. ดึง vid
    const vidMatch = embedUrl.match(/\/embed\/([a-zA-Z0-9]+)/);
    if (!vidMatch) return null;
    const vid = vidMatch[1];

    // 🔹 2. generate token (เหมือนหน้าเว็บ)
    const token = Buffer.from(Date.now().toString()).toString("base64");

    // 🔹 3. ยิง API จริง
    const { data } = await axios.post(
      "https://player.enjoy24cdn.com/ajax/get_video_streams/",
      {
        vid: vid,
        token: token
      },
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Content-Type": "application/json",
          "Referer": embedUrl,
          "Origin": "https://player.enjoy24cdn.com"
        }
      }
    );

    if (!data || !data.streams) {
      console.log("❌ no streams");
      return null;
    }

    // 🔥 หา stream ที่ใช้ได้
    const stream = data.streams.find(s => s.status == "1");

    if (stream && stream.link) {
  const playUrl = stream.link;

  // 🔥 ยิง play page ต่อ
  const { data: playData } = await axios.get(playUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Referer": embedUrl
    }
  });

  // 🔥 หา m3u8
  let match = null;

// 🔥 แบบ 1: const url = "...m3u8"
match = playData.match(/const\s+url\s*=\s*["']([^"']+\.m3u8[^"']*)/);
if (match) {
  console.log("🎯 FOUND m3u8:", match[1]);
  return {
    playUrl: playUrl,
    m3u8: match[1]
  };
}

// 🔥 แบบ 2: m3u8 ปกติ
match = playData.match(/https?:\/\/[^"']+\.m3u8[^"']*/);
if (match) {
  console.log("🎯 FOUND m3u8:", match[0]);
  return {
  playUrl: playUrl,
  m3u8: match[0]
};
}

// 🔥 แบบ 3: filesr2 (IDM จับได้)
match = playData.match(/https?:\/\/[^"']+\/filesr2\/[^"']+\/index/);
if (match) {
  console.log("🎯 FOUND filesr2:", match[0]);
  return {
  playUrl: playUrl,
  m3u8: match[0]
};
}
console.log("❌ no m3u8 in play page");
return null;
}

    console.log("❌ no valid stream");
    return null;

  } catch (err) {
    console.log("m3u8 error:", err.message);
    return null;
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

async function generateWiseplay(filename, movies, groupName) {

  let output = {
    name: groupName,
    author: new Date().toLocaleDateString("th-TH"),
    image: "https://lk-hds.com/wp-content/uploads/2023/08/lk-hd-logo.png",
    url: DOMAIN,
    groups: []
  };

  for (const movie of movies) {

    if (!movie.servers) continue;

    let group = {
      name: movie.title,
      image: movie.logo,
      stations: []
    };

    for (const s of movie.servers) {
      group.stations.push({
        name: s.name,
        image: movie.logo,
        url: s.url,
        referer: DOMAIN
      });
    }

    if (group.stations.length > 0) {
      output.groups.push(group);
    }
  }

  fs.writeFileSync(
    `${WISEPLAY_DIR}/${filename}`,
    JSON.stringify(output, null, 2)
  );

  console.log("📺 WISEPLAY:", filename);
}

function generateIndex(jsonOutput) {
  const baseRaw = "https://raw.githubusercontent.com/Hssmnoy/hdx/main/wiseplay/";

  const index = {
    name: "LK-HDS",
    author: new Date().toLocaleDateString("th-TH"),
    image: "https://lk-hds.com/wp-content/uploads/2023/08/lk-hd-logo.png",
    url: "https://lk-hds.com/",
    groups: []
  };

  for (const group in jsonOutput) {
    index.groups.push({
      name: group,
      image: "https://lk-hds.com/wp-content/uploads/2023/08/lk-hd-logo.png",
      url: `${baseRaw}${group}.json`
    });
  }

  const file = `${WISEPLAY_DIR}/index.json`;

  fs.writeFileSync(file, JSON.stringify(index, null, 2));

  console.log("📦 index.json created");
}

// =========================
// 🔥 MAIN
// =========================
async function run() {

  let progress = await loadProgress();

  // 🔥 INIT CONFIG
  const ajaxConfigs = {};
  for (const cat of categories) {
    console.log("🔑 INIT:", cat.name);
    ajaxConfigs[cat.name] = await getAjaxConfig(cat);
  }
  
  await fsp.mkdir(WISEPLAY_DIR, { recursive: true });
  
  for (const cat of categories) {
    console.log("📁 SCRAPING:", cat.name);
savedCategories[cat.name] = {
  name: cat.name,
  file: `${cat.file}.json`
};
    
    let catMovies = [];

    try {
      const old = await fs.readFile(`${cat.name}.json`, "utf-8");
      catMovies = JSON.parse(old);
      console.log("♻️ old:", catMovies.length);
    } catch {}

    let page = 1;

    while (page <= 3) {
      console.log("📄 PAGE:", page);

      const movies = await scrapePageAjax(cat, page, ajaxConfigs[cat.name]);
      await sleep(1200);

      if (movies.length === 0) {
        console.log("📌 END");
        break;
      }

      const exist = new Set(catMovies.map(m => `${m.title}`));
      const fresh = movies.filter(m => !exist.has(`${m.title}`));

      if (fresh.length === 0) {
        console.log("🛑 เจอหน้าที่ไม่มีของใหม่ → STOP");
         break;
      }

      catMovies.unshift(...fresh.reverse());

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

      if (movie.servers || !movie.url) continue;

      console.log(`🎬 ${i + 1}/${catMovies.length}`);

      const embeds = await scrapeDetail(movie.url);
await sleep(800);

movie.servers = [];

let firstM3U8 = null;
let firstEmbed = null;

if (embeds.length === 0) {
  const vidMatch = movie.url.match(/\/([a-zA-Z0-9-]+)\/$/);
  if (vidMatch) {
    firstEmbed = `https://original.enjoy24cdn.com/play/${vidMatch[1]}`;
  }
} else {
  for (const e of embeds) {
    if (!firstM3U8 && e.m3u8) {
      firstM3U8 = e.m3u8;
    }
    if (!firstEmbed && e.embed) {
      firstEmbed = e.embed;
    }
  }
}

movie.servers = [];

// ✅ Server 1: m3u8
if (firstM3U8) {
  movie.servers.push({
    name: "M3U8",
    url: firstM3U8
  });
}

// ✅ Server 2: embed
if (firstEmbed) {
  movie.servers.push({
    name: "Embed",
    url: firstEmbed
  });
}

// ✅ fallback (กันไม่มี server)
if (movie.servers.length === 0 && movie.url) {
  movie.servers.push({
    name: "Default",
    url: movie.url
  });
}

// ✅ map field ให้ frontend ใช้ได้
movie.logo = movie.poster;
movie.group = cat.name;
movie.title = movie.title || movie.name;      
delete movie.poster;
delete movie.url;

      // 🔥 บันทึกไฟล์ JSON ระหว่างทาง
      await fsp.writeFile(`${cat.name}.json`, JSON.stringify(catMovies, null, 2));

      // 🔥 commit ระหว่างทาง
      if (COMMIT_EVERY > 0 && (i + 1) % COMMIT_EVERY === 0) {
  console.log("💾 COMMIT EVERY:", i + 1);
  await commitChanges(`auto update ${cat.name} - ${i + 1}/${catMovies.length}`);
}
    }
    
console.log("📦 COMMIT END CATEGORY:", cat.name);
await commitChanges(`finish ${cat.name}`);


  await generateM3U(`${cat.name}.m3u`, catMovies);
 
  await generateWiseplay(
  (cat.file || cat.name).replace(/\s+/g, "-") + ".json",
  catMovies,
  cat.name
);
 
  await commitChanges(`finish ${cat.name}`);
}

await commitChanges("auto update");
}

run().then(() => {
  generateIndex(savedCategories);
});
