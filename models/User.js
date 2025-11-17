import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    handle:   { type: String, required: true, trim: true }, // 唯一由索引保護
    email:    { type: String, default: "", trim: true, lowercase: true },
    wechat_id:{ type: String, default: "", trim: true },

    roles:    { type: [String], default: [] },        // e.g. ["member"]
    status:   { type: String, default: "preorder" },  // "preorder" | "active" | ...
    passwordHash: { type: String },

    // 其它你原本的欄位…
  },
  { timestamps: true, minimize: true }
);

/** 索引策略（與 DB 一致） */
UserSchema.index({ handle: 1 },   { unique: true,  name: "handle_1" });
UserSchema.index({ email: 1 },    { name: "email_1" });           // 非唯一
UserSchema.index({ wechat_id: 1 },{ name: "wechat_id_1" });       // 非唯一
UserSchema.index({ status: 1 },   { name: "status_1" });
UserSchema.index({ roles: 1 },    { name: "roles_1" });

export default mongoose.models.User || mongoose.model("User", UserSchema);
