// models/User.js
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    handle: {
      type: String,
      required: true,
      index: true,
    },
    email: {
      type: String,
      index: true,
      sparse: true,
    },
    password: {
      type: String,
    },
    wechat_id: {
      type: String,
    },

    // 角色與狀態
    roles: {
      type: [String],
      default: ["member"],
    },
    status: {
      type: String,
      default: "preorder", // preorder / trial / active / member / refunded / disabled / locked
      index: true,
    },
    must_change_password: {
      type: Boolean,
      default: true,
    },

    // 抽到的 Onion 角色
    character_code: {
      type: String,
    },
    character_name: {
      type: String,
    },
    character_line: {
      type: String,
    },
    character_assigned_at: {
      type: Date,
    },

    // Trial 試用次數
    // limit 若為 null，後端會當作 3（或你之後想改成 env）
    trial_ask_limit: {
      type: Number,
      default: null,
    },
    trial_ask_used: {
      type: Number,
      default: 0,
    },

    created_at: {
      type: Date,
      default: Date.now,
    },
    updated_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "users",
  }
);

userSchema.pre("save", function (next) {
  this.updated_at = new Date();
  next();
});

const User = mongoose.model("User", userSchema);
export default User;
