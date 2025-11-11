// node scripts/seed_roles_pool.js
import mongoose from "mongoose";
import RoleTicket from "../models/RoleTicket.js";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/onionunion";
const pad = (n, w=2) => String(n).padStart(w, "0");
const rand = () => Math.random();
const abbr = (s) => String(s).trim()[0]; // 民/職/貴/英/王/神/花；泪/光/香/声/镜/梦

// 1) 民層（312 = 6系 * 52）
const CIV_SERIES = ["泪系","光系","香系","声系","镜系","梦系"];
const CIV_PER_SERIES = 52;

// 2) 職層（10職能 × 各8 = 80）
const JOBS = [
  "層典吏","時計司","層稅官","香氣判官","霧郵官",
  "泪譯官","祭香師","味記官","地窖守","夜聲吏",
];
const JOB_COUNT = 8;

// 3) 貴族層（8家系，共50名；分配可調）
const NOBLES = [
  ["珍香侯", 8], ["銀紋伯", 7], ["黑泪女伯", 7], ["皮鏡男爵", 6],
  ["影宴侯", 6], ["夢幣公", 6], ["霧舌伯", 5], ["泪樞主", 5],
];

// 4) 英雄層（8原型 × 各5 = 40）
const HEROES = [
  "黑皮騎士","炎舌騎士","銀芽勇士","層刃武僧",
  "霧隱者","芳影獵","玻璃劍客","泪潮旅者",
];
const HERO_COUNT = 5;

// 5) 王族層（6 唯一）
const ROYALS = ["洋蔥國王","洋蔥王妃","泪爵","香雾侯","鱗紋女爵","皮語女巫"];

// 6) 神層（6 唯一）
const GODS = ["層母","泪王","芳香者","腐心神","無層者","泥之審判"];

// 7) 花菜王國使者（3 × 各2 = 6）
const CAULI = [["花菜使",2],["花菜使女",2],["花菜賢者",2]];

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("[roles] seeding…");

  let created = 0;

  // --- 民層 ---
  for (const series of CIV_SERIES) {
    for (let i=1; i<=CIV_PER_SERIES; i++) {
      const code = `民-${abbr(series)}-${pad(i,3)}`; // 民-泪-001
      await upsert(code, {
        tier: "民層", series, archetype: "", title: "",
        note: "民層：六系各52；僅民層可升階",
      }); created++;
    }
  }

  // --- 職層 ---
  for (const job of JOBS) {
    for (let i=1; i<=JOB_COUNT; i++) {
      const code = `職-${job}-${pad(i)}`; // 職-層典吏-01
      await upsert(code, { tier:"職層", series:"", archetype:job, title:job });
      created++;
    }
  }

  // --- 貴族層 ---
  for (const [name, cnt] of NOBLES) {
    for (let i=1; i<=cnt; i++) {
      const code = `貴-${name}-${pad(i)}`;
      await upsert(code, { tier:"貴族層", series:"", archetype:name, title:name });
      created++;
    }
  }

  // --- 英雄層 ---
  for (const name of HEROES) {
    for (let i=1; i<=HERO_COUNT; i++) {
      const code = `英-${name}-${pad(i)}`;
      await upsert(code, { tier:"英雄層", series:"", archetype:name, title:name });
      created++;
    }
  }

  // --- 王族層（唯一） ---
  for (const name of ROYALS) {
    const code = `王-${name}-01`;
    await upsert(code, { tier:"王族層", series:"", archetype:name, title:name });
    created++;
  }

  // --- 神層（唯一） ---
  for (const name of GODS) {
    const code = `神-${name}-01`;
    await upsert(code, { tier:"神層", series:"", archetype:name, title:name });
    created++;
  }

  // --- 花菜使者 ---
  for (const [name, cnt] of CAULI) {
    for (let i=1; i<=cnt; i++) {
      const code = `花-${name}-${pad(i)}`;
      await upsert(code, { tier:"花菜使者", series:"花菜", archetype:name, title:name, note:"跨界使者" });
      created++;
    }
  }

  const total = await RoleTicket.countDocuments();
  console.log(`[roles] done. total=${total} (created_now=${created})`);
  await mongoose.disconnect();
}

async function upsert(code, base) {
  try {
    await RoleTicket.updateOne(
      { code },
      { $setOnInsert: { ...base, code, r: rand(), available: true } },
      { upsert: true }
    );
  } catch (e) {
    if (!String(e?.message||"").includes("duplicate key")) {
      console.error("create failed:", code, e.message);
    }
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
