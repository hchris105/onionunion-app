// models/User.js
import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    handle: { type: String, required: true, unique: true, index: true },
    name: { type: String },

    // 關鍵欄位
    status: { type: String, enum: ['preorder', 'active', 'disabled'], default: 'preorder', index: true },
    password_hash: { type: String, default: null },
    must_reset_password: { type: Boolean, default: false },

    // 預留（若之後要用）
    signup_token: { type: String, default: null },
    signup_expires: { type: Date, default: null },
    reset_token: { type: String, default: null },
    reset_expires: { type: Date, default: null },

    registered_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

export default mongoose.model('User', UserSchema);
