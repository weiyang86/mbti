// Same original regression, a fresh AF206 protected target, serially scheduled by the AF228 root registry.
process.env.AIJ_AF206_ROOT_ACCEPTANCE = 'true';
await import('./personal-workflow-runtime-live.test.mjs');
