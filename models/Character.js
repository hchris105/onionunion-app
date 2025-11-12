// models/Character.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const CharacterSchema = new Schema(
  {
    code: { type: String, required: true, trim: true }, // 唯一代碼 e.g. CIV-TEAR-001
    name: { type: String, required: true, trim: true }, // 角色顯示名
    tier: { type: String, required: true, trim: true }, // 民層/職層/貴族層...
    series: { type: String, default: '' },              // 泪系/光系/香系...
    archetype: { type: String, default: '' },           // 子型
    r: { type: Number, default: 0 },                    // 稀有度/抽籤權重（可選）
    available: { type: Boolean, default: true },        // 是否可用
    used: { type: Boolean, default: false },            // 是否已分配
    assigned_to: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'characters' }
);

// 索引
CharacterSchema.index({ code: 1 }, { name: 'code_1', unique: true });
CharacterSchema.index({ tier: 1, series: 1 }, { name: 'tier_series_1' });
CharacterSchema.index({ used: 1, available: 1 }, { name: 'used_available_1' });

export const Character = mongoose.models.Character || mongoose.model('Character', CharacterSchema);
