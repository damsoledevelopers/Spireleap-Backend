const mongoose = require('mongoose');

const currencySchema = new mongoose.Schema(
  {
    countryName: {
      type: String,
      required: [true, 'Country name is required'],
      trim: true,
    },
    currencyName: {
      type: String,
      required: [true, 'Currency name is required'],
      trim: true,
    },
    currencyCode: {
      type: String,
      required: [true, 'Currency code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 10,
    },
    aedRate: {
      type: Number,
      required: [true, 'AED rate is required'],
      min: [0, 'AED rate must be >= 0'],
    },
    status: {
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

currencySchema.pre('save', function (next) {
  if (this.isModified('currencyCode') && this.currencyCode) {
    this.currencyCode = String(this.currencyCode).trim().toUpperCase();
  }
  next();
});

module.exports = mongoose.model('Currency', currencySchema);

