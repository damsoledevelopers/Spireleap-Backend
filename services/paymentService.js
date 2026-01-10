const Razorpay = require('razorpay');
const stripe = require('stripe');
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
const Lead = require('../models/Lead');

class PaymentService {
  constructor() {
    // Initialize Razorpay
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      this.razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      });
    }

    // Initialize Stripe
    if (process.env.STRIPE_SECRET_KEY) {
      this.stripe = stripe(process.env.STRIPE_SECRET_KEY);
    }
  }

  /**
   * Create payment order for Razorpay
   */
  async createRazorpayOrder(amount, currency = 'INR', metadata = {}) {
    if (!this.razorpay) {
      throw new Error('Razorpay not configured');
    }

    try {
      const options = {
        amount: amount * 100, // Convert to paise
        currency: currency,
        receipt: `receipt_${Date.now()}`,
        notes: metadata
      };

      const order = await this.razorpay.orders.create(options);
      return order;
    } catch (error) {
      console.error('Razorpay order creation error:', error);
      throw error;
    }
  }

  /**
   * Verify Razorpay payment signature
   */
  verifyRazorpaySignature(orderId, paymentId, signature) {
    if (!this.razorpay) {
      throw new Error('Razorpay not configured');
    }

    const crypto = require('crypto');
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(orderId + '|' + paymentId)
      .digest('hex');

    return generatedSignature === signature;
  }

  /**
   * Create payment intent for Stripe
   */
  async createStripePaymentIntent(amount, currency = 'usd', metadata = {}) {
    if (!this.stripe) {
      throw new Error('Stripe not configured');
    }

    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: amount * 100, // Convert to cents
        currency: currency.toLowerCase(),
        metadata: metadata
      });

      return paymentIntent;
    } catch (error) {
      console.error('Stripe payment intent creation error:', error);
      throw error;
    }
  }

  /**
   * Verify Stripe payment
   */
  async verifyStripePayment(paymentIntentId) {
    if (!this.stripe) {
      throw new Error('Stripe not configured');
    }

    try {
      const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      return paymentIntent;
    } catch (error) {
      console.error('Stripe payment verification error:', error);
      throw error;
    }
  }

  /**
   * Create payment record
   */
  async createPayment(paymentData) {
    try {
      const payment = new Payment(paymentData);
      await payment.save();
      return payment;
    } catch (error) {
      console.error('Payment creation error:', error);
      throw error;
    }
  }

  /**
   * Update payment status
   */
  async updatePaymentStatus(paymentId, status, gatewayData = {}) {
    try {
      const payment = await Payment.findById(paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }

      payment.status = status;
      
      if (gatewayData.paymentId) {
        payment.gatewayPaymentId = gatewayData.paymentId;
      }
      if (gatewayData.orderId) {
        payment.gatewayOrderId = gatewayData.orderId;
      }
      if (gatewayData.signature) {
        payment.gatewaySignature = gatewayData.signature;
      }

      if (status === 'completed') {
        payment.paymentDate = new Date();
        // Generate receipt number
        payment.receipt = {
          number: `RCP-${Date.now()}`,
          url: `/api/payments/${paymentId}/receipt`
        };

        // Update transaction status
        const transaction = await Transaction.findById(payment.transaction);
        if (transaction) {
          transaction.status = 'completed';
          await transaction.save();
        }

        // Update lead booking status
        const lead = await Lead.findById(payment.lead);
        if (lead && lead.booking) {
          lead.booking.agreementStatus = 'signed';
          lead.status = 'booked';
          await lead.save();
        }
      }

      await payment.save();
      return payment;
    } catch (error) {
      console.error('Payment status update error:', error);
      throw error;
    }
  }

  /**
   * Process refund
   */
  async processRefund(paymentId, amount, reason) {
    try {
      const payment = await Payment.findById(paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }

      if (payment.status !== 'completed') {
        throw new Error('Only completed payments can be refunded');
      }

      let refundResult = null;

      // Process refund through gateway
      if (payment.gateway === 'razorpay' && payment.gatewayPaymentId) {
        if (!this.razorpay) {
          throw new Error('Razorpay not configured');
        }
        refundResult = await this.razorpay.payments.refund(payment.gatewayPaymentId, {
          amount: amount * 100 // Convert to paise
        });
      } else if (payment.gateway === 'stripe' && payment.gatewayPaymentId) {
        if (!this.stripe) {
          throw new Error('Stripe not configured');
        }
        refundResult = await this.stripe.refunds.create({
          payment_intent: payment.gatewayPaymentId,
          amount: amount * 100 // Convert to cents
        });
      }

      // Update payment record
      payment.status = 'refunded';
      payment.refund = {
        amount: amount,
        reason: reason,
        refundedAt: new Date(),
        gatewayRefundId: refundResult?.id || null
      };

      await payment.save();

      // Update transaction status
      const transaction = await Transaction.findById(payment.transaction);
      if (transaction) {
        transaction.status = 'refunded';
        await transaction.save();
      }

      return payment;
    } catch (error) {
      console.error('Refund processing error:', error);
      throw error;
    }
  }

  /**
   * Generate payment receipt PDF
   */
  async generateReceipt(paymentId) {
    try {
      const payment = await Payment.findById(paymentId)
        .populate('transaction')
        .populate('lead')
        .populate('property')
        .populate('agency');

      if (!payment) {
        throw new Error('Payment not found');
      }

      // This would use PDFKit to generate receipt
      // For now, return receipt data
      return {
        paymentId: payment._id,
        receiptNumber: payment.receipt?.number || `RCP-${payment._id}`,
        date: payment.paymentDate,
        amount: payment.amount,
        currency: payment.currency,
        paymentMethod: payment.paymentMethod,
        property: payment.property?.title,
        lead: payment.lead ? `${payment.lead.contact.firstName} ${payment.lead.contact.lastName}` : null,
        agency: payment.agency?.name
      };
    } catch (error) {
      console.error('Receipt generation error:', error);
      throw error;
    }
  }
}

module.exports = new PaymentService();

