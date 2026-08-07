const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

const players = {};
let worldBlocks = {};
let animals = {};
let weather = { type: 'clear', intensity: 0 };
const WORLD_FILE = path.join(__dirname, 'world.json');
const ANIMALS_FILE = path.join(__dirname, 'animals.json');

// ---------- Noise ----------
function noise2(x, z) {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return n - Math.floor(n);
}
function smoothNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const a = noise2(ix, iz), b = noise2(ix + 1, iz);
  const c = noise2(ix, iz + 1), d = noise2(ix + 1, iz + 1);
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm(x, z, oct = 4) {
  let v = 0, amp = 1, freq = 0.035;
  for (let i = 0; i < oct; i++) {
    v += smoothNoise(x * freq, z * freq) * amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return v;
}

// Get highest solid block Y at (x,z)
function getSurfaceY(x, z) {
  for (let y = 20; y >= -6; y--) {
    if (worldBlocks[`\( {Math.round(x)}, \){y},${Math.round(z)}`]) return y;
  }
  return 0;
}

function generateDefaultTerrain(preset = 'hills') {
  worldBlocks = {};
  const size = 40;          // good balance for mobile + free Render
  const half = size / 2;

  for (let x = -half; x < half; x++) {
    for (let z = -half; z < half; z++) {
      let h = 0;

      if (preset === 'flat') {
        h = 0;                           // solid flat platform
      } else if (preset === 'hills') {
        h = Math.floor(fbm(x, z) * 6) - 1;
      } else if (preset === 'mountains') {
        h = Math.floor(fbm(x * 0.6, z * 0.6) * 11) - 2;
      } else if (preset === 'island') {
        const dist = Math.sqrt(x * x + z * z) / half;
        h = Math.floor((1 - dist) * 5 + fbm(x, z) * 3) - 1;
        if (dist > 0.82) h = -3;         // water edge
      }

      // Always place solid ground layers
      for (let y = -5; y <= h; y++) {
        let type = 3;                    // stone
        if (y === h) type = 1;           // grass top
        else if (y >= h - 2) type = 2;   // dirt
        worldBlocks[`\( {x}, \){y},${z}`] = type;
      }

      // Trees (only on grass, not flat)
      if (preset !== 'flat' && h >= 0 && noise2(x * 0.25, z * 0.25) > 0.91) {
        const trunkH = 3 + Math.floor(noise2(x + 1, z) * 2);
        for (let t = 1; t <= trunkH; t++) {
          worldBlocks[`\( {x}, \){h + t},${z}`] = 4;
        }
        for (let lx = -2; lx <= 2; lx++) {
          for (let lz = -2; lz <= 2; lz++) {
            for (let ly = 0; ly <= 2; ly++) {
              if (Math.abs(lx) + Math.abs(lz) + ly < 4) {
                const key = `\( {x + lx}, \){h + trunkH + ly},${z + lz}`;
                if (!worldBlocks[key]) worldBlocks[key] = 5;
              }
            }
          }
        }
      }
    }
  }

  saveWorld();
  spawnAnimals();
  console.log(`Generated ${preset} world with ${Object.keys(worldBlocks).length} blocks`);
}

function spawnAnimals() {
  animals = {};
  const types = ['cow', 'pig', 'sheep'];
  for (let i = 0; i < 14; i++) {
    const id = 'a' + i;
    const ax = (Math.random() - 0.5) * 32;
    const az = (Math.random() - 0.5) * 32;
    const surface = getSurfaceY(ax, az);
    animals[id] = {
      id,
      type: types[i % 3],
      x: ax,
      y: surface + 1.1,
      z: az,
      ry: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 0.5,
      targetX: ax,
      targetZ: az,
      wait: 0
    };
  }
  saveAnimals();
}

function loadWorld() {
  if (fs.existsSync(WORLD_FILE)) {
    try {
      worldBlocks = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
      console.log(`Loaded ${Object.keys(worldBlocks).length} blocks`);
    } catch (e) {
      generateDefaultTerrain('hills');
    }
  } else {
    generateDefaultTerrain('hills');
  }

  if (fs.existsSync(ANIMALS_FILE)) {
    try {
      animals = JSON.parse(fs.readFileSync(ANIMALS_FILE, 'utf8'));
    } catch (e) {
      spawnAnimals();
    }
  } else {
    spawnAnimals();
  }
}

function saveWorld() {
  try { fs.writeFileSync(WORLD_FILE, JSON.stringify(worldBlocks)); } catch (e) {}
}
function saveAnimals() {
  try { fs.writeFileSync(ANIMALS_FILE, JSON.stringify(animals)); } catch (e) {}
}

function generateRandomSkin() {
  const skinTones = [0xffccaa, 0x8d5524, 0xe0ac69, 0xf1c27d, 0x3d2c23];
  const shirts = [0xd32f2f, 0x388e3c, 0x1976d2, 0xfbc02d, 0x7b1fa2, 0x00bcd4];
  const pants = [0x1a237e, 0x263238, 0x3e2723, 0x4e342e];
  return {
    skin: skinTones[Math.floor(Math.random() * skinTones.length)],
    shirt: shirts[Math.floor(Math.random() * shirts.length)],
    pants: pants[Math.floor(Math.random() * pants.length)]
  };
}

// Animal AI + weather
setInterval(() => {
  const t = Date.now() / 1000;
  const phase = (t % 200) / 200;
  if (phase < 0.6) weather = { type: 'clear', intensity: 0 };
  else if (phase < 0.85) weather = { type: 'rain', intensity: 0.55 + Math.sin(t) * 0.2 };
  else weather = { type: 'storm', intensity: 0.85 };

  Object.values(animals).forEach(a => {
    a.wait -= 0.2;
    if (a.wait <= 0) {
      // pick new target every few seconds
      a.targetX = a.x + (Math.random() - 0.5) * 14;
      a.targetZ = a.z + (Math.random() - 0.5) * 14;
      a.targetX = Math.max(-18, Math.min(18, a.targetX));
      a.targetZ = Math.max(-18, Math.min(18, a.targetZ));
      a.wait = 2 + Math.random() * 4;
    }

    const dx = a.targetX - a.x;
    const dz = a.targetZ - a.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 0.4) {
      a.ry = Math.atan2(dx, dz);
      a.x += Math.sin(a.ry) * a.speed * 0.12;
      a.z += Math.cos(a.ry) * a.speed * 0.12;
    }

    // snap to surface so they never float
    const surface = getSurfaceY(a.x, a.z);
    a.y = surface + 1.05;
  });

  io.emit('animalsUpdate', animals);
  io.emit('weatherUpdate', weather);
}, 250);

