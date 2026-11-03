/* global io, Tone */

const socket = io();

// UI elements
const roomInput = document.getElementById('roomId');
const joinBtn = document.getElementById('joinRoom');
const statusEl = document.getElementById('status');
const tempoInput = document.getElementById('tempo');
const playBtn = document.getElementById('play');
const stopBtn = document.getElementById('stop');
const addNoteBtn = document.getElementById('addNote');
const notesList = document.getElementById('notesList');
const rollGrid = document.getElementById('rollGrid');

let currentRoom = 'default';
let project = null;
let synth = null;
let part = null;

function ensureAudio() {
  if (synth) return;
  synth = new Tone.PolySynth(Tone.Synth).toDestination();
}

function renderNotes() {
  if (!project) return;
  const track = project.tracks[0];
  notesList.innerHTML = '';
  track.notes
    .slice()
    .sort((a, b) => a.start - b.start)
    .forEach((n) => {
      const li = document.createElement('li');
      li.textContent = `id=${n.id} pitch=${n.pitch} start=${n.start.toFixed(2)} dur=${n.duration.toFixed(2)}`;
      notesList.appendChild(li);
    });

  // Simple grid of 4 bars x 16 steps (64 steps)
  rollGrid.innerHTML = '';
  const steps = project.quantizeSteps * project.bars; // 16 * 4 = 64
  for (let i = 0; i < steps; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (i % project.quantizeSteps === 0) cell.classList.add('bar');
    rollGrid.appendChild(cell);
  }
}

function schedulePlayback() {
  if (!project) return;
  ensureAudio();
  const track = project.tracks[0];

  if (part) {
    part.dispose();
    part = null;
  }

  // Convert beats to Tone.Transport time using quarterNote = 1 beat
  const events = track.notes.map((n) => ({
    time: n.start,
    note: Tone.Frequency(n.pitch, 'midi').toNote(),
    dur: n.duration,
    vel: n.velocity
  }));

  part = new Tone.Part((time, ev) => {
    synth.triggerAttackRelease(ev.note, ev.dur, time, ev.vel);
  }, events.map((e) => [e.time, e]));
  part.start(0);

  Tone.Transport.bpm.value = project.tempoBpm;
  Tone.Transport.loop = true;
  Tone.Transport.loopStart = `${project.transport.loopStart}m`;
  Tone.Transport.loopEnd = `${project.transport.loopEnd}m`;

  if (project.transport.isPlaying) {
    // Align start time approximately by server clock; best effort without clock sync
    Tone.start();
    if (!Tone.Transport.state || Tone.Transport.state !== 'started') {
      Tone.Transport.start();
    }
  } else {
    Tone.Transport.stop();
  }
}

function applyActionLocal(action) {
  // Mirror server reducer for determinism
  const next = { ...project, tracks: project.tracks.map((t) => ({ ...t })) };
  switch (action.type) {
    case 'note:add': {
      const track = next.tracks.find((t) => t.id === action.trackId) || next.tracks[0];
      const note = {
        id: action.note?.id,
        pitch: action.note?.pitch ?? 60,
        start: action.note?.start ?? 0,
        duration: action.note?.duration ?? 0.5,
        velocity: Math.max(0, Math.min(1, action.note?.velocity ?? 0.9))
      };
      track.notes = [...track.notes, note];
      project = next;
      break;
    }
    case 'note:update': {
      const track = next.tracks.find((t) => t.id === action.trackId) || next.tracks[0];
      track.notes = track.notes.map((n) => (n.id === action.note.id ? { ...n, ...action.note } : n));
      project = next;
      break;
    }
    case 'note:delete': {
      const track = next.tracks.find((t) => t.id === action.trackId) || next.tracks[0];
      track.notes = track.notes.filter((n) => n.id !== action.noteId);
      project = next;
      break;
    }
    case 'tempo:set': {
      const bpm = Number(action.bpm);
      if (!Number.isNaN(bpm) && bpm > 20 && bpm < 300) {
        next.tempoBpm = Math.round(bpm);
      }
      project = next;
      break;
    }
    case 'transport:play': {
      next.transport = {
        ...next.transport,
        isPlaying: true
      };
      project = next;
      break;
    }
    case 'transport:stop': {
      next.transport = {
        ...next.transport,
        isPlaying: false
      };
      project = next;
      break;
    }
    case 'transport:setLoop': {
      const { loopStart, loopEnd } = action;
      if (typeof loopStart === 'number') next.transport.loopStart = Math.max(0, loopStart);
      if (typeof loopEnd === 'number') next.transport.loopEnd = Math.max(next.transport.loopStart, loopEnd);
      project = next;
      break;
    }
    default:
      break;
  }
  renderNotes();
  schedulePlayback();
}

function joinRoom(roomId) {
  currentRoom = String(roomId || 'default');
  socket.emit('room:join', currentRoom);
}

// Socket events
socket.on('connect', () => {
  statusEl.textContent = 'Connected';
});

socket.on('disconnect', () => {
  statusEl.textContent = 'Disconnected';
});

socket.on('project:snapshot', (snapshot) => {
  project = snapshot;
  tempoInput.value = project.tempoBpm;
  renderNotes();
  schedulePlayback();
});

socket.on('project:action', ({ action }) => {
  // Apply remote actions
  applyActionLocal(action);
});

socket.on('project:ack', () => {
  // no-op for now
});

// UI wiring
joinBtn.addEventListener('click', () => {
  const id = roomInput.value.trim() || 'default';
  joinRoom(id);
});

playBtn.addEventListener('click', async () => {
  await Tone.start();
  socket.emit('project:action', { type: 'transport:play' });
  applyActionLocal({ type: 'transport:play' });
});

stopBtn.addEventListener('click', () => {
  socket.emit('project:action', { type: 'transport:stop' });
  applyActionLocal({ type: 'transport:stop' });
});

tempoInput.addEventListener('change', () => {
  const bpm = Number(tempoInput.value);
  const action = { type: 'tempo:set', bpm };
  socket.emit('project:action', action);
  applyActionLocal(action);
});

addNoteBtn.addEventListener('click', () => {
  const step = project.quantizeSteps; // 16 per bar
  const totalSteps = step * project.bars;
  const startStep = Math.floor(Math.random() * totalSteps);
  const startBeats = (startStep / step) * 4; // 4 beats per bar
  const durationBeats = 0.5; // eighth note
  const pitch = 60 + Math.floor(Math.random() * 12); // C4 - B4
  const action = {
    type: 'note:add',
    trackId: project.tracks[0].id,
    note: { pitch, start: startBeats, duration: durationBeats, velocity: 0.9 }
  };
  socket.emit('project:action', action);
  applyActionLocal(action);
});

// Auto-join room from hash or query param
(() => {
  const url = new URL(window.location.href);
  const q = url.searchParams.get('room') || window.location.hash.replace('#', '') || 'default';
  roomInput.value = q;
  joinRoom(q);
})();


