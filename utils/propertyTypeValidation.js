const PropertyType = require('../models/PropertyType');

const LEGACY_PROPERTY_TYPE_SLUGS = [
  'apartment', 'house', 'villa', 'condo', 'townhouse', 'land', 'commercial',
  'office', 'retail', 'warehouse', 'other',
  'off_plan', 'ready_to_move', 'under_construction'
];

const DEFAULT_PROPERTY_TYPES = [
  { name: 'Apartment', slug: 'apartment', order: 1 },
  { name: 'House', slug: 'house', order: 2 },
  { name: 'Villa', slug: 'villa', order: 3 },
  { name: 'Condo', slug: 'condo', order: 4 },
  { name: 'Townhouse', slug: 'townhouse', order: 5 },
  { name: 'Land', slug: 'land', order: 6 },
  { name: 'Commercial', slug: 'commercial', order: 7 },
  { name: 'Office', slug: 'office', order: 8 },
  { name: 'Retail', slug: 'retail', order: 9 },
  { name: 'Warehouse', slug: 'warehouse', order: 10 },
  { name: 'Other', slug: 'other', order: 99 }
];

async function ensureDefaultPropertyTypes() {
  const count = await PropertyType.countDocuments();
  if (count > 0) return;
  await PropertyType.insertMany(DEFAULT_PROPERTY_TYPES);
}

async function getActivePropertyTypeSlugs() {
  await ensureDefaultPropertyTypes();
  const rows = await PropertyType.find({ isActive: true }).select('slug').lean();
  const slugs = rows.map((r) => r.slug).filter(Boolean);
  return [...new Set([...slugs, ...LEGACY_PROPERTY_TYPE_SLUGS])];
}

async function isValidPropertyTypeSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  const normalized = slug.trim().toLowerCase();
  const allowed = await getActivePropertyTypeSlugs();
  return allowed.includes(normalized);
}

module.exports = {
  DEFAULT_PROPERTY_TYPES,
  LEGACY_PROPERTY_TYPE_SLUGS,
  ensureDefaultPropertyTypes,
  getActivePropertyTypeSlugs,
  isValidPropertyTypeSlug
};
