import React, { useState, useEffect } from 'react';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { ChangePassword } from './pages/ChangePassword';
import { Dashboard } from './pages/Dashboard';
import { User } from './types';

// A simple hash-based router implementation since we can't use React Router in this specific environment context easily, 
// and keeping it single-file structure friendly.
type Page = 'login' | 'register' | 'change-password' | 'dashboard';

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>('login');
  const [user, setUser] = useState<User | null>(null);

  // Initial check (simulated) - In a real app, we would check /auth/me here
  useEffect(() => {
    const storedUser = localStorage.getItem('onion_user');
    if (storedUser) {
      try {
        const u = JSON.parse(storedUser);
        handleLoginSuccess(u, u.must_change_password);
      } catch (e) {
        localStorage.removeItem('onion_user');
      }
    }
  }, []);

  const handleLoginSuccess = (loggedInUser: User, needPasswordChange: boolean) => {
    setUser(loggedInUser);
    localStorage.setItem('onion_user', JSON.stringify(loggedInUser));

    if (needPasswordChange) {
      setCurrentPage('change-password');
    } else {
      setCurrentPage('dashboard');
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('onion_user');
    setCurrentPage('login');
    // In real app: await apiRequest('/auth/logout', 'POST');
  };

  const handleUserUpdate = (updatedUser: User) => {
    setUser(updatedUser);
    localStorage.setItem('onion_user', JSON.stringify(updatedUser));
    setCurrentPage('dashboard');
  };

  // Router Logic
  const renderPage = () => {
    switch (currentPage) {
      case 'login':
        return <Login 
          onLoginSuccess={handleLoginSuccess} 
          onGoToRegister={() => setCurrentPage('register')} 
        />;
      case 'register':
        return <Register 
          onBackToLogin={() => setCurrentPage('login')} 
        />;
      case 'change-password':
        if (!user) return <Login onLoginSuccess={handleLoginSuccess} onGoToRegister={() => setCurrentPage('register')} />;
        return <ChangePassword 
          user={user} 
          onComplete={handleUserUpdate} 
        />;
      case 'dashboard':
        if (!user) return <Login onLoginSuccess={handleLoginSuccess} onGoToRegister={() => setCurrentPage('register')} />;
        return <Dashboard 
          user={user} 
          onLogout={handleLogout} 
        />;
      default:
        return <Login onLoginSuccess={handleLoginSuccess} onGoToRegister={() => setCurrentPage('register')} />;
    }
  };

  return (
    <div className="antialiased font-sans text-onion-100">
      {renderPage()}
    </div>
  );
};

export default App;