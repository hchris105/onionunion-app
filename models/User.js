// models/User.js
import mongoose from "mongoose";

const ClassStateSchema = new mongoose.Schema(
  {
    tier: { type: String, default: "民層" }, // 六階之一
    family: { type: String, default: null },
    title: { type: String, default: null },
    level: { type: Number, default: 1 },
    tearExp: { type: Number, default: 0 },
    slotId: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const CountersSchema = new mongoose.Schema(
  {
    trialLeft: { type: Number, default: 3 },
    usedCount: { type: Number, default: 0 },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    handle: { type: String, index: true, unique: false, sparse: false },
    nickname: { type: String, default: "" },
    email: { type: String, index: true, unique: false, sparse: true, default: null },
    wechat_id: { type: String, index: true, unique: false, sparse: true, default: null },

    // 這裡重點：預設不選出，避免你前面 projection 衝突
    password_hash: { type: String, select: false },

    status: { type: String, default: "preorder", index: true }, // preorder | active | disabled...
    roles: { type: [String], default: ["member"], index: true },

    classState: { type: ClassStateSchema, default: () => ({}) },
    counters: { type: CountersSchema, default: () => ({}) },

    must_reset_password: { type: Boolean, default: false },
    memo: { type: String, default: "" },
    tags: { type: [String], default: [] },

    registered_at: { type: Date, default: null },
    last_login_at: { type: Date, default: null },

    role_ticket_code: { type: String, default: null },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
    versionKey: false,
  }
);

// 去掉會噴警告的重複索引（保留必要的）
UserSchema.index({ handle: 1 });
UserSchema.index({ email: 1 }, { sparse: true });
UserSchema.index({ wechat_id: 1 }, { sparse: true });
UserSchema.index({ status: 1 });
UserSchema.index({ roles: 1 });

export const User = mongoose.models.User || mongoose.model("User", UserSchema);
export default User;
