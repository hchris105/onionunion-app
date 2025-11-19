import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({ label, error, className = '', ...props }) => {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-onion-400 mb-1">
        {label}
      </label>
      <input
        className={`w-full px-3 py-2 bg-onion-900/50 border ${error ? 'border-red-500' : 'border-onion-700'} rounded-lg focus:outline-none focus:ring-2 focus:ring-onion-500 text-white placeholder-onion-700 transition-colors ${className}`}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
};