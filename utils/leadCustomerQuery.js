const Lead = require('../models/Lead');
const encryptionService = require('../services/encryptionService');

const PROPERTY_POPULATE = {
  path: 'property',
  populate: [
    { path: 'agency', select: 'name logo' },
    { path: 'agent', select: 'firstName lastName email' }
  ]
};

const INTERESTED_PROPERTY_POPULATE = {
  path: 'interestedProperties.property',
  populate: [
    { path: 'agency', select: 'name logo' },
    { path: 'agent', select: 'firstName lastName email' }
  ]
};

const MY_INQUIRIES_POPULATE = [
  { path: 'property', select: 'title slug images price location' },
  { path: 'interestedProperties.property', select: 'title slug images price location' },
  { path: 'agency', select: 'name logo' },
  { path: 'assignedAgent', select: 'firstName lastName email phone profileImage' }
];

function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function contactEmailMatches(lead, normalizedEmail) {
  if (!lead?.contact) return false;
  const raw = lead.contact.email;
  if (!raw) return false;
  if (typeof raw === 'string') {
    return raw.toLowerCase().trim() === normalizedEmail;
  }
  if (typeof raw === 'object') {
    const decrypted = encryptionService.decryptLeadContact(
      lead.contact.toObject ? lead.contact.toObject() : lead.contact
    );
    return decrypted?.email?.toLowerCase().trim() === normalizedEmail;
  }
  return false;
}

/** Find all leads for a logged-in customer (handles encrypted contact.email). */
async function findLeadsByCustomerEmail(email, populate = MY_INQUIRIES_POPULATE) {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];

  let query = Lead.find({
    $or: [{ 'contact.email': normalized }, { 'contact.email': email }]
  }).sort({ createdAt: -1 });

  if (populate) {
    if (Array.isArray(populate)) {
      populate.forEach((p) => {
        query = query.populate(p);
      });
    } else {
      query = query.populate(populate);
    }
  }

  const plainMatches = await query.lean(false);
  const seen = new Set(plainMatches.map((l) => l._id.toString()));
  const results = [...plainMatches];

  if (encryptionService.enabled) {
    const encryptedLeads = await Lead.find({ 'contact.email': { $type: 'object' } })
      .sort({ createdAt: -1 })
      .limit(3000);

    for (const lead of encryptedLeads) {
      if (seen.has(lead._id.toString())) continue;
      if (!contactEmailMatches(lead, normalized)) continue;
      seen.add(lead._id.toString());
      let populated = lead;
      if (populate) {
        populated = await Lead.findById(lead._id);
        if (Array.isArray(populate)) {
          for (const p of populate) {
            await populated.populate(p);
          }
        } else {
          await populated.populate(populate);
        }
      }
      results.push(populated);
    }

    results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  return results;
}

/** One customer-facing row per property inquired (primary + interestedProperties). */
function expandLeadsToCustomerInquiries(leadDocs) {
  const rows = [];
  const seenKeys = new Set();

  for (const lead of leadDocs) {
    const leadObj = lead.toObject ? lead.toObject() : lead;
    const leadId = String(leadObj._id);

    const addRow = (property, inquiredAt) => {
      if (!property) return;
      const propId =
        property._id?.toString?.() ||
        (typeof property === 'object' ? null : String(property));
      if (!propId) return;
      const key = `${leadId}:${propId}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      rows.push({
        ...leadObj,
        property: typeof property === 'object' ? property : leadObj.property,
        _inquiryKey: key,
        inquiredAt: inquiredAt || leadObj.createdAt
      });
    };

    if (leadObj.property) {
      addRow(leadObj.property, leadObj.createdAt);
    }

    for (const entry of leadObj.interestedProperties || []) {
      if (entry?.property) {
        addRow(entry.property, entry.date || leadObj.updatedAt || leadObj.createdAt);
      }
    }
  }

  return rows.sort((a, b) => new Date(b.inquiredAt) - new Date(a.inquiredAt));
}

/** Unique properties from all customer leads (for My Properties → Inquiries tab). */
function collectInquiredPropertiesFromLeads(leadDocs) {
  const byId = new Map();

  const addProperty = (property) => {
    if (!property || typeof property !== 'object') return;
    const id = property._id?.toString?.();
    if (!id || byId.has(id)) return;
    byId.set(id, property);
  };

  for (const lead of leadDocs) {
    const leadObj = lead.toObject ? lead.toObject() : lead;
    addProperty(leadObj.property);
    for (const entry of leadObj.interestedProperties || []) {
      addProperty(entry?.property);
    }
  }

  return Array.from(byId.values());
}

module.exports = {
  findLeadsByCustomerEmail,
  expandLeadsToCustomerInquiries,
  collectInquiredPropertiesFromLeads,
  PROPERTY_POPULATE,
  INTERESTED_PROPERTY_POPULATE
};
