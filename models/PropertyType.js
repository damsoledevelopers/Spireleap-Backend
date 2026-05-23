const mongoose = require('mongoose');

const NAME_REGEX = /^[A-Za-z0-9\s.'\-/&]+$/;

const propertyTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Property type name is required'],
    unique: true,
    trim: true,
    match: [NAME_REGEX, 'Property type name contains invalid characters']
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true
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

propertyTypeSchema.pre('save', function preSave(next) {
  if (this.isModified('name') && !this.slug) {
    this.slug = String(this.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/(^_|_$)/g, '');
  }
  next();
});

module.exports = mongoose.model('PropertyType', propertyTypeSchema);
