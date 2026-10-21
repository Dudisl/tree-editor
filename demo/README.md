# Generic Action Handler API — interactive test host

Run from the repository root:

```bash
cd demo
npm install
npm run dev
```

Open http://localhost:3000. Select a node on the left and select an action from the tree toolbar.

The demo stores a real JSON file at `demo/.demo-data/action-demo.json`, using an atomic rename after writing. You can inspect it to verify reload. The demo server supports only the fixed project `action-demo` and the two explicitly allowed actions. It is for **local development only**, without authentication or production safeguards.

Scenarios: Success, Handler returns failure, Handler throws, Invalid response, Reload fails once (use Retry Reload), and Save fails (handler should not execute). The event log shows every handler invocation. Use the form to edit a field before running an action to verify save ordering.

To typecheck: `npm run typecheck`. To compile the app: `npm run build`. Do not deploy the demo as a public service.
