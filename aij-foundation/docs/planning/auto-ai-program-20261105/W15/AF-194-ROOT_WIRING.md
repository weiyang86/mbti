# AF-194 root wiring proposal

Root owns mounting, SDK exports, backend integration and acceptance. Within `AdminConfiguration`, under `admin.config.manage`, mount `<AdminExternalServices api={externalApi} identityKey={identityKey} canManageSecrets={can("admin.secret.manage")} />`. Use `useAdmin()` session, permissions and request; identityKey must change for user, session/CSRF, role or permission changes, without logging or persisting it. Unmount when config permission is lost. Memoize the API object across renders and update a request ref each render, since `useAdmin().request` is recreated on shell render. For example:

```tsx
const { request, session, permissions, can } = useAdmin();
const requestRef = useRef(request); requestRef.current = request;
const identityKey = JSON.stringify([session.user.id, session.csrfToken, permissions.isSuperAdmin, [...permissions.roles].sort(), [...permissions.effectivePermissions].sort()]);
const externalApi = useMemo(() => createExternalServicesApi(async (path, options = {}) => {
  // request supplies the session X-AIJ-CSRF header and cookie credentials.
  // SDK supplies JSON body; decode exactly once for request to encode.
  const body = typeof options.body === 'string' ? JSON.parse(options.body) : undefined;
  return requestRef.current(path, options.method ?? 'GET', body);
}), []);
```

Use the actual SDK export/type after integration; validate the wrapper against its real `ClientApi` signature. `request` does not accept AbortSignal: component generation fencing still ignores late responses; root may extend the real request adapter to forward `options.signal` without bypassing its CSRF, 401 and 403 handling. On session/permission changes keyed remount discards all RAM state. Verify that provider catalog and DTO shape match CONTRACT, and test actual CSRF rejection/success, 409, session/permission changes, desktop and 390px keyboard behavior. Switching service, hiding, blurring or unmounting discards private drafts. No channel is enabled by this UI.
