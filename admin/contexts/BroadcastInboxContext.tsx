import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { broadcastNotificationService, InboxBroadcastItem } from '../services/broadcastNotificationService';
import { getApiErrorMessage } from '../utils/apiError';
import { toast } from 'react-toastify';
import { useAuth } from './AuthContext';
import BroadcastMessageModal from '../components/Broadcast/BroadcastMessageModal';

type BroadcastInboxContextValue = {
  items: InboxBroadcastItem[];
  unreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  selected: InboxBroadcastItem | null;
  openMessage: (item: InboxBroadcastItem) => void;
  closeMessage: () => void;
  markSelectedAsRead: () => Promise<void>;
  marking: boolean;
};

const BroadcastInboxContext = createContext<BroadcastInboxContextValue | null>(null);

export function useBroadcastInbox(): BroadcastInboxContextValue {
  const ctx = useContext(BroadcastInboxContext);
  if (!ctx) {
    throw new Error('useBroadcastInbox must be used within BroadcastInboxProvider');
  }
  return ctx;
}

export const BroadcastInboxProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [items, setItems] = useState<InboxBroadcastItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<InboxBroadcastItem | null>(null);
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setItems([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await broadcastNotificationService.getInbox();
      setItems(data.items);
      setUnreadCount(data.unreadCount);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Failed to load messages'));
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  const openMessage = useCallback((item: InboxBroadcastItem) => {
    setSelected(item);
  }, []);

  const closeMessage = useCallback(() => setSelected(null), []);

  const markSelectedAsRead = useCallback(async () => {
    if (!selected || selected.read) return;
    setMarking(true);
    try {
      await broadcastNotificationService.markAsRead(selected._id);
      toast.success('Marked as read');
      setSelected((prev) =>
        prev ? { ...prev, read: true, readAt: new Date().toISOString() } : null,
      );
      await load();
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Could not update read status'));
    } finally {
      setMarking(false);
    }
  }, [selected, load]);

  const value = useMemo(
    () => ({
      items,
      unreadCount,
      loading,
      refresh: load,
      selected,
      openMessage,
      closeMessage,
      markSelectedAsRead,
      marking,
    }),
    [
      items,
      unreadCount,
      loading,
      load,
      selected,
      openMessage,
      closeMessage,
      markSelectedAsRead,
      marking,
    ],
  );

  return (
    <BroadcastInboxContext.Provider value={value}>
      {children}
      <BroadcastMessageModal
        item={selected}
        onClose={closeMessage}
        onMarkRead={markSelectedAsRead}
        marking={marking}
      />
    </BroadcastInboxContext.Provider>
  );
};
