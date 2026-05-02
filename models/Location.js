const mongoose = require('mongoose');

// Allow real-world place names (Unicode letters) plus spaces and common punctuation.
const ALPHA_TEXT_REGEX = /^[\p{L}\s.'-]+$/u;
const isAlphaTextOrEmpty = (v) => {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  if (!s) return true;
  return ALPHA_TEXT_REGEX.test(s);
};

const locationSchema = new mongoose.Schema(
  {
    // Legacy fields kept to satisfy an existing unique index in DB:
    // countryName_1_stateName_1_cityName_1
    countryName: {
      type: String,
      trim: true,
      default: '',
      validate: {
        validator: isAlphaTextOrEmpty,
        message: 'Country must contain only alphabets',
      },
    },
    stateName: {
      type: String,
      trim: true,
      default: '',
      validate: {
        validator: isAlphaTextOrEmpty,
        message: 'State must contain only alphabets',
      },
    },
    cityName: {
      type: String,
      trim: true,
      default: '',
      validate: {
        validator: isAlphaTextOrEmpty,
        message: 'City must contain only alphabets',
      },
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      trim: true,
      validate: {
        validator: isAlphaTextOrEmpty,
        message: 'Country must contain only alphabets',
      },
    },
    state: {
      type: String,
      trim: true,
      default: '',
      validate: {
        validator: isAlphaTextOrEmpty,
        message: 'State must contain only alphabets',
      },
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
      validate: {
        validator: isAlphaTextOrEmpty,
        message: 'City must contain only alphabets',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

locationSchema.index({ country: 1, state: 1, city: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

module.exports = mongoose.model('Location', locationSchema);
