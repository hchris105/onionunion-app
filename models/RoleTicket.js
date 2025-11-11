// models/RoleTicket.js
import mongoose from "mongoose";

/**
 * 角色票（轉蛋池單位）
 * - tier: 六階 + 花菜使者（民層/職層/貴族層/英雄層/王族層/神層/花菜使者）
 * - series: 六系（泪系/光系/香系/声系/镜系/梦系），或 "花菜"、"變異" 等
 * - archetype: 職層/貴族/英雄/王族/神層的具名類別（例如「層典吏」「黑皮騎士」）
 * - title: 展示用名稱（與 archetype 同義，預留 i18n）
 * - code: 唯一代碼（例：民-泪-001、職-層典吏-01、貴-珍香侯-01、王-洋蔥國王-01）
 */
const RoleTicketSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    tier: { type: String, required: true, index: true },     // 民層/職層/貴族層/英雄層/王族層/神層/花菜使者
    series: { type: String, default: "", index: true },      // 泪系/光系/香系/声系/镜系/梦系/花菜/變異/空
    archetype: { type: String, default: "", index: true },   // 如：層典吏/珍香侯/黑皮騎士/洋蔥國王/層母...
    title: { type: String, default: "" },                    // 顯示名
    art_slug: { type: String, default: "" },                 // 對應美術檔名
    r: { type: Number, required: true, index: true },        // [0,1) 抽卡亂數鍵
    available: { type: Boolean, default: true, index: true },
    assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    assigned_at: { type: Date, default: null },
    note: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false }
);

RoleTicketSchema.index({ available: 1, r: 1 });
export default mongoose.model("RoleTicket", RoleTicketSchema);
