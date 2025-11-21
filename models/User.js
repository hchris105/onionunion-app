// backend/models/User.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * User schema
 *
 * 主要欄位整理自 交接.md：
 * - handle: 登入 ID（唯一、大小寫不敏感，建議統一存小寫）
 * - email, wechat_id: 聯絡方式（可選）
 * - roles: 角色（"member", "admin" 等）
 * - status: 帳號狀態：
 *   "preorder" | "trial" | "active" | "refunded" | "disabled" | "locked"
 * - passwordHash: bcrypt 雜湊
 * - must_change_password: 首登是否強制改密碼
 *
 * - character_*: 500 角色相關欄位
 * - trial_ask_limit / trial_ask_used: 試用次數
 *
 * 另外加上 created_at / updated_at timestamp。
 */

const UserSchema = new Schema(
  {
    // ---- 基本身份 ----
    handle: {
      type: String,
      required: true,
      trim: true,
      lowercase: true, // 統一存小寫，查詢時也用小寫
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    wechat_id: {
      type: String,
      trim: true,
    },

    // ---- 權限與狀態 ----
    roles: {
      type: [String],
      default: ["member"],
    },
    status: {
      type: String,
      enum: [
        "preorder",
        "trial",
        "active",
        "refunded",
        "disabled",
        "locked",
      ],
      default: "preorder",
      index: true,
    },

    passwordHash: {
      type: String,
    },
    must_change_password: {
      type: Boolean,
      default: true,
    },

    // ---- 500 角色相關 ----
    character_code: { type: String, index: true }, // e.g. "T001"
    character_name: { type: String },
    character_line: { type: String }, // 系統/陣營，例如 泪系/光系...
    character_assigned_at: { type: Date },

    // ---- Trial 配額 ----
    trial_ask_limit: {
      type: Number,
      default: 3,
    },
    trial_ask_used: {
      type: Number,
      default: 0,
    },

    // ---- 其他預留欄位（之後可擴充用）----
    // 例如以后要加：wallet, ylx, ctx, login_logs 等，可以直接在這邊擴充
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);

// ---- 索引設定 ----

// handle 必須唯一，且因為 lowercase:true，DB 內會是小寫版
UserSchema.index({ handle: 1 }, { unique: true });

// email / wechat_id 可重複，但常用於查詢，所以加非唯一索引
UserSchema.index({ email: 1 }, { sparse: true });
UserSchema.index({ wechat_id: 1 }, { sparse: true });

// 角色/狀態 + 角色代碼，方便後台查詢
UserSchema.index({ status: 1, character_code: 1 });

// ---- helper：回傳給前端時，隱藏敏感欄位 ----
UserSchema.methods.toSafeObject = function () {
  const obj = this.toObject({ virtuals: true });
  delete obj.passwordHash;
  delete obj.__v;
  return obj;
};

const User =
  mongoose.models.User || mongoose.model("User", UserSchema);

export default User;
