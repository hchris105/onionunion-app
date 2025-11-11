// services/roles.js — 從 roletickets 抽一張未使用票，標記為已用
import mongoose from "mongoose";

let RoleTicket;
try { RoleTicket = mongoose.model("RoleTicket"); } catch {
  const schema = new mongoose.Schema({
    code: { type: String, unique: true, index: true },
    tier: { type: String, index: true },     // 民層 / 職層 / 貴族層 / 英雄層 / 王族層 / 神層 / 花菜使者
    family: { type: String, default: null },  // 可選：細分類
    used: { type: Boolean, default: false, index: true },
    used_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    used_at: { type: Date, default: null },
  }, { collection: "roletickets", timestamps: true });
  RoleTicket = mongoose.model("RoleTicket", schema);
}

export async function drawRoleForUser(userId) {
  // 隨機抽：讓 Mongo 按 _id 近似隨機；如需嚴格隨機可換成 $sample
  const ticket = await RoleTicket.findOneAndUpdate(
    { used:false },
    { $set: { used:true, used_by:userId, used_at:new Date() } },
    { sort: { _id: 1 }, new: true }   // 先來先抽；要真正隨機可改 { $sample: { size: 1 } }
  ).lean();
  return ticket || null;
}
