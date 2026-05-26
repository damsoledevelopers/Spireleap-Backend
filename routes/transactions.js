const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { auth, authorize, checkModulePermission } = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const Property = require('../models/Property');
const Lead = require('../models/Lead');
const Payment = require('../models/Payment');
const Agency = require('../models/Agency');
const User = require('../models/User');
const notificationService = require('../services/notificationService');
const emailService = require('../services/emailService');
const paymentService = require('../services/paymentService');
const encryptionService = require('../services/encryptionService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  enrichTransactionPaymentSummary,
  getAmountPaid,
  getPendingAmount,
  isBookingAwaitingApproval,
  canCustomerUploadProof,
} = require('../utils/transactionBooking');
const { findLeadsByCustomerEmail } = require('../utils/leadCustomerQuery');
const { getFileUrl } = require('../middleware/upload');

const TRANSACTION_STATUSES = [
  'pending_approval',
  'approved',
  'pending',
  'completed',
  'cancelled',
  'rejected',
  'refunded'
];

async function getCustomerLeadIds(userEmail) {
  const leads = await findLeadsByCustomerEmail(userEmail, []);
  return leads.map((l) => l._id);
}

async function assertCustomerOwnsTransaction(transactionId, userEmail) {
  const leadIds = await getCustomerLeadIds(userEmail);
  if (!leadIds.length) return null;
  const transaction = await Transaction.findOne({
    _id: transactionId,
    lead: { $in: leadIds }
  });
  return transaction;
}

const bookingProofStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = 'uploads/transactions/proofs';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

const bookingProofFilter = (req, file, cb) => {
  const allowed = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf'
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF or image files (JPG, PNG, WEBP) are allowed'), false);
  }
};

const uploadBookingProof = multer({
  storage: bookingProofStorage,
  fileFilter: bookingProofFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
}).single('proof');

