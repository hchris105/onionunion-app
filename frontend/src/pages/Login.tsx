import React, { useState } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { apiRequest } from '../services/api';
import { AuthResponse, User } from '../types';

interface LoginProps {
  onLoginSuccess: (user: User, needPasswordChange: boolean) => void;
  onGoToRegister: () => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess, onGoToRegister }) => {
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await apiRequest<AuthResponse>('/auth/login', 'POST', {
        handle,
        password
      });

      if (res.ok && res.user) {
        onLoginSuccess(res.user, !!res.need_password_change);
      } else {
        setError(res.msg || '登入失敗，請檢查帳號密碼');
      }
    } catch (err: any) {
      setError(err.message || '連線錯誤');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[url('https://picsum.photos/1920/1080?blur=8')] bg-cover bg-center">
      <div className="absolute inset-0 bg-onion-900/90 backdrop-blur-sm"></div>
      
      <div className="relative w-full max-w-md bg-onion-800 border border-onion-700 p-8 rounded-2xl shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-serif text-transparent bg-clip-text bg-gradient-to-r from-onion-400 to-magic-gold font-bold mb-2">
            OnionUnion
          </h1>
          <p className="text-onion-100 text-sm">傻瓜魔鏡 · 洋蔥王國入口</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Input 
            label="代號 / Handle / Email" 
            value={handle} 
            onChange={(e) => setHandle(e.target.value)}
            placeholder="輸入您的居民代號"
            required
          />
          <Input 
            label="密碼 / Password" 
            type="password" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)}
            placeholder="輸入密碼"
            required
          />

          {error && (
            <div className="p-3 bg-red-900/50 border border-red-500/50 rounded text-red-200 text-sm text-center">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" isLoading={loading}>
            進入王國
          </Button>
        </form>

        <div className="mt-6 text-center border-t border-onion-700 pt-4">
          <p className="text-onion-400 text-sm mb-2">還沒有身份？</p>
          <button 
            onClick={onGoToRegister}
            className="text-magic-green hover:text-green-400 text-sm font-medium transition-colors"
          >
            申請試用 (Trial) 帳號 &rarr;
          </button>
        </div>
      </div>
    </div>
  );
};