const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: true
  },
  lead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true
  },
  agency: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agency',
    required: true
  },
  agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['sale', 'rent'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD'
  },
  commission: {
    amount: {
      type: Number,
      min: 0
    },
    percentage: {
      type: Number,
      min: 0,
      max: 100
    }
  },
  status: {
    type: String,
    enum: [
      'pending_approval',
      'approved',
      'pending',
      'completed',
      'cancelled',
      'rejected',
      'refunded'
    ],
    default: 'pending_approval'
  },
  transactionDate: {
    type: Date,
    default: Date.now
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'check', 'bank_transfer', 'credit_card', 'other']
  },
  notes: String,
  documents: [{
    name: String,
    url: String,
    filename: String,
    mimeType: String,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    type: {
      type: String,
      enum: ['contract', 'receipt', 'invoice', 'proof', 'other'],
      default: 'proof'
    }
  }],
  approval: {
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewedAt: Date,
    adminNote: String
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  erpSync: [{
    erpSystem: {
      type: String,
      enum: ['sap', 'oracle', 'tally', 'quickbooks', 'xero', 'custom']
    },
    erpRecordId: String,
    syncedAt: Date,
    syncedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  customerConfirmed: {
    type: Boolean,
    default: false
  },
  paymentDetails: {
    amountPaid: { type: Number, default: 0 },
    dueAmount: Number,
    paymentDate: Date,
    paymentMethod: String,
    transactionReference: String
  }
}, {
  timestamps: true
});

transactionSchema.index({ property: 1 });
transactionSchema.index({ lead: 1 });
transactionSchema.index({ agency: 1 });
transactionSchema.index({ agent: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ transactionDate: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
