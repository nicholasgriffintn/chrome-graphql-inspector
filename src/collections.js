export function prependBounded(collection, value, limit) {
  collection.unshift(value);
  return collection.splice(limit);
}

export function appendBounded(collection, value, limit) {
  collection.push(value);
  return collection.splice(0, Math.max(0, collection.length - limit));
}
