'use strict';

const { badRequest } = require('./errors');

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`Field '${field}' is required and must be a non-empty string`, { field });
  }
  return value.trim();
}

function requireEnum(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw badRequest(`Field '${field}' must be one of: ${allowed.join(', ')}`, { field, allowed });
  }
  return value;
}

function requirePositiveInt(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw badRequest(`Field '${field}' must be a positive integer`, { field });
  }
  return value;
}

function optionalString(value, field) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw badRequest(`Field '${field}' must be a string when provided`, { field });
  }
  return value.trim();
}

function requireIsoDate(value, field) {
  requireString(value, field);
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    throw badRequest(`Field '${field}' must be a valid ISO-8601 date-time`, { field });
  }
  return value;
}

function requireBoolean(value, field, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value !== 'boolean') {
    throw badRequest(`Field '${field}' must be a boolean`, { field });
  }
  return value;
}

/**
 * Validate the `items` array of a checklist. Each item must have a unique
 * non-empty item_key and a label.
 */
function requireChecklistItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest("Field 'items' must be a non-empty array", { field: 'items' });
  }
  const seen = new Set();
  return items.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw badRequest(`items[${index}] must be an object`, { field: 'items', index });
    }
    const itemKey = requireString(item.item_key, `items[${index}].item_key`);
    const label = requireString(item.label, `items[${index}].label`);
    if (seen.has(itemKey)) {
      throw badRequest(`Duplicate item_key '${itemKey}' in items`, { field: 'items', item_key: itemKey });
    }
    seen.add(itemKey);
    return { item_key: itemKey, label };
  });
}

module.exports = {
  requireString,
  requireEnum,
  requirePositiveInt,
  optionalString,
  requireIsoDate,
  requireBoolean,
  requireChecklistItems,
};
