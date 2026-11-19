// Human acceptance is recorded from the current conversation by the coordinator.
// This checks append-only provenance; it cannot authenticate a human or accept code.
import assert from 'node:assert/strict';
export function verifyOwnerAcceptanceHistory(current, historical, readEvidence) {
  assert.ok(Array.isArray(current) && Array.isArray(historical));
  assert.ok(current.length >= historical.length);
  assert.deepEqual(current.slice(0, historical.length), historical, 'Historical owner records must remain byte-equivalent data');
  const ids = new Set(); const appended = [];
  for (const row of current.slice(historical.length)) {
    assert.ok(row && Object.getPrototypeOf(row) === Object.prototype);
    assert.equal(row.status, 'ACCEPTED_BY_OWNER');
    assert.match(row.id, /^OWNER-[A-Z0-9_-]{3,80}$/); assert.ok(!ids.has(row.id)); ids.add(row.id);
    assert.match(row.evidencePath, /^docs\/governance\/[A-Z0-9_-]+\.json$/);
    assert.match(row.evidenceSha256, /^[a-f0-9]{64}$/);
    assert.ok(typeof row.source === 'string' && row.source.length >= 8);
    const { data, sha256 } = readEvidence(row.evidencePath);
    assert.equal(sha256, row.evidenceSha256); assert.equal(data.schemaVersion, 1);
    assert.equal(data.status, 'ACCEPTED_BY_OWNER'); assert.equal(data.sourceKind, 'CURRENT_OWNER_CHAT');
    assert.equal(data.id, row.id); assert.equal(data.sourceQuote, row.source); assert.equal(data.acceptedAt, row.acceptedAt);
    assert.ok(Number.isFinite(Date.parse(row.acceptedAt)));
    assert.ok(Array.isArray(data.cards) && data.cards.length > 0 && data.cards.length <= 4);
    const formalIds = data.cards.map(card => card.formalTaskId);
    assert.ok(formalIds.every(id => /^AF-[0-9]{3}(?:-A)?$/.test(id)));
    assert.equal(new Set(formalIds).size, formalIds.length);
    assert.deepEqual(row.cards, formalIds); assert.deepEqual(row.scope, formalIds);
    for (const card of data.cards) {
      assert.match(card.commit, /^[a-f0-9]{40}$/); assert.match(card.integrationTaskId, /^task_[a-f0-9]+$/);
      assert.match(card.report, new RegExp('^\\.artifacts/verification/' + card.formalTaskId + '/run-[A-Za-z0-9]+/report\\.json$'));
      assert.ok(typeof card.title === 'string' && card.title.length > 0);
    }
    appended.push(data);
  }
  return appended;
}
