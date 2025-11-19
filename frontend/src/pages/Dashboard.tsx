import React, { useState } from 'react';
import { Button } from '../components/Button';
import { CharacterCard } from '../components/CharacterCard';
import { User, AskResponse, UserStatus } from '../types';
import { apiRequest } from '../services/api';
import { ERROR_MESSAGES, USER_STATUS_LABELS } from '../constants';

interface DashboardProps {
  user: User;
  onLogout: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ user, onLogout }) => {
  // Chat State
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<{q: string, a: string}[]>([]);

  // Derived State
  const isTrial = user.status === UserStatus.TRIAL;
  const isActive = user.status === UserStatus.ACTIVE || user.roles.includes('member');
  const userCharacter = user.character_code ? {
    code: user.character_code,
    name: user.character_name || '',
    line: user.character_line || ''
  } : null;

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    setAsking(true);
    setError('');
    setAnswer('');

    try {
      // Handoff 3.4: Non-stream POST /ask
      const res = await apiRequest<AskResponse>('/ask', 'POST', {
        question: question
      });

      if (res.ok && res.answer) {
        setAnswer(res.answer);
        setHistory(prev => [{q: question, a: res.answer!}, ...prev]);
        setQuestion('');
      } else if (res.trial_quota_exhausted) {
        setError(ERROR_MESSAGES['trial_quota_exhausted']);
      } else {
        setError(res.error || '魔鏡沈默不語，請稍後再試。');
      }
    } catch (err: any) {
      // Handle specific error codes from Handoff
      const msg = err.message;
      if (msg === 'preorder_cannot_ask') setError(ERROR_MESSAGES['preorder_cannot_ask']);
      else if (msg === 'trial_quota_exhausted') setError(ERROR_MESSAGES['trial_quota_exhausted']);
      else setError(msg || ERROR_MESSAGES['server_error']);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="min-h-screen bg-onion-900 flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-80 bg-onion-950 border-r border-onion-800 flex flex-col">
        <div className="p-6 border-b border-onion-800">
          <h1 className="text-2xl font-serif text-transparent bg-clip-text bg-gradient-to-r from-onion-400 to-magic-gold font-bold">
            OnionUnion
          </h1>
          <p className="text-xs text-onion-500 mt-1">THE FOOL'S MIRROR</p>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          <div className="mb-6">
            <div className="text-xs font-bold text-onion-600 uppercase tracking-wider mb-2">ID CARD</div>
            <div className="bg-onion-900 p-4 rounded-lg border border-onion-800">
              <div className="font-bold text-white text-lg">{user.handle}</div>
              <div className={`inline-block px-2 py-0.5 rounded text-xs mt-1 ${isTrial ? 'bg-magic-green/20 text-magic-green' : 'bg-onion-500/20 text-onion-400'}`}>
                {USER_STATUS_LABELS[user.status] || user.status}
              </div>
              
              {isTrial && (
                 <div className="mt-3 text-sm text-gray-400">
                   試用次數：
                   <span className="text-white font-mono ml-1">
                     {user.trial_ask_used ?? 0} / {user.trial_ask_limit ?? 3}
                   </span>
                 </div>
              )}
            </div>
          </div>

          {/* Character Card for Active Users */}
          {userCharacter && isActive && (
            <div className="mb-6">
               <div className="text-xs font-bold text-onion-600 uppercase tracking-wider mb-2">YOUR AVATAR</div>
               <CharacterCard character={userCharacter} />
            </div>
          )}

          {/* Navigation (Future) */}
          <nav className="space-y-2">
            <Button variant="secondary" className="w-full justify-start" disabled>
              📜 歷史紀錄 (Coming Soon)
            </Button>
            <Button variant="secondary" className="w-full justify-start" disabled>
              ⚔️ 自製武器 (Coming Soon)
            </Button>
          </nav>
        </div>

        <div className="p-4 border-t border-onion-800">
          <Button variant="outline" onClick={onLogout} className="w-full border-onion-700 text-onion-500">
            登出
          </Button>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
        {/* Chat History Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 pb-32 scroll-smooth">
          {history.length === 0 && !answer && (
            <div className="h-full flex flex-col items-center justify-center opacity-30">
              <div className="text-6xl mb-4">🔮</div>
              <p className="text-xl">請在下方輸入您的疑惑...</p>
            </div>
          )}

          {[...history].reverse().map((item, idx) => (
             <div key={idx} className="space-y-4">
               {/* User Question */}
               <div className="flex justify-end">
                 <div className="bg-onion-700 text-white px-4 py-3 rounded-2xl rounded-tr-sm max-w-2xl">
                   {item.q}
                 </div>
               </div>
               {/* Mirror Answer */}
               <div className="flex justify-start">
                 <div className="bg-onion-800 border border-onion-700 text-onion-100 px-6 py-5 rounded-2xl rounded-tl-sm max-w-3xl shadow-lg prose prose-invert prose-p:my-2 prose-headings:text-magic-gold">
                    <div className="whitespace-pre-wrap">{item.a}</div>
                 </div>
               </div>
               <div className="w-full h-px bg-onion-800/50 my-8"></div>
             </div>
          ))}
        </div>

        {/* Input Area (Sticky Bottom) */}
        <div className="bg-onion-900/90 backdrop-blur border-t border-onion-800 p-4 md:p-6 z-10 absolute bottom-0 w-full">
          <div className="max-w-4xl mx-auto">
            {error && (
              <div className="mb-3 px-4 py-2 bg-red-900/30 border border-red-500/50 rounded text-red-300 text-sm">
                ⚠️ {error}
              </div>
            )}
            
            {/* New Answer Display (Current Session) */}
            {answer && (
               <div className="mb-4 p-4 bg-onion-800 rounded-lg border border-magic-green/30 text-onion-100 max-h-60 overflow-y-auto">
                 <div className="text-xs text-magic-green mb-2 uppercase tracking-wide">Latest Revelation</div>
                 <div className="whitespace-pre-wrap">{answer}</div>
               </div>
            )}

            <form onSubmit={handleAsk} className="flex gap-3">
              <input
                className="flex-1 bg-onion-950 border border-onion-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-onion-500 text-white placeholder-onion-600"
                placeholder={
                   isTrial ? `試用提問 (剩餘 ${user.trial_ask_limit! - (user.trial_ask_used || 0)} 次)...` 
                   : "請輸入您的問題 (出生年月日/對象/背景)..."
                }
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                disabled={asking || (isTrial && (user.trial_ask_used || 0) >= (user.trial_ask_limit || 0))}
              />
              <Button 
                type="submit" 
                isLoading={asking}
                disabled={!question.trim() || (isTrial && (user.trial_ask_used || 0) >= (user.trial_ask_limit || 0))}
                className="px-6"
              >
                送出
              </Button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
};