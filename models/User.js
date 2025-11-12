// models/User.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    handle: { type: String, index: true, unique: true, sparse: false }, // 平台主鍵（建議唯一）
    email:  { type: String, index: true, default: '' },                 // 官網帳號（可空，空的不唯一）
    wechat_id: { type: String, index: true, sparse: true, default: ''}, // 微信號（可空、允許重複）
    roles:  { type: [String], default: ['member'], index: true },
    status: { type: String, default: 'preorder', index: true },         // preorder | active ...
    password: { type: String, default: '' },                            // 初始用 wechat_id
    must_reset_password: { type: Boolean, default: false },
    profile: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// 索引（用 createIndex 保證條件與唯一性）
userSchema.index({ wechat_id: 1 }, { sparse: true, name: 'wechat_1' });
userSchema.index(
  { email: 1 },
  {
    name: 'email_1',
    unique: true,
    background: true,
    partialFilterExpression: { email: { $gt: '' } }, // 只有非空才唯一
  }
);
userSchema.index({ handle: 1 }, { name: 'handle_1', unique: true });

const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;
