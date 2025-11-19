import React from 'react';
import { Character } from '../types';

interface CharacterCardProps {
  character: Character;
  isNewReveal?: boolean;
}

export const CharacterCard: React.FC<CharacterCardProps> = ({ character, isNewReveal = false }) => {
  return (
    <div className={`relative overflow-hidden rounded-xl border-2 border-magic-gold/50 bg-gradient-to-b from-onion-800 to-onion-900 p-6 text-center shadow-[0_0_30px_rgba(251,191,36,0.2)] ${isNewReveal ? 'animate-bounce-in' : ''}`}>
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-magic-gold to-transparent opacity-75"></div>
      
      <div className="mb-4 inline-block rounded-full bg-onion-950 p-4 border border-onion-700">
        {/* Placeholder for Character Avatar */}
        <div className="w-24 h-24 rounded-full bg-onion-800 flex items-center justify-center text-4xl">
          🧅
        </div>
      </div>
      
      <h3 className="text-2xl font-serif text-magic-gold font-bold mb-1 tracking-wide">
        {character.name || 'Unknown'}
      </h3>
      
      <div className="inline-flex items-center px-3 py-1 rounded-full bg-onion-950 border border-onion-700 text-xs text-onion-400 mb-4">
        CODE: {character.code}
      </div>

      <div className="space-y-2">
        <p className="text-sm text-gray-300">
          <span className="text-onion-500 font-semibold">系譜：</span> {character.line}
        </p>
        {character.assigned_at && (
          <p className="text-xs text-gray-500">
             召喚於：{new Date(character.assigned_at).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  );
};