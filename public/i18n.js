// i18n.js — 全局多語，切換即時替換所有 data-i18n / data-i18n-ph
const I18N = {
  "zh-Hans": {
    hero_title: "诸象归一，成其一解",
    hero_sub:  "以多径路由与合成，收拢分散的线索，缀成一份完整而可用的解读；兼顾节奏与边界，留有余地与回望。",
    title:"提交资料 · 立即生成报告",
    subtitle:"填好关键信息，系统会自动择优并融合方法，输出可执行建议与风险对策。",

    field_name:"姓名", field_birth:"生日", field_mother:"母亲姓名（可选）",
    field_mbti:"MBTI（可选）",              // ✅ 新增
    mbti_unknown:"不确定 / 暂不提供",        // ✅ 新增

    field_target_name:"对方姓名（可选）", field_target_birth:"对方生日（可选）", field_target_mother:"对方母亲姓名（可选）",
    field_when:"参考时间（可选）", hint_when:"不填由系统自定；用于择时。",
    field_loc:"所在地（可选）",
    field_question:"你的问题", advanced:"进阶条件（可选）",
    ph_question:"请清楚描述你的问题与目标。",

    btn_submit:"生成报告", btn_reset:"清空",
    summary:"结论 · 摘要", btn_again:"再问一题",
    legal:"仅供陪伴与个人见解参考，不构成医疗/法律/投资建议。",

    nav_more:"快速前往…",
    nav_pricing:"定价", nav_services:"服务", nav_privacy:"隐私", nav_terms:"条款", nav_members:"会员",

    p0:"初始化…", p1:"读取路由…", p2:"标注与打分…", p3:"裁剪候选…", p4:"合成主/辅方法…",
    p5:"生成段落…", p6:"检查风险与边界…", p7:"收尾与格式化…", p8:"完成"
  },

  "zh-Hant": {
    hero_title: "諸象歸一，成其一解",
    hero_sub:  "以多徑路由與合成，收攏分散的線索，綴成一份完整而可用的解讀；兼顧節奏與邊界，仍留餘地與回望。",
    title:"提交資料 · 立即生成報告",
    subtitle:"填好關鍵資訊，系統會自動擇優並融合方法，輸出可執行建議與風險對策。",

    field_name:"姓名", field_birth:"生日", field_mother:"母親姓名（可選）",
    field_mbti:"MBTI（可選）",              // ✅ 新增
    mbti_unknown:"不確定 / 暫不提供",        // ✅ 新增

    field_target_name:"對方姓名（可選）", field_target_birth:"對方生日（可選）", field_target_mother:"對方母親姓名（可選）",
    field_when:"參考時間（可選）", hint_when:"不填由系統自定；用於擇時。",
    field_loc:"所在地（可選）",
    field_question:"你的問題", advanced:"進階條件（可選）",
    ph_question:"請清楚描述你的問題與目標。",

    btn_submit:"生成報告", btn_reset:"清空",
    summary:"結論 · 摘要", btn_again:"再問一題",
    legal:"僅供陪伴與個人見解參考，不構成醫療/法律/投資建議。",

    nav_more:"快速前往…",
    nav_pricing:"定價", nav_services:"服務", nav_privacy:"隱私", nav_terms:"條款", nav_members:"會員",

    p0:"初始化…", p1:"讀取路由…", p2:"標註與打分…", p3:"裁剪候選…", p4:"合成主／副方法…",
    p5:"生成段落…", p6:"檢查風險與邊界…", p7:"收尾與格式化…", p8:"完成"
  },

  "en": {
    hero_title: "Many signs, one reading",
    hero_sub:  "Through multi-path routing and composition, scattered clues are woven into a coherent, usable reading—keeping cadence and boundaries, with room to revisit.",
    title:"Submit info · Generate report",
    subtitle:"Fill the key fields; the system selects & fuses methods to deliver actionable guidance with risk controls.",

    field_name:"Name", field_birth:"Birthdate", field_mother:"Mother’s name (optional)",
    field_mbti:"MBTI (optional)",               // ✅ New
    mbti_unknown:"Not sure / Prefer not to say", // ✅ New

    field_target_name:"Counterparty name (optional)", field_target_birth:"Counterparty birthdate (optional)", field_target_mother:"Counterparty mother (optional)",
    field_when:"Reference date (optional)", hint_when:"Leave empty to auto; used for timing.",
    field_loc:"Location (optional)",
    field_question:"Your question", advanced:"Advanced (optional)",
    ph_question:"Describe your question and goal clearly.",

    btn_submit:"Generate report", btn_reset:"Clear",
    summary:"Summary", btn_again:"Ask another",
    legal:"For companionship/personal reference; not medical/legal/financial advice.",

    nav_more:"Quick menu…",
    nav_pricing:"Pricing", nav_services:"Services", nav_privacy:"Privacy", nav_terms:"Terms", nav_members:"Members",

    p0:"Initializing…", p1:"Loading router…", p2:"Tagging & scoring…", p3:"Pruning candidates…", p4:"Fusing main/assistant methods…",
    p5:"Composing sections…", p6:"Risk & guardrails…", p7:"Finalizing…", p8:"Done"
  },

  "ja": {
    hero_title: "諸相は一に結び、ひとつの解へ",
    hero_sub:  "多経路のルーティングと合成で散らばる手掛かりを編み上げ、完成度の高い読みへ。リズムと境界を保ち、見直しの余白も残します。",
    title:"情報入力 · すぐにレポート生成",
    subtitle:"主要項目を入力すると、最適手法を自動選定・統合し、実行可能な提案とリスク対策を提示します。",

    field_name:"氏名", field_birth:"生年月日", field_mother:"母親の氏名（任意）",
    field_mbti:"MBTI（任意）",                // ✅ 追加
    mbti_unknown:"未定／非公開",               // ✅ 追加

    field_target_name:"相手の氏名（任意）", field_target_birth:"相手の生年月日（任意）", field_target_mother:"相手の母親名（任意）",
    field_when:"参照日（任意）", hint_when:"未入力なら自動。時刻に使用。",
    field_loc:"所在地（任意）",
    field_question:"質問内容", advanced:"詳細条件（任意）",
    ph_question:"質問と目的を明確に記入してください。",

    btn_submit:"レポート生成", btn_reset:"クリア",
    summary:"要約", btn_again:"もう一件",
    legal:"娯楽/個人的見解の参考のみで、医療/法律/投資助言ではありません。",

    nav_more:"クイックメニュー…",
    nav_pricing:"価格", nav_services:"サービス", nav_privacy:"プライバシー", nav_terms:"規約", nav_members:"会員",

    p0:"初期化…", p1:"ルーター読込…", p2:"タグ付けとスコアリング…", p3:"候補を整流…", p4:"主要/補助手法を統合…",
    p5:"本文生成…", p6:"リスクとガードレール…", p7:"仕上げ…", p8:"完了"
  }
};

function applyI18n(lang){
  const dict = I18N[lang] || I18N["zh-Hans"];
  document.documentElement.lang = lang;

  // 文本
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    const k = el.getAttribute("data-i18n");
    if (dict[k] != null) el.textContent = dict[k];
  });

  // placeholder
  document.querySelectorAll("[data-i18n-ph]").forEach(el=>{
    const k = el.getAttribute("data-i18n-ph");
    if (dict[k] != null) el.setAttribute("placeholder", dict[k]);
  });

  // 下拉（行動小Bar quickNav）內的 option 也會跟著更新文字，因為它們同樣帶了 data-i18n
}

// 初始化與切換
(function(){
  const sel = document.getElementById("langSelect");
  const saved = localStorage.getItem("lang") || "zh-Hans";
  if (sel) sel.value = saved;
  applyI18n(saved);
  sel?.addEventListener("change", ()=>{
    const lang = sel.value;
    localStorage.setItem("lang", lang);
    applyI18n(lang);
  });
})();
