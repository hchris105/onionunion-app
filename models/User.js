// models/User.js
import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    handle:   { type: String, index: true, unique: true, sparse: true }, // 洋蔥聯盟帳號（可唯一、允許空）
    wechat_id:{ type: String, index: true, sparse: true },               // 微信號（允許重複、允許空）
    email:    { type: String, index: true, sparse: true },               // 官網/郵箱（唯一僅針對非空）
    status:   { type: String, default: "preorder", index: true },        // preorder | active | disabled...
    roles:    { type: [String], default: ["member"], index: true },
    password: { type: String },                                          // 初始用 wechat_id，首次登入強改
    must_reset_password: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "users" }
);

// 索引（注意與你的實際 DB 保持一致）
UserSchema.index({ wechat_id: 1 }, { name: "wechat_1",  sparse: true });
UserSchema.index({ status: 1 },    { name: "status_1",  background: true });
UserSchema.index({ roles: 1 },     { name: "roles_1",   background: true });
// email 僅對「非空字串」唯一，避免空值衝突
UserSchema.index(
  { email: 1 },
  { name: "email_1", unique: true, background: true, partialFilterExpression: { email: { $gt: "" } } }
);

// 同時提供 default 與具名輸出，避免其他檔案匯入方式不一致
const User = mongoose.models.User || mongoose.model("User", UserSchema);
export default User;
export { User };
