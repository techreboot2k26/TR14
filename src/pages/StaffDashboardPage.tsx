import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { StaffDashboardData, ToastMessage, CounterStatus } from '../types';
import { Header } from '../components/Header';
import { CounterStatusToggle } from '../components/CounterStatusToggle';
import { CurrentTokenCard } from '../components/CurrentTokenCard';
import { WaitingQueueList } from '../components/WaitingQueueList';
import { QueueStatsCards } from '../components/QueueStatsCards';
import { TokenDetailsModal } from '../components/TokenDetailsModal';
import { ToastNotification } from '../components/ToastNotification';
import { RefreshCw, AlertTriangle } from 'lucide-react';

export const StaffDashboardPage: React.FC = () => {
  const { counter, updateCounterStatus } = useAuth();
  const { socket } = useSocket();

  const [dashboardData, setDashboardData] = useState<StaffDashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);

  // Toasts State
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (type: 'success' | 'error' | 'info' | 'warning', title: string, message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Fetch Dashboard Data
  const fetchDashboard = useCallback(async () => {
    try {
      const storedToken = localStorage.getItem('qc_token');
      if (!storedToken) return;

      const res = await fetch('/api/staff/dashboard', {
        headers: {
          Authorization: `Bearer ${storedToken}`,
        },
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to fetch dashboard data');
      }

      const data: StaffDashboardData = await res.json();
      setDashboardData(data);
      if (data.counter?.status) {
        updateCounterStatus(data.counter.status);
      }
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [updateCounterStatus]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Listen to Socket.IO real-time events for instant updates
  useEffect(() => {
    if (!socket) return;

    const handleQueueUpdated = (payload: any) => {
      console.log('[Socket] QUEUE_UPDATED received:', payload);
      fetchDashboard();
    };

    const handleCounterStatus = (payload: any) => {
      if (payload.counterId === counter?.id) {
        updateCounterStatus(payload.status);
        fetchDashboard();
      }
    };

    socket.on('QUEUE_UPDATED', handleQueueUpdated);
    socket.on('COUNTER_STATUS_CHANGED', handleCounterStatus);

    return () => {
      socket.off('QUEUE_UPDATED', handleQueueUpdated);
      socket.off('COUNTER_STATUS_CHANGED', handleCounterStatus);
    };
  }, [socket, counter?.id, fetchDashboard, updateCounterStatus]);

  // Handle CALL NEXT Action
  const handleCallNext = async () => {
    if (actionLoading) return;
    setActionLoading(true);

    try {
      const storedToken = localStorage.getItem('qc_token');
      const res = await fetch('/api/staff/counter/next', {
        method: 'POST',
        headers: { Authorization: `Bearer ${storedToken}` },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to call next token');
      }

      addToast('success', 'Token Called!', data.message);
      if (data.dashboard) {
        setDashboardData(data.dashboard);
      } else {
        fetchDashboard();
      }
    } catch (err: any) {
      addToast('error', 'Call Next Failed', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle COMPLETE Action
  const handleComplete = async (tokenId: string) => {
    if (actionLoading) return;
    setActionLoading(true);

    try {
      const storedToken = localStorage.getItem('qc_token');
      const res = await fetch(`/api/staff/tokens/${tokenId}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${storedToken}` },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to complete token');
      }

      addToast('success', 'Token Completed', data.message);
      if (data.dashboard) {
        setDashboardData(data.dashboard);
      } else {
        fetchDashboard();
      }
    } catch (err: any) {
      addToast('error', 'Completion Failed', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle HOLD Action
  const handleHold = async (tokenId: string) => {
    if (actionLoading) return;
    setActionLoading(true);

    try {
      const storedToken = localStorage.getItem('qc_token');
      const res = await fetch(`/api/staff/tokens/${tokenId}/hold`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${storedToken}` },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to hold token');
      }

      addToast('warning', 'Token On Hold', data.message);
      if (data.dashboard) {
        setDashboardData(data.dashboard);
      } else {
        fetchDashboard();
      }
    } catch (err: any) {
      addToast('error', 'Hold Action Failed', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle RESUME Action
  const handleResume = async (tokenId: string) => {
    if (actionLoading) return;
    setActionLoading(true);

    try {
      const storedToken = localStorage.getItem('qc_token');
      const res = await fetch(`/api/staff/tokens/${tokenId}/resume`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${storedToken}` },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to resume token');
      }

      addToast('success', 'Token Resumed', data.message);
      if (data.dashboard) {
        setDashboardData(data.dashboard);
      } else {
        fetchDashboard();
      }
    } catch (err: any) {
      addToast('error', 'Resume Action Failed', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle SKIP Action
  const handleSkip = async (tokenId: string) => {
    if (actionLoading) return;
    setActionLoading(true);

    try {
      const storedToken = localStorage.getItem('qc_token');
      const res = await fetch(`/api/staff/tokens/${tokenId}/skip`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${storedToken}` },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to skip token');
      }

      addToast('info', 'Token Skipped', data.message);
      if (data.dashboard) {
        setDashboardData(data.dashboard);
      } else {
        fetchDashboard();
      }
    } catch (err: any) {
      addToast('error', 'Skip Action Failed', err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Counter Status Change
  const handleStatusChange = async (newStatus: CounterStatus) => {
    try {
      const storedToken = localStorage.getItem('qc_token');
      const res = await fetch('/api/staff/counter/status', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${storedToken}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to update counter status');
      }

      updateCounterStatus(newStatus);
      addToast('info', 'Counter Status Updated', data.message);
      if (data.dashboard) {
        setDashboardData(data.dashboard);
      } else {
        fetchDashboard();
      }
    } catch (err: any) {
      addToast('error', 'Status Update Failed', err.message);
    }
  };

  if (loading && !dashboardData) {
    return (
      <div className="app-container">
        <Header />
        <div className="main-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
            <RefreshCw size={32} className="spin" style={{ marginBottom: '1rem', color: 'var(--accent-primary)' }} />
            <p>Loading Staff Dashboard & Queue Engine State...</p>
          </div>
        </div>
      </div>
    );
  }

  const currentCounter = dashboardData?.counter || counter;
  const currentToken = dashboardData?.current_token || null;
  const waitingQueue = dashboardData?.waiting_queue || [];
  const stats = dashboardData?.stats || {
    queue_length: 0,
    currently_serving_number: null,
    waiting_count: 0,
    held_count: 0,
    completed_today_count: 0,
    avg_service_time_minutes: 0,
  };

  const heldTokens = dashboardData?.held_tokens || [];

  return (
    <div className="app-container">
      {/* Top Header */}
      <Header />

      <main className="main-content">
        {/* Top Control Bar: Counter Lifecycle & Refresh */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}>
          {currentCounter && (
            <CounterStatusToggle
              currentStatus={currentCounter.status}
              onStatusChange={handleStatusChange}
              disabled={actionLoading}
            />
          )}

          <button
            onClick={fetchDashboard}
            disabled={actionLoading}
            className="btn btn-secondary"
            style={{ padding: '0.5rem 0.875rem' }}
            title="Refresh Queue State"
          >
            <RefreshCw size={16} />
            <span>Refresh</span>
          </button>
        </div>

        {error && (
          <div style={{
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#fca5a5',
            padding: '1rem',
            borderRadius: 'var(--radius-md)',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}>
            <AlertTriangle size={20} />
            <div>
              <strong>Error Loading Queue Data:</strong> {error}
            </div>
          </div>
        )}

        {/* Operational Statistics Widget Row */}
        <div style={{ marginBottom: '1.5rem' }}>
          <QueueStatsCards
            stats={stats}
            heldTokens={heldTokens}
            onResumeToken={handleResume}
            hasActiveServing={!!currentToken}
            isCounterOpen={currentCounter?.status === 'OPEN'}
            isLoading={actionLoading}
          />
        </div>

        {/* Core Queue Dashboard Grid */}
        <div className="dashboard-grid">
          {/* Column 1: Currently Serving Token Card */}
          <div>
            <CurrentTokenCard
              token={currentToken}
              counterStatus={currentCounter?.status || 'CLOSED'}
              onComplete={handleComplete}
              onHold={handleHold}
              onSkip={handleSkip}
              onViewDetails={(id) => setSelectedTokenId(id)}
              isLoading={actionLoading}
            />
          </div>

          {/* Column 2: Waiting Queue List */}
          <div>
            <WaitingQueueList
              queue={waitingQueue}
              currentServingToken={currentToken}
              counterStatus={currentCounter?.status || 'CLOSED'}
              onCallNext={handleCallNext}
              onResume={handleResume}
              onViewDetails={(id) => setSelectedTokenId(id)}
              isLoading={actionLoading}
            />
          </div>
        </div>
      </main>

      {/* Modal for Token Details */}
      {selectedTokenId && (
        <TokenDetailsModal
          tokenId={selectedTokenId}
          onClose={() => setSelectedTokenId(null)}
        />
      )}

      {/* Toasts Feedback Container */}
      <ToastNotification toasts={toasts} onDismiss={removeToast} />
    </div>
  );
};
