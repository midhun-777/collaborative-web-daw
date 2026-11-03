'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

// Serve static client
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store of rooms -> project state
// NOTE: This is volatile. For production, persist to DB and add auth.
const rooms = new Map();

function createEmptyProject() {
  return {
    id: nanoid(10),
    name: 'New Project',
    tempoBpm: 120,
    quantizeSteps: 16, // steps per bar
    bars: 4,
    tracks: [
      {
        id: 'track-1',
        name: 'Synth Lead',
        instrument: { type: 'synth' },
        notes: [] // { id, pitch (MIDI 21-108), start (beats), duration (beats), velocity 0..1 }
      }
    ],
    transport: {
      isPlaying: false,
      loopStart: 0,
      loopEnd: 4, // bars
      lastStartAt: 0 // server unix ms when started
    },
    updatedAt: Date.now()
  };
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      project: createEmptyProject(),
      clients: new Set()
    });
  }
  return rooms.get(roomId);
}

// Reducer for project actions
function applyAction(project, action) {
  const next = { ...project, tracks: project.tracks.map(t => ({ ...t })) };
  const now = Date.now();
  switch (action.type) {
    case 'note:add': {
      const track = next.tracks.find(t => t.id === action.trackId) || next.tracks[0];
      const note = {
        id: action.note?.id || nanoid(8),
        pitch: action.note?.pitch ?? 60,
        start: action.note?.start ?? 0,
        duration: action.note?.duration ?? 0.5,
        velocity: Math.max(0, Math.min(1, action.note?.velocity ?? 0.9))
      };
      track.notes = [...track.notes, note];
      break;
    }
    case 'note:update': {
      const track = next.tracks.find(t => t.id === action.trackId) || next.tracks[0];
      track.notes = track.notes.map(n => (n.id === action.note.id ? { ...n, ...action.note } : n));
      break;
    }
    case 'note:delete': {
      const track = next.tracks.find(t => t.id === action.trackId) || next.tracks[0];
      track.notes = track.notes.filter(n => n.id !== action.noteId);
      break;
    }
    case 'tempo:set': {
      const bpm = Number(action.bpm);
      if (!Number.isNaN(bpm) && bpm > 20 && bpm < 300) {
        next.tempoBpm = Math.round(bpm);
      }
      break;
    }
    case 'transport:play': {
      next.transport = {
        ...next.transport,
        isPlaying: true,
        lastStartAt: now
      };
      break;
    }
    case 'transport:stop': {
      next.transport = {
        ...next.transport,
        isPlaying: false
      };
      break;
    }
    case 'transport:setLoop': {
      const { loopStart, loopEnd } = action;
      if (typeof loopStart === 'number') next.transport.loopStart = Math.max(0, loopStart);
      if (typeof loopEnd === 'number') next.transport.loopEnd = Math.max(next.transport.loopStart, loopEnd);
      break;
    }
    default:
      return project;
  }
  next.updatedAt = now;
  return next;
}

io.on('connection', (socket) => {
  let joinedRoomId = null;

  socket.on('room:join', (roomId) => {
    if (joinedRoomId) {
      socket.leave(joinedRoomId);
    }
    joinedRoomId = String(roomId || 'default');
    const room = getRoom(joinedRoomId);
    room.clients.add(socket.id);
    socket.join(joinedRoomId);

    // Send initial snapshot only to the new client
    socket.emit('project:snapshot', room.project);
  });

  socket.on('project:action', (action) => {
    if (!joinedRoomId) return;
    const room = getRoom(joinedRoomId);
    const before = room.project;
    const after = applyAction(before, action);
    // If unchanged, do nothing
    if (after === before) return;
    room.project = after;

    // Broadcast the action and server time; clients apply locally
    socket.to(joinedRoomId).emit('project:action', { action, serverTime: Date.now() });
    // Optionally also emit to sender to acknowledge with authoritative time
    socket.emit('project:ack', { updatedAt: after.updatedAt });
  });

  socket.on('disconnect', () => {
    if (joinedRoomId) {
      const room = getRoom(joinedRoomId);
      room.clients.delete(socket.id);
    }
  });
});

server.listen(PORT, () => {
  /* eslint-disable no-console */
  console.log(`Server running on http://localhost:${PORT}`);
});


