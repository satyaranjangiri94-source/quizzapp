# QuizNest — Vercel-ready frontend + Firebase

This folder is prepared for import into Vercel. **Vite is the build tool used by the React app; Vercel is still the hosting platform.** Seeing “Vite” as the Framework Preset in Vercel is expected and correct.

## Deploy the frontend on Vercel

1. Upload the *contents* of this folder to a GitHub repository (files should be at the repository root, including `package.json` and `index.html`).
2. In Vercel, choose **Add New → Project** and import the repository.
3. Framework Preset: **Vite** (leave it as Vite).
4. Build Command: `npm run build`
5. Output Directory: `dist`
6. Click **Deploy**.

The `package.json` includes React, React DOM, Vite, and Firebase. `firebase.js` contains the Firebase web configuration provided for project `forum-bb6bd`.

## Enable Firebase quiz storage

1. In Firebase Console, open project `forum-bb6bd`.
2. Enable **Authentication → Sign-in method → Anonymous**.
3. Open **Realtime Database → Rules**, paste the contents of `database.rules.json`, and Publish.

Quiz storage is protected per Firebase anonymous user. It syncs for that browser identity; it does not automatically sync with the separate QuizNest email/password account across devices.

## Important limitation

Vercel hosts the frontend and Firebase stores quiz data. The current custom account, friends, and live multiplayer features still use the Express/Socket.IO backend in `server.js`; deploy that backend separately using `render.yaml` on Render. Then set `VITE_API_URL` and `VITE_SOCKET_URL` in Vercel to the Render service URL, and set `FRONTEND_URL` in Render to your Vercel site URL.

Do not publish `.env` secrets or `node_modules`. Firebase client configuration is included intentionally; database access is controlled by Firebase Authentication and database rules.


## Quiz editor and room troubleshooting

- The **My quizzes** page shows the Firebase sync state. If it says **Local backup active**, your quiz editor can still save a browser-local copy and queue it for sync; local backups are only available in that browser.
- In Firebase Console, verify **Authentication → Sign-in method → Anonymous** is enabled, then publish the root contents of `database.rules.json` under **Realtime Database → Rules**. The rules in this repository allow each authenticated Firebase user to read and write only their own `quiznestUsers/{uid}` node.
- The Express/Socket.IO service exposes `/api/health`. Open `https://YOUR-RENDER-SERVICE.onrender.com/api/health` to confirm that the API is awake and responding.
- In Vercel, set `VITE_API_URL` and `VITE_SOCKET_URL` to the Render service origin (no path suffix). In Render, set `FRONTEND_URL` to the exact Vercel origin. Multiple allowed frontend origins can be comma-separated.
- If solo play opens a room but never enters the lobby, check the API health route and the browser console for Socket.IO connection errors. The UI now reports room creation and join timeouts instead of waiting forever.
