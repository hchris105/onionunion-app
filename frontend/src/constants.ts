// Points to your local backend running on port 3000
// In production, this would be an environment variable
export const API_BASE_URL = 'http://localhost:3000';

export const ERROR_MESSAGES: Record<string, string> = {
  'unauthorized': '尚未登入或憑證過期，請重新登入。',
  'preorder_cannot_ask': '預約帳號需先完成「首登儀式」並領取角色後才能提問。',
  'trial_quota_exhausted': '您的試用次數已耗盡，請升級為正式會員。',
  'account_inactive': '帳號目前處於非啟用狀態。',
  'missing_field': '請填寫所有必要欄位。',
  'quota_exceeded': '請求過於頻繁，請稍後再試。',
  'server_error': '洋蔥王國的線路繁忙，請稍後再試。',
};

export const USER_STATUS_LABELS: Record<string, string> = {
  'preorder': '預約者 (Preorder)',
  'trial': '體驗者 (Trial)',
  'active': '洋蔥居民 (Active)',
};