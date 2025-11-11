// node scripts/seed_monthly_civilian_mutations.js
import mongoose from "mongoose";
import RoleTicket from "../models/RoleTicket.js";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/onionunion";
const COUNT = Number(process.env.CIVIL_MUTANTS_MONTHLY || 0);

const pad = (n, w=3) => String(n).padStart(w, "0");
const rand = () => Math.random();

async function main(){
  if (COUNT <= 0) { console.log("[mutants] skip: COUNT=0"); return; }
  await mongoose.connect(MONGODB_URI);

  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`; // YYYYMM

  let created = 0;
  for (let i=1; i<=COUNT; i++) {
    const code = `民-變-${ym}-${pad(i)}`;
    try {
      await RoleTicket.create({
        code, tier: "民層", series: "變異", archetype: "變異民",
        title: "變異民", r: rand(), available: true,
        note: `民層變異（${ym}）`,
      });
      created++;
    } catch(e) {
      if (!String(e?.message||"").includes("duplicate key")) {
        console.error(`[mutants] fail ${code}:`, e.message);
      }
    }
  }

  const total = await RoleTicket.countDocuments({ tier:"民層", series:"變異" });
  console.log(`[mutants] done ${ym}: created=${created}, total_mutants=${total}`);
  await mongoose.disconnect();
}
main().catch(e=>{ console.error(e); process.exit(1); });