// @route   GET /api/transactions/analytics/revenue
// @desc    Get revenue analytics
// @access  Private
router.get('/analytics/revenue', auth, checkModulePermission('leads', 'view'), async (req, res) => {
  try {
    const { startDate, endDate, agency, minAmount, maxAmount } = req.query;
    const query = { status: 'completed' };

    if (agency) {
      query.agency = agency;
    } else if (req.user.role === 'agency_admin') {
      query.agency = req.user.agency;
    }

    if (startDate || endDate) {
      query.transactionDate = {};
      if (startDate) query.transactionDate.$gte = new Date(startDate);
      if (endDate) query.transactionDate.$lte = new Date(endDate);
    }

    if (minAmount || maxAmount) {
      query.amount = {};
      if (minAmount) query.amount.$gte = Number(minAmount);
      if (maxAmount) query.amount.$lte = Number(maxAmount);
    }

    const transactions = await Transaction.find(query)
      .populate('property', 'title')
      .populate('agent', 'firstName lastName')
      .populate('lead', 'contact');

    // Calculate totals
    const totalRevenue = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalCommission = transactions.reduce((sum, t) => sum + (t.commission?.amount || 0), 0);
    const totalTransactions = transactions.length;

    // Revenue by type
    const revenueByType = {
      sale: transactions.filter(t => t.type === 'sale').reduce((sum, t) => sum + (t.amount || 0), 0),
      rent: transactions.filter(t => t.type === 'rent').reduce((sum, t) => sum + (t.amount || 0), 0)
    };

    // Revenue by month (last 12 months)
    const monthlyRevenue = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const monthTransactions = transactions.filter(t => {
        const tDate = new Date(t.transactionDate);
        return tDate >= monthStart && tDate <= monthEnd;
      });
      monthlyRevenue.push({
        month: monthStart.toLocaleString('default', { month: 'short', year: 'numeric' }),
        revenue: monthTransactions.reduce((sum, t) => sum + (t.amount || 0), 0),
        count: monthTransactions.length
      });
    }

    // Top performing agents
    const agentRevenue = {};
    transactions.forEach(t => {
      if (t.agent) {
        const agentId = t.agent._id.toString();
        if (!agentRevenue[agentId]) {
          agentRevenue[agentId] = {
            agent: t.agent,
            revenue: 0,
            commission: 0,
            count: 0
          };
        }
        agentRevenue[agentId].revenue += t.amount || 0;
        agentRevenue[agentId].commission += t.commission?.amount || 0;
        agentRevenue[agentId].count += 1;
      }
    });

    const topAgents = Object.values(agentRevenue)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    res.json({
      summary: {
        totalRevenue,
        totalCommission,
        totalTransactions,
        revenueByType,
        averageTransactionValue: totalTransactions > 0 ? totalRevenue / totalTransactions : 0
      },
      monthlyRevenue,
      topAgents
    });
  } catch (error) {
    console.error('Revenue analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/transactions
// @desc    Get all transactions
// @access  Private
router.get('/', auth, checkModulePermission('leads', 'view'), async (req, res) => {
  try {
    const { status, type, startDate, endDate, agency, agent, minAmount, maxAmount, search } = req.query;
    const query = {};

    if (status) query.status = status;
    if (type) query.type = type;
    if (agency) query.agency = agency;
    if (agent) query.agent = agent;

    if (startDate || endDate) {
      query.transactionDate = {};
      if (startDate) query.transactionDate.$gte = new Date(startDate);
      if (endDate) query.transactionDate.$lte = new Date(endDate);
    }

    // Budget range filter
    if (minAmount || maxAmount) {
      query.amount = {};
      if (minAmount) query.amount.$gte = Number(minAmount);
      if (maxAmount) query.amount.$lte = Number(maxAmount);
    }

    // Role-based filtering
    if (req.user.role === 'agency_admin') {
      query.agency = req.user.agency;
    } else if (req.user.role === 'agent') {
      query.agent = req.user.id;
    }

    // Search filter (handles property title, lead name, agent name)
    // For complex search across populated fields, we might need a separate find or aggregation
    // But for now, we'll populate and filter or use aggregation if needed.
    // Given the current structure, we'll stick to basic query and populate.

    // If search is provided, we might need to find matching properties/leads/agents first
    if (search) {
      const searchRegex = new RegExp(search, 'i');

      // Find matching properties
      const properties = await Property.find({ title: searchRegex }).select('_id');
      const propertyIds = properties.map(p => p._id);

      // Find matching users (agents)
      const users = await User.find({
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex }
        ]
      }).select('_id');
      const userIds = users.map(u => u._id);

      // Find matching leads
      const leads = await Lead.find({
        $or: [
          { 'contact.firstName': searchRegex },
          { 'contact.lastName': searchRegex },
          { 'contact.email': searchRegex }
        ]
      }).select('_id');
      const leadIds = leads.map(l => l._id);

      query.$or = [
        { property: { $in: propertyIds } },
        { agent: { $in: userIds } },
        { lead: { $in: leadIds } }
      ];
    }

    const transactions = await Transaction.find(query)
      .populate('property', 'title slug')
      .populate('lead', 'contact leadId status')
      .populate('agency', 'name')
      .populate('agent', 'firstName lastName email phone')
      .sort({ transactionDate: -1 })
      .limit(500); // Increased limit for admin view

    res.json(transactions);
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/transactions/my-transactions
// @desc    Get transactions for current customer
// @access  Private
router.get('/my-transactions', auth, async (req, res) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) {
      console.log('my-transactions: No user email found');
      return res.json([]);
    }

    // Use mongoose.model to ensure models are correctly registered
    const LeadModel = mongoose.model('Lead');
    const TransactionModel = mongoose.model('Transaction');

    // Find leads for this customer by email
    // We use a simple find().select() instead of distinct() to be safer
    const customerLeadIds = await getCustomerLeadIds(userEmail);

    if (!customerLeadIds || customerLeadIds.length === 0) {
      return res.json([]);
    }

    const transactions = await TransactionModel.find({
      lead: { $in: customerLeadIds }
    })
      .populate({
        path: 'property',
        select: 'title location price images slug'
      })
      .populate({
        path: 'agency',
        select: 'name logo contact'
      })
      .populate({
        path: 'agent',
        select: 'firstName lastName email'
      })
      .sort({ transactionDate: -1 });

    // Fetch payments for these transactions
    const Payment = mongoose.model('Payment');
    const transactionIds = transactions.map(t => t._id);
    const payments = await Payment.find({ transaction: { $in: transactionIds } });

    // Combine transactions with their payment info
    const transactionsWithPayments = transactions.map(t => {
      const payment = payments.find(p => p.transaction.toString() === t._id.toString());
      return enrichTransactionPaymentSummary({
        ...t.toObject(),
        payment
      });
    });

    res.json(transactionsWithPayments);
  } catch (error) {
    console.error('Get my transactions error:', error);
    res.status(500).json({
      message: 'Server error',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});
// @route   GET /api/transactions/my-transactions/:id
// @desc    Get transaction details for current customer
// @access  Private
router.get('/my-transactions/:id', auth, async (req, res) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) {
      return res.status(401).json({ message: 'User email not found' });
    }

    const transaction = await Transaction.findById(req.params.id)
      .populate('property')
      .populate('agency')
      .populate('agent', 'firstName lastName email phone')
      .populate('lead');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // Check if this transaction belongs to the user (via lead email)
    if (transaction.lead?.contact?.email !== userEmail) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Find associated payment
    let payment = await Payment.findOne({ transaction: transaction._id });

    // Auto-repair: If transaction is completed but payment record is missing
    if (transaction.status === 'completed' && !payment) {
      try {
        // Payment requires agency: resolve from transaction or lead
        const agencyId = transaction.agency?._id ?? transaction.agency ?? transaction.lead?.agency?._id ?? transaction.lead?.agency;
        if (!agencyId) {
          console.warn(`Auto-repair skipped for transaction ${transaction._id}: no agency on transaction or lead`);
        } else {
          console.log(`Auto-repairing missing payment for transaction ${transaction._id}`);
          payment = new Payment({
            transaction: transaction._id,
            lead: transaction.lead?._id,
            property: transaction.property?._id,
            agency: agencyId,
            amount: transaction.amount || 0,
            currency: 'AED',
            paymentMethod: 'other',
            gateway: 'none',
            gatewayPaymentId: 'restored_' + Date.now(),
            status: 'completed',
            receipt: {
              number: 'RCP-' + Date.now(),
              url: '#'
            },
            description: 'Automatically restored payment record',
            paymentDate: transaction.transactionDate || transaction.updatedAt || new Date(),
            createdBy: req.user.id // The user triggering the repair (customer)
          });
          await payment.save();
        }
      } catch (repairError) {
        console.error('Failed to auto-repair payment:', repairError);
        // Continue without payment, will likely fail on frontend but we tried
      }
    }

    res.json({
      transaction,
      payment
    });
  } catch (error) {
    console.error('Get my transaction detail error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/transactions/:id
// @desc    Get transaction by ID
// @access  Private
router.get('/:id', auth, checkModulePermission('leads', 'view'), async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('property')
      .populate('lead')
      .populate('agency')
      .populate('agent')
      .populate('createdBy');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // Check permissions
    if (req.user.role === 'agency_admin' && transaction.agency.toString() !== req.user.agency) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(transaction);
  } catch (error) {
    console.error('Get transaction error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/transactions
// @desc    Create new transaction
// @access  Private (Super Admin, Agency Admin)
router.post('/', [
  auth,
  checkModulePermission('leads', 'edit'),
  body('property').isMongoId().withMessage('Valid property ID is required'),
  body('lead').isMongoId().withMessage('Valid lead ID is required'),
  body('type').isIn(['sale', 'rent']).withMessage('Type must be sale or rent'),
  body('amount').isNumeric().withMessage('Amount is required'),
  body('agent').isMongoId().withMessage('Valid agent ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const property = await Property.findById(req.body.property);
    if (!property) {
      return res.status(404).json({ message: 'Property not found' });
    }

    const lead = await Lead.findById(req.body.lead);
    if (!lead) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    // Check permissions
    if (req.user.role === 'agency_admin' && property.agency.toString() !== req.user.agency) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const transactionData = {
      ...req.body,
      agency: property.agency,
      createdBy: req.user.id
    };

    // Calculate commission if percentage provided
    if (req.body.commission?.percentage) {
      transactionData.commission = {
        percentage: req.body.commission.percentage,
        amount: (req.body.amount * req.body.commission.percentage) / 100
      };
    }

    const transaction = new Transaction(transactionData);
    await transaction.save();

    // Update lead status and booking details (Always happen on booking creation)
    lead.status = 'booked';
    lead.property = req.body.property;

    // Initialize booking object if it doesn't exist
    if (!lead.booking) {
      lead.booking = {};
    }

    // Update booking details from transaction
    lead.booking.bookingAmount = req.body.amount;
    lead.booking.bookingDate = req.body.transactionDate || new Date();
    lead.booking.paymentMode = req.body.paymentMethod || 'other';

    // Handle unit number from erpSync if provided
    if (req.body.erpSync && req.body.erpSync.unitNumber) {
      lead.booking.unitNumber = req.body.erpSync.unitNumber;
    }

    if (req.body.status === 'completed') {
      lead.convertedAt = new Date();
    }

    await lead.save();

    // Update property status
    if (req.body.status === 'completed') {
      if (req.body.type === 'sale') {
        property.status = 'sold';
      } else if (req.body.type === 'rent') {
        property.status = 'rented';
      }
    } else {
      // Pending transaction = Property is Booked/Reserved
      property.status = 'booked';
    }
    await property.save();

    const populatedTransaction = await Transaction.findById(transaction._id)
      .populate('property')
      .populate('lead')
      .populate('agency')
      .populate('agent');

    res.status(201).json(populatedTransaction);
  } catch (error) {
    console.error('Create transaction error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/transactions/my-transactions/:id/booking-proof
// @desc    Customer uploads booking proof (PDF or image)
// @access  Private (Customer)
router.post('/my-transactions/:id/booking-proof', auth, (req, res) => {
  uploadBookingProof(req, res, async (err) => {
    try {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ message: err.message });
      }
      if (err) {
        return res.status(400).json({ message: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ message: 'Please upload a PDF or image file' });
      }

      const userEmail = req.user?.email;
      const transaction = await assertCustomerOwnsTransaction(req.params.id, userEmail);
      if (!transaction) {
        return res.status(404).json({ message: 'Booking not found' });
      }

      if (!canCustomerUploadProof(transaction)) {
        return res.status(400).json({
          message:
            transaction.status === 'approved'
              ? 'No balance due on this booking, or it is not awaiting payment proof.'
              : `Cannot upload proof when booking status is "${transaction.status}"`
        });
      }

      const wasApproved = transaction.status === 'approved';
      const fileUrl = getFileUrl(req, req.file.path);
      const proofDoc = {
        name: req.file.originalname,
        url: fileUrl,
        filename: req.file.filename,
        mimeType: req.file.mimetype,
        type: 'proof',
        uploadedBy: req.user.id,
        uploadedAt: new Date()
      };

      transaction.documents = [...(transaction.documents || []), proofDoc];
      transaction.customerConfirmed = true;
      if (wasApproved) {
        transaction.status = 'pending_approval';
        transaction.notes = [transaction.notes, 'Customer submitted payment proof for review.']
          .filter(Boolean)
          .join('\n');
      }
      await transaction.save();

      const populated = await Transaction.findById(transaction._id)
        .populate('property', 'title slug images')
        .populate('agency', 'name logo')
        .populate('agent', 'firstName lastName email');

      res.json({
        message: wasApproved
          ? 'Payment proof uploaded. Admin will verify and update your balance.'
          : 'Proof uploaded. Admin will review your booking request.',
        transaction: enrichTransactionPaymentSummary(populated)
      });
    } catch (error) {
      console.error('Upload booking proof error:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });
});

// @route   POST /api/transactions/:id/approve
// @desc    Admin approves a booking request
// @access  Private
router.post('/:id/approve', [
  auth,
  checkModulePermission('leads', 'edit'),
  body('adminNote').optional().trim(),
  body('amountPaid')
    .optional({ values: 'null' })
    .custom((val) => {
      if (val === null || val === undefined || val === '') return true;
      const n = Number(val);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error('Payment amount must be a valid number (0 or greater).');
      }
      return true;
    })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const messages = errors.array().map((e) => e.msg || 'Invalid input');
      return res.status(400).json({
        message: messages.join(' '),
        errors: errors.array()
      });
    }

    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    if (req.user.role === 'agency_admin' && transaction.agency.toString() !== req.user.agency) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (!isBookingAwaitingApproval(transaction.status)) {
      return res.status(400).json({
        message: `Only pending booking requests can be approved (current: ${transaction.status})`
      });
    }

    const hasProof = (transaction.documents || []).some((d) => d.url);
    if (!hasProof) {
      return res.status(400).json({
        message: 'Customer must upload a proof document (PDF or image) before approval'
      });
    }

    const total = Number(transaction.amount || 0);
    const existingPaid = getAmountPaid(transaction);
    const paymentInput =
      req.body.amountPaid !== undefined && req.body.amountPaid !== null && req.body.amountPaid !== ''
        ? Number(req.body.amountPaid)
        : null;

    let paid = existingPaid;
    if (paymentInput !== null && !Number.isNaN(paymentInput)) {
      if (existingPaid > 0) {
        paid = Math.min(total, existingPaid + paymentInput);
      } else {
        paid = Math.min(total, paymentInput);
      }
    }

    const pending = Math.max(0, total - paid);

    transaction.approval = {
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
      adminNote: req.body.adminNote || transaction.approval?.adminNote || ''
    };
    transaction.paymentDetails = {
      ...(transaction.paymentDetails || {}),
      amountPaid: paid,
      dueAmount: pending,
      paymentDate: paymentInput !== null && paymentInput > 0 ? new Date() : transaction.paymentDetails?.paymentDate
    };

    if (pending <= 0) {
      transaction.status = 'completed';
      const property = await Property.findById(transaction.property);
      if (property) {
        property.status = transaction.type === 'rent' ? 'rented' : 'sold';
        await property.save();
      }
      const lead = await Lead.findById(transaction.lead);
      if (lead) {
        lead.status = 'booked';
        lead.convertedAt = new Date();
        await lead.save();
      }
    } else {
      transaction.status = 'approved';
    }

    await transaction.save();

    const populated = await Transaction.findById(transaction._id)
      .populate('property', 'title slug')
      .populate('lead')
      .populate('agency', 'name')
      .populate('agent', 'firstName lastName email')
      .populate('approval.reviewedBy', 'firstName lastName');

    res.json({
      message: pending <= 0 ? 'Booking approved and fully paid' : 'Booking approved',
      transaction: enrichTransactionPaymentSummary(populated)
    });
  } catch (error) {
    console.error('Approve booking error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/transactions/:id/reject
// @desc    Admin rejects a booking request
// @access  Private
router.post('/:id/reject', [
  auth,
  checkModulePermission('leads', 'edit'),
  body('adminNote').trim().notEmpty().withMessage('Rejection note is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    if (req.user.role === 'agency_admin' && transaction.agency.toString() !== req.user.agency) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (!isBookingAwaitingApproval(transaction.status)) {
      return res.status(400).json({
        message: `Only pending booking requests can be rejected (current: ${transaction.status})`
      });
    }

    transaction.status = 'rejected';
    transaction.approval = {
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
      adminNote: req.body.adminNote
    };
    await transaction.save();

    const populated = await Transaction.findById(transaction._id)
      .populate('property', 'title slug')
      .populate('agency', 'name')
      .populate('agent', 'firstName lastName email');

    res.json({
      message: 'Booking rejected',
      transaction: enrichTransactionPaymentSummary(populated)
    });
  } catch (error) {
    console.error('Reject booking error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/transactions/:id/record-payment
// @desc    Record partial or full payment on an approved booking
// @access  Private
router.post('/:id/record-payment', [
  auth,
  checkModulePermission('leads', 'edit'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Payment amount is required'),
  body('paymentMethod').optional().trim(),
  body('transactionReference').optional().trim(),
  body('adminNote').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    if (req.user.role === 'agency_admin' && transaction.agency.toString() !== req.user.agency) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (!['approved', 'pending'].includes(transaction.status)) {
      return res.status(400).json({
        message: `Payments can only be recorded on approved bookings (current: ${transaction.status})`
      });
    }

    const total = Number(transaction.amount || 0);
    const currentPaid = getAmountPaid(transaction);
    const addAmount = Number(req.body.amount);
    const newPaid = Math.min(total, currentPaid + addAmount);
    const pending = Math.max(0, total - newPaid);

    transaction.paymentDetails = {
      ...(transaction.paymentDetails || {}),
      amountPaid: newPaid,
      dueAmount: pending,
      paymentDate: new Date(),
      paymentMethod: req.body.paymentMethod || transaction.paymentDetails?.paymentMethod,
      transactionReference: req.body.transactionReference || transaction.paymentDetails?.transactionReference
    };

    if (req.body.adminNote) {
      transaction.notes = [transaction.notes, req.body.adminNote].filter(Boolean).join('\n');
    }

    if (pending <= 0) {
      transaction.status = 'completed';
      const property = await Property.findById(transaction.property);
      if (property) {
        property.status = transaction.type === 'rent' ? 'rented' : 'sold';
        await property.save();
      }
      const lead = await Lead.findById(transaction.lead);
      if (lead) {
        lead.status = 'booked';
        lead.convertedAt = new Date();
        await lead.save();
      }
    }

    await transaction.save();

    const populated = await Transaction.findById(transaction._id)
      .populate('property', 'title slug')
      .populate('lead')
      .populate('agency', 'name')
      .populate('agent', 'firstName lastName email');

    res.json({
      message: pending <= 0 ? 'Payment recorded — booking completed' : 'Partial payment recorded',
      transaction: enrichTransactionPaymentSummary(populated)
    });
  } catch (error) {
    console.error('Record payment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/transactions/:id
// @desc    Update transaction
// @access  Private (Super Admin, Agency Admin)
router.put('/:id', [
  auth,
  checkModulePermission('leads', 'edit'),
  body('status').optional().isIn(TRANSACTION_STATUSES),
  body('amount').optional().isNumeric()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // Check permissions
    if (req.user.role === 'agency_admin' && transaction.agency.toString() !== req.user.agency) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Update transaction
    Object.assign(transaction, req.body);

    // Recalculate commission if amount or percentage changed
    if (req.body.amount || req.body.commission?.percentage) {
      const amount = req.body.amount || transaction.amount;
      const percentage = req.body.commission?.percentage || transaction.commission?.percentage;
      if (percentage) {
        transaction.commission = {
          percentage: percentage,
          amount: (amount * percentage) / 100
        };
      }
    }

    await transaction.save();

    // Update property and lead status if transaction status changed
    if (req.body.status === 'completed') {
      const property = await Property.findById(transaction.property);
      if (property) {
        if (transaction.type === 'sale') {
          property.status = 'sold';
        } else if (transaction.type === 'rent') {
          property.status = 'rented';
        }
        await property.save();
      }

      // Also ensure lead status is booked/closed
      const lead = await Lead.findById(transaction.lead);
      if (lead) {
        lead.status = 'booked';
        lead.convertedAt = new Date();
        await lead.save();
      }
    }

    const updatedTransaction = await Transaction.findById(transaction._id)
      .populate('property')
      .populate('lead')
      .populate('agency')
      .populate('agent');

    // When admin finalizes (status completed): ensure Payment exists, generate invoice PDF, send email with attachment
    if (req.body.status === 'completed') {
      (async () => {
        try {
          let payment = await Payment.findOne({ transaction: transaction._id });
          const pd = transaction.paymentDetails || {};
          const amountPaid = Number(pd.amountPaid ?? transaction.amount ?? 0);
          const paymentMethod = (pd.paymentMethod || 'bank_transfer').toLowerCase().replace(/-/g, '_');
          const paymentMethodMap = { cash: 'cash', cheque: 'cheque', bank_transfer: 'bank_transfer', credit_card: 'other', other: 'other' };
          const mappedMethod = paymentMethodMap[paymentMethod] || 'other';

          if (!payment) {
            payment = new Payment({
              transaction: transaction._id,
              lead: transaction.lead,
              property: transaction.property,
              agency: transaction.agency,
              amount: amountPaid,
              currency: 'AED',
              paymentMethod: mappedMethod,
              gateway: 'none',
              status: 'completed',
              paymentDate: pd.paymentDate || transaction.transactionDate || new Date(),
              receipt: {
                number: `RCP-${Date.now()}-${String(transaction._id).slice(-6)}`,
                url: `/api/payments/receipt`
              },
              createdBy: req.user.id
            });
            await payment.save();
          } else {
            payment.amount = amountPaid;
            payment.paymentMethod = mappedMethod;
            payment.paymentDate = pd.paymentDate || payment.paymentDate;
            payment.status = 'completed';
            if (!payment.receipt?.number) {
              payment.receipt = payment.receipt || {};
              payment.receipt.number = `RCP-${Date.now()}-${String(transaction._id).slice(-6)}`;
              payment.receipt.url = payment.receipt.url || '/api/payments/receipt';
            }
            await payment.save();
          }

          const invoicePdfBuffer = await paymentService.generateReceiptPDFBuffer(payment._id.toString(), {
            displayCurrency: 'AED'
          });
          const propertyTitle = (updatedTransaction.property?.title || 'property').replace(/\s+/g, '-');
          const fileName = `invoice-${propertyTitle}.pdf`;
          await emailService.sendBookingFinalizedEmail(updatedTransaction, { invoicePdfBuffer, fileName });
        } catch (err) {
          console.error('Error in sendBookingFinalizedEmail background task:', err);
        }
      })();
    }

    res.json(updatedTransaction);
  } catch (error) {
    console.error('Update transaction error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/transactions/:id
// @desc    Delete transaction
// @access  Private (Super Admin only)
router.delete('/:id', auth, authorize('super_admin'), async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    await Transaction.findByIdAndDelete(req.params.id);
    res.json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Delete transaction error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});



// @route   POST /api/transactions/my-transactions/:id/confirm
// @desc    Confirm and pay for a transaction (Mock)
// @access  Private
router.post('/my-transactions/:id/confirm', auth, async (req, res) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) {
      return res.status(401).json({ message: 'User email not found' });
    }

    const transaction = await Transaction.findById(req.params.id)
      .populate('lead')
      .populate('property');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // Check if this transaction belongs to the user (via lead email)
    if (transaction.lead?.contact?.email !== userEmail) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Handle Idempotency and Repair
    if (transaction.status === 'completed') {
      const existingPayment = await Payment.findOne({ transaction: transaction._id });
      if (existingPayment) {
        return res.status(200).json({
          message: 'Transaction already confirmed',
          transaction,
          payment: existingPayment
        });
      }
      // If completed but no payment exists for some reason, proceed to create payment (repair mode)
    } else if (isBookingAwaitingApproval(transaction.status)) {
      transaction.customerConfirmed = true;
      transaction.transactionDate = new Date();
      await transaction.save();
    } else if (transaction.status === 'approved') {
      return res.status(400).json({
        message: 'Booking already approved. Awaiting payment from admin.'
      });
    } else {
      return res.status(400).json({
        message: `Transaction cannot be confirmed. Current status: ${transaction.status}.`
      });
    }

    // Send notification about property confirmation
    await notificationService.notifyPropertyConfirmation(transaction);

    res.json({
      message: 'Property confirmed successfully. Notifications have been sent.',
      transaction
    });
  } catch (error) {
    console.error('Confirm transaction error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
