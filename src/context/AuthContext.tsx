import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Counter, AuthState, UserRole } from '../types';

interface AuthContextType extends AuthState {
  counter: Counter | null;
  login: (email: string, password: string) => Promise<User>;
  signup: (email: string, password: string, name?: string, role?: UserRole) => Promise<User>;
  logout: () => Promise<void>;
  updateCounterStatus: (newStatus: Counter['status']) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [counter, setCounter] = useState<Counter | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('qc_token'));
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Helper to fetch current user session on load
  useEffect(() => {
    const initializeAuth = async () => {
      const storedToken = localStorage.getItem('qc_token');
      if (storedToken) {
        try {
          const res = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${storedToken}` },
          });
          if (res.ok) {
            const data = await res.json();
            setUser(data.user);
            setCounter(data.counter);
            setToken(storedToken);
          } else {
            // Token expired or invalid
            localStorage.removeItem('qc_token');
            setUser(null);
            setToken(null);
            setCounter(null);
          }
        } catch (err) {
          console.error('Initialization auth error:', err);
          localStorage.removeItem('qc_token');
          setUser(null);
          setToken(null);
          setCounter(null);
        }
      }
      setIsLoading(false);
    };

    initializeAuth();
  }, []);

  const login = async (email: string, password: string): Promise<User> => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        let errorMsg = 'Login failed';
        try {
          const errData = await res.json();
          errorMsg = errData.error || errData.message || errorMsg;
        } catch {
          const rawText = await res.text().catch(() => '');
          errorMsg = rawText || `Server error (${res.status})`;
        }
        throw new Error(errorMsg);
      }
      const data = await res.json();
      setUser(data.user);
      setToken(data.token);
      setCounter(data.counter);
      localStorage.setItem('qc_token', data.token);
      return data.user;
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (
    email: string,
    password: string,
    _name?: string,
    _role: UserRole = 'STUDENT'
  ): Promise<User> => {
    // Firebase is removed, so dynamic registration isn't supported.
    // Fall back to direct login since seeded users exist.
    return login(email, password);
  };

  const logout = async (): Promise<void> => {
    setIsLoading(true);
    try {
      localStorage.removeItem('qc_token');
      setUser(null);
      setToken(null);
      setCounter(null);
    } finally {
      setIsLoading(false);
    }
  };

  const updateCounterStatus = (newStatus: Counter['status']) => {
    if (counter) {
      setCounter({ ...counter, status: newStatus });
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        counter,
        token,
        isAuthenticated: !!user && !!token,
        isLoading,
        login,
        signup,
        logout,
        updateCounterStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
