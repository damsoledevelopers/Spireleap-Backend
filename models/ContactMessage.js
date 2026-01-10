const mongoose = require('mongoose');

const contactMessageSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  subject: {
    type: String,
    trim: true
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    trim: true
  },
  isRead: {
    type: Boolean,
    default: false
  },
  agency: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agency',
    required: true
  }
}, {
  timestamps: true
});

// Indexes for better search performance
contactMessageSchema.index({ email: 1 });
contactMessageSchema.index({ phone: 1 });
contactMessageSchema.index({ createdAt: -1 });
contactMessageSchema.index({ agency: 1 });

module.exports = mongoose.model('ContactMessage', contactMessageSchema);

