// models/User.js
import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    handle: { type: String, required: true, trim: true },      // 僅白名單就可成立
    email:  { type: String, default: null },                   // 等註冊才填
    password_hash: { type: String, default: null, select: false }, // 非必填
    preorder: { type: Boolean, default: false },               // 是否在預約白名單
    role: { type: String, enum: ["visitor","member","admin"], default: "visitor" },
  },
  { timestamps: true }
);

// 索引：handle 不分大小寫唯一
UserSchema.index(
  { handle: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

// 索引：email 僅在 email 為 string 時唯一（partial unique）
UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string" } } }
);

export default mongoose.models.User || mongoose.model("User", UserSchema);
