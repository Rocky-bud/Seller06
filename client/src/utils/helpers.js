export function formatToman(amount) {
  return Number(amount || 0).toLocaleString('fa-IR') + ' تومان';
}

export function formatDate(dateStr) {
  if (!dateStr) return '---';
  const d = new Date(dateStr);
  return d.toLocaleDateString('fa-IR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export const statusLabels = {
  pending_receipt: 'در انتظار رسید',
  awaiting_approval: 'در انتظار تأیید',
  approved: 'تأیید شده',
  rejected: 'رد شده'
};

export const statusColors = {
  pending_receipt: 'bg-warning-50 text-warning-600 border-warning-500',
  awaiting_approval: 'bg-primary-50 text-primary-700 border-primary-500',
  approved: 'bg-success-50 text-success-600 border-success-500',
  rejected: 'bg-danger-50 text-danger-600 border-danger-500'
};

// Phase 5 Step 1 -- shipment lifecycle labels + colors (packed -> shipped -> delivered)
export const shipmentLabels = {
  packed: 'در حال بسته‌بندی',
  shipped: 'ارسال شده',
  delivered: 'تحویل داده شد'
};

export const shipmentColors = {
  packed: 'bg-warning-50 text-warning-600 border-warning-500',
  shipped: 'bg-primary-50 text-primary-700 border-primary-500',
  delivered: 'bg-success-50 text-success-600 border-success-500'
};
