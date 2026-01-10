const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { auth, authorize } = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const Property = require('../models/Property');
const Lead = require('../models/Lead');
const Payment = require('../models/Payment');

// @route   GET /api/transactions/analytics/revenue
// @desc    Get revenue analytics
// @access  Private
router.get('/analytics/revenue', auth, authorize('super_admin', 'agency_admin'), async (req, res) => {
  try {
    const { startDate, endDate, agency } = req.query;
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
router.get('/', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), async (req, res) => {
  try {
    const { status, type, startDate, endDate, agency, agent } = req.query;
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

    // Role-based filtering
    if (req.user.role === 'agency_admin') {
      query.agency = req.user.agency;
    } else if (req.user.role === 'agent') {
      query.agent = req.user.id;
    }

    const transactions = await Transaction.find(query)
      .populate('property', 'title slug')
      .populate('lead', 'contact leadId status')
      .populate('agency', 'name')
      .populate('agent', 'firstName lastName email phone')
      .sort({ transactionDate: -1 })
      .limit(100);

    res.json(transactions);
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/transactions/:id
// @desc    Get transaction by ID
// @access  Private
router.get('/:id', auth, authorize('super_admin', 'agency_admin', 'agent', 'staff'), async (req, res) => {
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
  authorize('super_admin', 'agency_admin'),
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

    // Update property status if transaction is completed
    if (req.body.status === 'completed') {
      if (req.body.type === 'sale') {
        property.status = 'sold';
      } else if (req.body.type === 'rent') {
        property.status = 'rented';
      }
      await property.save();
    }

    // Update lead status
    if (req.body.status === 'completed') {
      lead.status = 'booked';
      lead.convertedAt = new Date();
      await lead.save();
    }

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

// @route   PUT /api/transactions/:id
// @desc    Update transaction
// @access  Private (Super Admin, Agency Admin)
router.put('/:id', [
  auth,
  authorize('super_admin', 'agency_admin'),
  body('status').optional().isIn(['pending', 'completed', 'cancelled', 'refunded']),
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

    // Update property status if transaction status changed
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
    }

    const updatedTransaction = await Transaction.findById(transaction._id)
      .populate('property')
      .populate('lead')
      .populate('agency')
      .populate('agent');

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

module.exports = router;
