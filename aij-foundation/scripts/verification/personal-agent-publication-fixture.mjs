import assert from 'node:assert/strict';

/** Real Cookie/API fixture setup, never a raw-SQL publication bypass. */
export async function publishPersonalAgentFixture(request, agent, options = {}) {
  assert.equal(agent.enabled, true);
  const unwrap = response => response?.data ?? response;
  const metadata = unwrap(await request('GET', `client/ai/personal-agents/${agent.id}/publication`, options));
  assert.equal(metadata.revision, agent.revision);
  const result = unwrap(await request('POST', `client/ai/personal-agents/${agent.id}/publication/publish`, {
    ...options, body: { expectedAgentRevision: metadata.revision, expectedPublicationVersion: metadata.publicationVersion }
  }));
  assert.equal(result.published, true);
  assert.equal(result.publishedRevision, agent.revision);
  return agent;
}
