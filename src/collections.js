export function prependBounded(collection, value, limit) {
  collection.unshift(value);
  return collection.splice(limit);
}

export function appendBounded(collection, value, limit) {
  collection.push(value);
  return collection.splice(0, Math.max(0, collection.length - limit));
}

export function estimateValueBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function prependWithinBudget(
  collection,
  value,
  { maxItems, maxBytes },
) {
  collection.unshift(value);
  return trimWithinBudget(collection, { maxItems, maxBytes, oldestAt: "end" });
}

export function appendWithinBudget(
  collection,
  value,
  { maxItems, maxBytes },
) {
  collection.push(value);
  return trimWithinBudget(collection, { maxItems, maxBytes, oldestAt: "start" });
}

export function trimWithinBudget(
  collection,
  { maxItems = Number.POSITIVE_INFINITY, maxBytes = Number.POSITIVE_INFINITY, oldestAt = "end" },
) {
  let totalBytes = collection.reduce((total, item) => total + estimateValueBytes(item), 0);
  const evicted = [];
  while (collection.length > maxItems || totalBytes > maxBytes) {
    const removed = oldestAt === "start" ? collection.shift() : collection.pop();
    if (removed === undefined) break;
    totalBytes -= estimateValueBytes(removed);
    evicted.push(removed);
  }
  return evicted;
}
