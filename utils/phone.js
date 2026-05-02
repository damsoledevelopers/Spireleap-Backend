const { parsePhoneNumberFromString } = require('libphonenumber-js')

/**
 * Validates and normalizes a phone number to E.164.
 * Accepts numbers that already include '+' country calling code.
 */
function normalizePhoneToE164(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return ''

  const parsed = parsePhoneNumberFromString(raw)
  if (!parsed || !parsed.isValid()) return ''
  return parsed.number
}

function assertValidPhone(input) {
  const e164 = normalizePhoneToE164(input)
  if (!e164) {
    const err = new Error('Invalid phone number')
    err.code = 'INVALID_PHONE'
    throw err
  }
  return e164
}

module.exports = { normalizePhoneToE164, assertValidPhone }