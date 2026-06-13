import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useShop } from './ShopContext';
import { fetchOrders } from '../hooks/useApi';
import { useNotifications } from '../hooks/useNotifications';

// STAGE 34 -- global in-app notification center. Polls orders for the active
// shop on ANY page, detects newly arrived receipts (awaiting_approval), keeps a
// live notification list + unread/pending counts, and emits toast popups.
const NotificationContext = createContext(null);

const POLL_INTERVAL = 15000;
const MAX_ITEMS = 30;
const TOAST_TTL = 6000;

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function awaitingSet(list) {
  return new Set(list.filter((o) => o.status === 'awaiting_approval').map((o) => o.id));
}

export function NotificationProvider({ children }) {
  const { shopId } = useShop();

  // useNotifications returns fresh functions each render; keep them in a ref so
  // the polling effect does not reset on every render.
  const notify = useNotifications();
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);

  const baselineReady = useRef(false);
  const knownAwaiting = useRef(new Set());

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((toast) => {
    const id = makeId();
    setToasts((prev) => [...prev, { id, ...toast }]);
    setTimeout(() => removeToast(id), TOAST_TTL);
  }, [removeToast]);

  const addReceiptNotification = useCallback((order) => {
    const productName = order.products?.name || 'محصول';
    const amount = Number(order.total_price || 0).toLocaleString('fa-IR');
    const item = {
      id: makeId(),
      orderId: order.id,
      title: 'رسید پرداخت جدید',
      body: `${productName} — ${amount} تومان`,
      userId: order.user_id,
      platform: order.platform || 'telegram',
      createdAt: new Date().toISOString(),
      read: false,
    };
    setNotifications((prev) => [item, ...prev].slice(0, MAX_ITEMS));
    pushToast({ title: item.title, body: item.body, platform: item.platform });
  }, [pushToast]);

  const poll = useCallback(async () => {
    if (!shopId) return;
    try {
      const data = await fetchOrders(shopId);
      const fresh = data || [];
      const pending = fresh.filter((o) => o.status === 'awaiting_approval');
      setPendingCount(pending.length);

      // First successful fetch only baselines -- never notifies for existing rows.
      if (!baselineReady.current) {
        knownAwaiting.current = awaitingSet(fresh);
        baselineReady.current = true;
        return;
      }

      const arrived = pending.filter((o) => !knownAwaiting.current.has(o.id));
      if (arrived.length === 1) {
        addReceiptNotification(arrived[0]);
        notifyRef.current.notifyNewReceipt(arrived[0]);
      } else if (arrived.length > 1) {
        arrived.forEach(addReceiptNotification);
        notifyRef.current.notifyBatch(arrived.length);
      }
      knownAwaiting.current = awaitingSet(fresh);
    } catch (err) {
      console.error('[notifications] poll error:', err.message);
    }
  }, [shopId, addReceiptNotification]);

  // Ask once for native notification permission (in-app toasts work regardless).
  useEffect(() => {
    notifyRef.current.requestPermission().catch(() => {});
  }, []);

  // Reset baseline when the shop changes, then poll on an interval.
  useEffect(() => {
    baselineReady.current = false;
    knownAwaiting.current = new Set();
    poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [poll]);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);
  const markRead = useCallback((id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);
  const clearAll = useCallback(() => setNotifications([]), []);
  const dismissNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const unreadCount = notifications.reduce((acc, n) => acc + (n.read ? 0 : 1), 0);

  const value = {
    notifications,
    unreadCount,
    pendingCount,
    toasts,
    pushToast,
    removeToast,
    markAllRead,
    markRead,
    clearAll,
    dismissNotification,
  };

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotificationCenter() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotificationCenter must be used within NotificationProvider');
  return ctx;
}
