const ICON = '/favicon.ico';
const TAG_PREFIX = 'receipt-';

function isSupported() {
  return 'Notification' in window;
}

export function useNotifications() {
  // Returns current permission state
  function getPermission() {
    if (!isSupported()) return 'unsupported';
    return Notification.permission;
  }

  // Ask for permission — safe to call multiple times (no-ops if already granted/denied)
  async function requestPermission() {
    if (!isSupported()) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return await Notification.requestPermission();
  }

  // Fire a notification for a single new order, only when not focused
  function notifyNewReceipt(order) {
    if (!isSupported() || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;

    const productName = order.products?.name || 'محصول';
    const amount = Number(order.total_price || 0).toLocaleString('fa-IR');

    const n = new Notification('رسید پرداخت جدید 🧾', {
      body: `${productName} — ${amount} تومان\nمشتری: ${order.user_id}`,
      icon: ICON,
      tag: TAG_PREFIX + order.id,   // prevents duplicate toasts for the same order
      renotify: false,
      requireInteraction: false,
    });

    n.onclick = () => {
      window.focus();
      n.close();
    };

    // Auto-close after 8 seconds
    setTimeout(() => n.close(), 8000);
  }

  // Fire a grouped notification when multiple orders arrived at once
  function notifyBatch(count) {
    if (!isSupported() || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;

    const n = new Notification(`${count} رسید جدید در انتظار بررسی 🧾`, {
      body: 'برای مشاهده و تأیید وارد داشبورد شوید.',
      icon: ICON,
      tag: 'receipts-batch',
      renotify: true,
    });

    n.onclick = () => {
      window.focus();
      n.close();
    };

    setTimeout(() => n.close(), 8000);
  }

  return { getPermission, requestPermission, notifyNewReceipt, notifyBatch };
}
