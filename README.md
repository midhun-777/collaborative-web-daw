# Collaborative DAW (Web-based)

A minimal real-time collaborative music sequencer. Multiple users join a room, edit notes, and control transport together. Built with Node.js, Socket.io, and Tone.js.

## Features (MVP)
- Real-time rooms via WebSockets (Socket.io)
- In-memory project state and reducer for actions
- Simple piano-roll grid preview and note list
- Transport controls using Web Audio (Tone.js)

## Stack
- Backend: Node.js, Express, Socket.io
- Frontend: Vanilla JS, Tone.js

## Getting Started

### Prerequisites
- Node.js 18+

### Install & Run
```bash
# From repository root
npm install
npm start
```
The server will start on `http://localhost:3000`.

To join a room, type a room ID and click Join, or use a URL like:
`http://localhost:3000/?room=my-band` or `http://localhost:3000/#my-band`

### Notes
- This demo stores state in memory on the server. Restarting the server clears it.
- No authentication or persistence yet. Do not use in production as-is.

## Project Structure
- `server.js`: Express server, Socket.io events, in-memory room state, action reducer
- `public/`: Static client (HTML/CSS/JS)
  - `index.html`: UI scaffold
  - `client.js`: Socket wiring, local reducer, Tone.js scheduling
  - `styles.css`: Basic styling

## Next Steps
- Add interactive piano roll editing (drag to add/move/resize notes)
- Improve clock/transport sync (drift correction, NTP-style offset)
- Add multiple tracks and instruments
- Persistence (database) and authentication

## License
MIT
