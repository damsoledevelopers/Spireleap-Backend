const mongoose = require('mongoose');
const Settings = require('../models/Settings');
const Agency = require('../models/Agency');
const User = require('../models/User');

const KEY_DEFAULT_AGENCY = 'general.defaultAgencyId';
const KEY_DEFAULT_AGENT = 'general.defaultAgentId';

function toObjectId(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

async function readSettingObjectId(key) {
  const doc = await Settings.findOne({ key }).lean();
  return toObjectId(doc?.value);
}

/** Customer contact when lead has agency but no assigned agent — agency admin first. */
async function pickAgencyCustomerContact(agencyId) {
  if (!agencyId) return null;

  const agencyAdmin = await User.findOne({
    role: 'agency_admin',
    agency: agencyId,
    isActive: true
  })
    .select('_id')
    .sort({ createdAt: 1 });

  if (agencyAdmin) return agencyAdmin._id;

  return pickFallbackAgentForAgency(agencyId, null);
}

async function pickFallbackAgentForAgency(agencyId, preferredAgentId = null) {
  if (!agencyId) return null;

  if (preferredAgentId) {
    const preferred = await User.findOne({
      _id: preferredAgentId,
      agency: agencyId,
      isActive: true,
      role: { $in: ['agent', 'agency_admin'] }
    }).select('_id');
    if (preferred) return preferred._id;
  }

  const defaultAgent = await User.findOne({
    role: 'agent',
    agency: agencyId,
    isActive: true
  })
    .select('_id')
    .sort({ createdAt: 1 });
  if (defaultAgent) return defaultAgent._id;

  const agencyAdmin = await User.findOne({
    role: 'agency_admin',
    agency: agencyId,
    isActive: true
  }).select('_id');
  return agencyAdmin?._id || null;
}

/**
 * Platform defaults from General Settings (validated against active agency/agent).
 */
async function getDefaultAgencyAgentIds() {
  let agencyId = await readSettingObjectId(KEY_DEFAULT_AGENCY);
  let agentId = await readSettingObjectId(KEY_DEFAULT_AGENT);

  if (agencyId) {
    const agency = await Agency.findOne({ _id: agencyId, isActive: { $ne: false } }).select('_id');
    if (!agency) agencyId = null;
  }

  if (agentId) {
    const agent = await User.findOne({
      _id: agentId,
      role: { $in: ['agent', 'agency_admin'] },
      isActive: true
    }).select('_id agency');
    if (!agent) {
      agentId = null;
    } else if (agencyId && agent.agency && agent.agency.toString() !== agencyId.toString()) {
      agentId = null;
    } else if (!agencyId && agent.agency) {
      agencyId = agent.agency;
    }
  }

  if (agencyId && !agentId) {
    agentId = await pickFallbackAgentForAgency(agencyId, await readSettingObjectId(KEY_DEFAULT_AGENT));
  }

  return { agencyId, agentId };
}

async function isDefaultAgencyId(id) {
  if (!id) return false;
  const defaultId = await readSettingObjectId(KEY_DEFAULT_AGENCY);
  return Boolean(defaultId && String(defaultId) === String(id));
}

async function isDefaultAgentId(id) {
  if (!id) return false;
  const defaultId = await readSettingObjectId(KEY_DEFAULT_AGENT);
  return Boolean(defaultId && String(defaultId) === String(id));
}

/**
 * Apply platform defaults when agency/agent not selected (respect explicit "none").
 */
async function applyDefaultsToAgencyAgent({
  agency,
  agent,
  agencyExplicitlyNone = false,
  agentExplicitlyNone = false
} = {}) {
  let agencyId = toObjectId(agency);
  let agentId = toObjectId(agent);

  if (agencyExplicitlyNone) {
    return { agencyId: null, agentId: agentExplicitlyNone ? null : agentId };
  }

  if (!agencyId || !agentId) {
    const defaults = await getDefaultAgencyAgentIds();
    if (!agencyId && defaults.agencyId) agencyId = defaults.agencyId;
    // Platform default agent only for leads with no agency (never override another agency)
    if (!agentId && !agencyId && defaults.agentId) agentId = defaults.agentId;
  }

  if (agentId && !agencyId) {
    const agentUser = await User.findById(agentId).select('agency isActive role');
    if (agentUser?.isActive && agentUser.agency) agencyId = agentUser.agency;
  }

  if (agencyId && !agentId && !agentExplicitlyNone) {
    const platformDefaultAgentId = await readSettingObjectId(KEY_DEFAULT_AGENT);
    const preferredForAgency =
      platformDefaultAgentId &&
      (await User.findOne({
        _id: platformDefaultAgentId,
        agency: agencyId,
        isActive: true,
        role: { $in: ['agent', 'agency_admin'] }
      }).select('_id'))
        ? platformDefaultAgentId
        : null;
    agentId = await pickFallbackAgentForAgency(agencyId, preferredForAgency);
  }

  return { agencyId, agentId };
}

async function validateDefaultAgencyAgentSettings(agencyIdRaw, agentIdRaw) {
  const agencyId = toObjectId(agencyIdRaw);
  const agentId = toObjectId(agentIdRaw);

  if (!agencyId && !agentId) {
    return { ok: true, agencyId: null, agentId: null };
  }

  if (!agencyId && agentId) {
    return { ok: false, message: 'Select a default agency before choosing a default agent.' };
  }

  const agency = await Agency.findOne({ _id: agencyId, isActive: { $ne: false } });
  if (!agency) {
    return { ok: false, message: 'Default agency not found or is inactive.' };
  }

  if (!agentId) {
    return { ok: true, agencyId, agentId: null };
  }

  const agent = await User.findOne({
    _id: agentId,
    agency: agencyId,
    isActive: true,
    role: { $in: ['agent', 'agency_admin'] }
  });
  if (!agent) {
    return {
      ok: false,
      message: 'Default agent must be an active agent or agency admin under the selected default agency.'
    };
  }

  return { ok: true, agencyId, agentId };
}

async function getDefaultAgencyAgentIdStrings() {
  const { agencyId, agentId } = await getDefaultAgencyAgentIds();
  return {
    defaultAgencyId: agencyId ? String(agencyId) : null,
    defaultAgentId: agentId ? String(agentId) : null
  };
}

/**
 * Customer-facing agency/agent (My Inquiries, contact agent).
 * - Assigned agent on lead → always use that.
 * - Lead has agency, no agent → that agency's admin / agent only (never another agency's default).
 * - Lead has no agency → platform default agency + agent from General Settings.
 */
async function resolveLeadCustomerDisplayContacts(leadObj) {
  const leadAgencyId = toObjectId(leadObj.agency?._id || leadObj.agency);
  const leadAgentId = toObjectId(leadObj.assignedAgent?._id || leadObj.assignedAgent);

  let displayAgency = leadObj.agency && typeof leadObj.agency === 'object' ? leadObj.agency : null;
  let displayAgent =
    leadObj.assignedAgent && typeof leadObj.assignedAgent === 'object' ? leadObj.assignedAgent : null;

  let usingDefaultAgency = false;
  let usingDefaultAgent = false;
  let usingAgencyFallback = false;

  const platformDefaults = await getDefaultAgencyAgentIds();
  const agentSelect = 'firstName lastName email phone profileImage';

  if (leadAgentId && !displayAgent) {
    displayAgent = await User.findById(leadAgentId).select(agentSelect).lean();
  }

  if (!leadAgentId) {
    if (leadAgencyId) {
      const fallbackAgentId = await pickAgencyCustomerContact(leadAgencyId);
      if (fallbackAgentId) {
        displayAgent = await User.findById(fallbackAgentId).select(agentSelect).lean();
        usingAgencyFallback = true;
      }
    } else {
      if (!displayAgency && platformDefaults.agencyId) {
        displayAgency = await Agency.findById(platformDefaults.agencyId).select('name logo').lean();
        usingDefaultAgency = true;
      }
      if (platformDefaults.agentId) {
        displayAgent = await User.findById(platformDefaults.agentId).select(agentSelect).lean();
        usingDefaultAgent = true;
      }
    }
  }

  if (!displayAgency && leadAgencyId) {
    displayAgency = await Agency.findById(leadAgencyId).select('name logo').lean();
  }

  return {
    displayAgency: displayAgency || null,
    displayAgent: displayAgent || null,
    usingDefaultAgency,
    usingDefaultAgent,
    usingAgencyFallback
  };
}

module.exports = {
  KEY_DEFAULT_AGENCY,
  KEY_DEFAULT_AGENT,
  getDefaultAgencyAgentIds,
  getDefaultAgencyAgentIdStrings,
  applyDefaultsToAgencyAgent,
  validateDefaultAgencyAgentSettings,
  isDefaultAgencyId,
  isDefaultAgentId,
  pickFallbackAgentForAgency,
  pickAgencyCustomerContact,
  resolveLeadCustomerDisplayContacts
};
