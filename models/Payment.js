import mongoose from "mongoose";
const PaymentSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", index:true },
  provider: { type:String, default:"manual" }, // 先手動
  plan_id: { type:String, default:"monthly-99" },
  status: { type:String, enum:["succeeded","pending","failed","canceled"], default:"succeeded" },
  period_start: { type:Date, default:()=>new Date() },
  period_end:   { type:Date, default:()=>new Date(Date.now()+30*24*3600*1000) },
  raw: { type:Object }
});
export default mongoose.model("Payment", PaymentSchema);
