const mongoose = require('mongoose');

const NAME_REGEX = /^[A-Za-z\s.'-]+$/;

const amenitySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Amenity name is required'],
    unique: true,
    trim: true,
    match: [NAME_REGEX, 'Amenity name must contain only alphabets']
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true
  },
  icon: String,
  category: {
    type: String,
    enum: ['interior', 'exterior', 'community', 'security', 'other'],
    default: 'other'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Generate slug before saving
amenitySchema.pre('save', function(next) {
  if (this.isModified('name') && !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  next();
});

module.exports = mongoose.model('Amenity', amenitySchema);