loadWorld();

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('join', (name) => {
    const playerName = (name || 'Builder').trim().substring(0, 15);
    players[socket.id] = {
      name: playerName,
      x: 0, y: 6, z: 0, ry: 0,
      colors: generateRandomSkin()
    };

    socket.emit('init', {
      id: socket.id,
      players,
      worldBlocks,
      animals,
      weather
    });

    socket.broadcast.emit('playerJoin', { id: socket.id, player: players[socket.id] });
    io.emit('chatMessage', { sender: 'System', text: `${playerName} joined!` });
  });

  socket.on('move', (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].z = data.z;
      players[socket.id].ry = data.ry;
      socket.broadcast.emit('playerMove', { id: socket.id, ...data });
    }
  });

  socket.on('updateBlock', (data) => {
    const key = `\( {data.x}, \){data.y},${data.z}`;
    if (data.type === 0) delete worldBlocks[key];
    else worldBlocks[key] = data.type;
    socket.broadcast.emit('blockUpdate', data);
    saveWorld();
  });

  socket.on('chatMessage', (text) => {
    if (players[socket.id] && text) {
      const clean = text.trim().substring(0, 100);
      if (clean) io.emit('chatMessage', { sender: players[socket.id].name, text: clean });
    }
  });

  socket.on('regenWorld', (preset) => {
    const allowed = ['flat', 'hills', 'mountains', 'island'];
    if (!allowed.includes(preset)) preset = 'hills';
    generateDefaultTerrain(preset);
    io.emit('worldRegen', { worldBlocks, animals });
    io.emit('chatMessage', { sender: 'System', text: `World regenerated: ${preset}` });
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      io.emit('chatMessage', { sender: 'System', text: `${players[socket.id].name} left.` });
      delete players[socket.id];
      io.emit('playerLeave', socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});