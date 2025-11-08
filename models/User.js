// models/User.js  — OnionUnion 使用者模型（ESM）
// 依賴：mongoose@7+
// 特色：
// 1) handle 唯一、轉小寫；
// 2) email 採「partial unique index」：只對非空字串唯一，避免 {email: null} 撞重複；
// 3) 支援 wechat_id、角色、狀態、試用計數等欄位；
// 4) toJSON 時自動隱藏敏感欄位。

import mongoose from "mongoose";

const { Schema } = mongoose;

const CountersSchema = new Schema(
  {
    // 你的配額/計數可放這裡（示例）
    trialLeft: { type: Number, default: 3 }, // 新人三次試用
    usedCount: { type: Number, default: 0 }, // 問答累計次數（可用於 Tear EXP）
  },
  { _id: false }
);

const ClassStateSchema = new Schema(
  {
    // 角色抽籤/指派後可寫入（示例；實際可依你抽籤資料結構調整）
    tier: { type: String, default: "民層" }, // 民層/職層/貴族層/英雄層/王族層/神層
    family: { type: String, default: null }, // 家系/系別
    title: { type: String, default: null },  // 職稱/稱號
    level: { type: Number, default: 1 },     // Lv.1~100
    tearExp: { type: Number, default: 0 },   // 眼淚經驗（使用次數可對映）
    slotId: { type: Schema.Types.ObjectId, ref: "RoleSlot", default: null }, // 綁定名額
  },
  { _id: false }
);

const UserSchema = new Schema(
  {
    // 登入識別
    handle: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true, // 唯一（另有顯式 index 於下方）
    },

    // 可選：電子郵件（不一定會有）
    email: {
      type: String,
      default: null,
      trim: true,
      // 不在欄位層直接 unique，避免與 partial index 衝突
    },

    // 來自 CSV 的白名單比對欄位
    wechat_id: { type: String, default: null, trim: true },

    // 密碼與安全
    password_hash: { type: String, default: null }, // 認領後才會有
    must_reset_password: { type: Boolean, default: false },

    // 狀態與角色
    status: {
      type: String,
      enum: ["preorder", "active", "suspended", "deleted"],
      default: "preorder",
      index: true,
    },
    roles: {
      type: [String],
      default: ["member"], // 或 ["visitor"]：若要先訪客、付費後升級
      index: true,
    },

    // 統計與等級化狀態
    counters: { type: CountersSchema, default: () => ({}) },
    classState: { type: ClassStateSchema, default: () => ({}) },

    // 其他
    registered_at: { type: Date, default: null },
    last_login_at: { type: Date, default: null },

    // 備註/標籤
    tags: { type: [String], default: [] },
    memo: { type: String, default: "" },
  },
  {
    timestamps: true,
    minimize: true,
    versionKey: false,
    toJSON: {
      transform: (_doc, ret) => {
        // 隱藏敏感欄位
        delete ret.password_hash;
        delete ret.__v;
        return ret;
      },
    },
  }
);

/* =========================================
 * 索引設定
 * ======================================= */

// handle 唯一（保險再宣告一次顯式索引；與欄位 unique 相符）
UserSchema.index({ handle: 1 }, { unique: true, name: "handle_1" });

// email 僅對「非空字串」做唯一：避免 null/空字串撞重複
// 注意：使用 { email: { $gt: "" } } 以兼容 MongoDB 5/6/7 的 partial index 限制
UserSchema.index(
  { email: 1 },
  {
    unique: true,
    name: "email_1",
    partialFilterExpression: { email: { $gt: "" } }, // 僅非空字串會被索引與唯一化
  }
);

// 常用查詢可加速（可選）
UserSchema.index({ status: 1, "roles.0": 1 });

/* =========================================
 * 小工具方法（可選）
 * ======================================= */

UserSchema.methods.maskWechat = function () {
  if (!this.wechat_id) return null;
  const s = String(this.wechat_id);
  if (s.length <= 2) return "*".repeat(s.length);
  return s.slice(0, 1) + "*".repeat(Math.max(1, s.length - 2)) + s.slice(-1);
};

const User = mongoose.models.User || mongoose.model("User", UserSchema);
export default User;
