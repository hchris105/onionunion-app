import React, { useState } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { CharacterCard } from '../components/CharacterCard';
import { apiRequest } from '../services/api';
import { User, ChangePasswordResponse, Character } from '../types';

interface ChangePasswordProps {
  user: User;
  onComplete: (updatedUser: User) => void;
}

export const ChangePassword: React.FC<ChangePasswordProps> = ({ user, onComplete }) => {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // State for the "Reveal" moment
  const [revealCharacter, setRevealCharacter] = useState<Character | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Per Handoff.md 2.2: This changes password AND assigns character for preorders
      const res = await apiRequest<ChangePasswordResponse>('/auth/change-password', 'POST', {
        handle: user.handle,
        old_password: oldPassword,
        new_password: newPassword
      });

      if (res.ok) {
        if (res.rewarded && res.character) {
          // Preorder user got their character! Show animation.
          setRevealCharacter(res.character);
        } else {
          // Regular password change (or already had character)
          onComplete({ ...user, must_change_password: false });
        }
      } else {
        setError('密碼變更失敗，請確認舊密碼是否正確。');
      }
    } catch (err: any) {
      setError(err.message || '發生錯誤');
    } finally {
      setLoading(false);
    }
  };

  const handleEnterKingdom = () => {
    if (revealCharacter) {
      onComplete({ 
        ...user, 
        must_change_password: false, 
        status: 'active' as any, // Force update status locally
        character_code: revealCharacter.code,
        character_name: revealCharacter.name,
        character_line: revealCharacter.line
      });
    }
  };

  if (revealCharacter) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-onion-900 text-center">
        <h2 className="text-3xl font-serif text-magic-gold mb-6 animate-pulse">
          命運之輪已轉動...
        </h2>
        <div className="max-w-sm w-full mb-8 transform scale-110 transition-transform duration-700">
          <CharacterCard character={revealCharacter} isNewReveal={true} />
        </div>
        <p className="text-onion-100 mb-8 max-w-md">
          歡迎來到洋蔥王國，<span className="font-bold text-onion-400">{user.handle}</span>。<br/>
          這就是您在王國中的化身。
        </p>
        <Button onClick={handleEnterKingdom} className="px-8 py-3 text-lg">
          開始旅程
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-onion-900">
      <div className="w-full max-w-md bg-onion-800 border border-onion-700 p-8 rounded-2xl">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white mb-2">
            {user.status === 'preorder' ? '首登儀式' : '變更密碼'}
          </h2>
          <p className="text-onion-400 text-sm">
            {user.status === 'preorder' 
              ? '為了確保您的靈魂綁定安全，預約者必須在首次登入時修改密碼，並抽取您的專屬角色。' 
              : '為了您的帳號安全，請定期更換密碼。'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Input 
            label="舊密碼" 
            type="password"
            value={oldPassword} 
            onChange={(e) => setOldPassword(e.target.value)}
            required
          />
          <Input 
            label="新密碼" 
            type="password" 
            value={newPassword} 
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />

          {error && (
            <div className="text-red-400 text-sm text-center">{error}</div>
          )}

          <Button type="submit" className="w-full" isLoading={loading}>
            {user.status === 'preorder' ? '確認並抽取角色' : '確認變更'}
          </Button>
        </form>
      </div>
    </div>
  );
};