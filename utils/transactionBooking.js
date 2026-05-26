const BOOKING_ACTIVE_STATUSES = ['pending_approval', 'approved', 'pending'];
const BOOKING_REQUEST_STATUSES = ['pending_approval', 'pending'];

function getAmountPaid(transaction) {
  const pd = transaction.paymentDetails || {};
  return Number(pd.amountPaid ?? 0);
}

function getTotalAmount(transaction) {
  return Number(transaction.amount ?? 0);
}

function getPendingAmount(transaction) {
  const total = getTotalAmount(transaction);
  const paid = getAmountPaid(transaction);
  return Math.max(0, total - paid);
}

/** Attach totalAmount, amountPaid, pendingAmount for API responses */
function enrichTransactionPaymentSummary(transaction) {
  const obj = transaction.toObject ? transaction.toObject() : { ...transaction };
  const totalAmount = getTotalAmount(obj);
  const amountPaid = getAmountPaid(obj);
  const pendingAmount = Math.max(0, totalAmount - amountPaid);

  if (!obj.paymentDetails) obj.paymentDetails = {};
  obj.paymentDetails.amountPaid = amountPaid;
  obj.paymentDetails.dueAmount = pendingAmount;

  return {
    ...obj,
    totalAmount,
    amountPaid,
    pendingAmount
  };
}

function isBookingAwaitingApproval(status) {
  return BOOKING_REQUEST_STATUSES.includes(status);
}

function canCustomerUploadProof(transaction) {
  if (!transaction) return false;
  if (isBookingAwaitingApproval(transaction.status)) return true;
  if (transaction.status === 'approved' && getPendingAmount(transaction) > 0) return true;
  return false;
}

module.exports = {
  BOOKING_ACTIVE_STATUSES,
  BOOKING_REQUEST_STATUSES,
  getAmountPaid,
  getTotalAmount,
  getPendingAmount,
  enrichTransactionPaymentSummary,
  isBookingAwaitingApproval,
  canCustomerUploadProof
};
