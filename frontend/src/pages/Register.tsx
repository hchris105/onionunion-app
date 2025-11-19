import React, { useState } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { apiRequest } from '../services/api';
import { AuthResponse } from '../types';

interface RegisterProps {
  onBackToLogin: () => void;
}

export const Register: React.FC<RegisterProps> = ({ onBackToLogin }) => {
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Implementing the new P0 requirement from Handoff.md
      const res = await apiRequest<AuthResponse>('/auth/trial-register', 'POST', {
        handle,
        email,
        password
      });

      if (res.ok) {
        setSuccess(true);
      } else {
        setError(res.msg || '註冊失敗');
      }
    } catch (err: any) {
      setError(err.message || '連線錯誤，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-onion-900">
        <div className="w-full max-w-md bg-onion-800 p-8 rounded-2xl border border-magic-green/30 text-center">
          <div className="text-6xl mb-4">✨</div>
          <h2 className="text-2xl font-bold text-white mb-2">註冊成功！</h2>
          <p className="text-onion-100 mb-6">
            歡迎來到洋蔥王國試煉場。<br/>
            您現在擁有 3 次免費提問機會。
          </p>
          <Button onClick={onBackToLogin} className="w-full">
            前往登入
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-onion-900">
      <div className="w-full max-w-md bg-onion-800 border border-onion-700 p-8 rounded-2xl">
        <div className="mb-6">
          <button onClick={onBackToLogin} className="text-onion-400 hover:text-white text-sm mb-4">
            &larr; 返回登入
          </button>
          <h2 className="text-2xl font-bold text-white">申請試用身份</h2>
          <p className="text-onion-400 text-sm">獲得 3 次免費「傻瓜魔鏡」測算機會</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Input 
            label="設定代號 (Handle)" 
            value={handle} 
            onChange={(e) => setHandle(e.target.value)}
            placeholder="英數組合，例如: magicUser01"
            required
          />
          <Input 
            label="Email (選填)" 
            type="email"
            value={email} 
            onChange={(e) => setEmail(e.target.value)}
            placeholder="用於找回密碼"
          />
          <Input 
            label="設定密碼" 
            type="password" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)}
            placeholder="請設定高強度密碼"
            required
          />

          {error && (
            <div className="text-red-400 text-sm text-center">{error}</div>
          )}

          <Button type="submit" className="w-full" variant="secondary" isLoading={loading}>
            提交申請
          </Button>
        </form>
      </div>
    </div>
  );
};