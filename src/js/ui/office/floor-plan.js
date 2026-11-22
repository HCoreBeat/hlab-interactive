'use strict';

/**
 * Floor plan of the pixel-art office.
 *
 * The whole office lives in a single 34x9 tile grid: five rooms side by side
 * that share the walls between them, with a two-tile door on every shared wall.
 * The map is built once at import time and never changes.
 *
 * Colours live in `THEMES` so the office can be painted as a lit daytime
 * space (dark app theme) or as a bright one (light app theme).
 */

export const TILE = 40;
export const COLS = 42;
export const ROWS = 9;
export const VIEW_W = COLS * TILE;
export const VIEW_H = ROWS * TILE;
export const SPEED = 140; // logical px per second

export const FLOOR = 0;
export const WALL = 1;
export const DOOR = 2;
export const DESK = 3;
export const CHAIR = 4;
export const RACK = 5;
export const SHELF = 6;
export const TABLE = 7;
export const PLANT = 8;
export const TERMINAL = 9;
export const COFFEE = 10;
export const COOLER = 11;
export const PRINTER = 12;
export const TREE = 13;
export const BENCH = 14;
export const PICNIC = 15;
export const HOOP = 16;
export const FLOWERS = 17;
export const POND = 18;
export const FIREPIT = 19;

export const ROOMS = [
  { id: 'main', name: 'HLab Interactive', x: 0, w: 12 },
  { id: 'server', name: 'Servidores', x: 11, w: 7 },
  { id: 'mcp', name: 'Zona MCP', x: 17, w: 8 },
  { id: 'archive', name: 'Archivo', x: 24, w: 5 },
  { id: 'meeting', name: 'Reuniones', x: 28, w: 6 },
  { id: 'patio', name: 'Patio', x: 33, w: 9 },
];

/** Ceiling lamps (tile coordinates) and windows (top wall) per room. */
export const LAMPS = {
  main: [[3.5, 2.6], [7.5, 2.6], [3.5, 6.4], [7.5, 6.4]],
  server: [[14, 2], [16, 2], [14, 6], [16, 6]],
  mcp: [[19.5, 2.4], [22.5, 2.4], [19.5, 6.2], [22.5, 6.2]],
  archive: [[26, 2.6], [26, 5.6]],
  meeting: [[31, 2.4], [31, 6.2]],
  patio: [[35.5, 2.2], [39.5, 2.2], [35.5, 6.4], [39.2, 5.4]],
};

/** Windows on the top wall: [x, width in tiles]. */
export const WINDOWS = [[2, 2], [6, 2], [25, 2]];

export const THEMES = {
  dark: {
    outside: '#090c13',
    lamp: 'rgba(255, 210, 145, 0.035)',
    lampCore: 'rgba(255, 230, 185, 0.09)',
    beam: 'rgba(255, 215, 155, 0.02)',
    shadow: 'rgba(3, 5, 10, 0.52)',
    sky: 'rgba(125, 160, 220, 0.075)',
    rooms: [
      { color: '#293246', alt: '#35415a', wall: '#151b27', wallTop: '#2b3549', rug: '#3d4e6d' },
      { color: '#20362d', alt: '#2b4639', wall: '#121f19', wallTop: '#263e32', rug: null },
      { color: '#22324e', alt: '#2e4161', wall: '#131c2d', wallTop: '#263959', rug: '#2f486f' },
      { color: '#40311f', alt: '#51402a', wall: '#261b11', wallTop: '#42311e', rug: null },
      { color: '#382745', alt: '#49345a', wall: '#21172b', wallTop: '#38274a', rug: '#503765' },
      { color: '#2f5a3a', alt: '#37663f', wall: '#16301f', wallTop: '#2f6a3a', rug: null },
    ],
  },
  light: {
    outside: '#737e91',
    lamp: 'rgba(255, 205, 135, 0.018)',
    lampCore: 'rgba(255, 230, 185, 0.045)',
    beam: 'rgba(255, 215, 145, 0.01)',
    shadow: 'rgba(18, 25, 38, 0.52)',
    sky: 'rgba(110, 132, 168, 0.035)',
    rooms: [
      { color: '#505c73', alt: '#606d85', wall: '#333e53', wallTop: '#515e75', rug: '#5c6f8e' },
      { color: '#496b5a', alt: '#5c7d6b', wall: '#304c3d', wallTop: '#4c6c5a', rug: null },
      { color: '#4b6388', alt: '#5d7599', wall: '#304566', wallTop: '#4c6589', rug: '#5b7596' },
      { color: '#735c3d', alt: '#896e49', wall: '#58442c', wallTop: '#755d3c', rug: null },
      { color: '#69547c', alt: '#7e6691', wall: '#514064', wallTop: '#6b5680', rug: '#79628f' },
      { color: '#5f9a62', alt: '#6aa86c', wall: '#3d6d44', wallTop: '#5e9a62', rug: null },
    ],
  },
};

export function themePalette() {
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  return THEMES[theme];
}

export const PALETTE = [
  { shirt: '#e06c75', hair: '#2f2a24', skin: '#f0c39a' },
  { shirt: '#61afef', hair: '#241d18', skin: '#e8b48c' },
  { shirt: '#98c379', hair: '#4a3222', skin: '#f5cfa6' },
  { shirt: '#e5c07b', hair: '#1d1a17', skin: '#d9a273' },
  { shirt: '#c678dd', hair: '#5a3a24', skin: '#f2c39b' },
  { shirt: '#56b6c2', hair: '#2b2118', skin: '#e6b28a' },
  { shirt: '#d19a66', hair: '#3a2c1e', skin: '#f7d3ad' },
  { shirt: '#abb2bf', hair: '#241f1a', skin: '#e9b98f' },
];

export const STATUS = {
  idle: { icon: '☕', label: 'en espera' },
  think: { icon: '💭', label: 'pensando' },
  code: { icon: '⌨️', label: 'editando' },
  terminal: { icon: '💻', label: 'shell' },
  read: { icon: '📖', label: 'leyendo' },
  search: { icon: '🔎', label: 'buscando' },
  mcp: { icon: '🔌', label: 'mcp' },
  wait: { icon: '✋', label: 'permiso' },
  meet: { icon: '👥', label: 'reunión' },
  error: { icon: '❌', label: 'error' },
};

// UI uses SVG icons (see util/ui-icons.js), never emojis.
const ICON_NAMES = {
  idle: 'coffee', think: 'think', code: 'code', terminal: 'terminal', read: 'read', search: 'search',
  mcp: 'mcp', wait: 'lock', meet: 'agents', error: 'alert', break: 'coffee',
};
STATUS.break = { label: 'descanso' };
Object.keys(ICON_NAMES).forEach((name) => { STATUS[name].icon = ICON_NAMES[name]; });

// Estados del patio (agentes e inactivos fuera de la oficina)
STATUS.chill = { icon: 'coffee', label: 'descansando' };
STATUS.play = { icon: 'spark', label: 'jugando' };
STATUS.garden = { icon: 'spark', label: 'en el jardín' };
STATUS.chat = { icon: 'agents', label: 'charlando' };
STATUS.stretch = { icon: 'spark', label: 'estirándose' };
STATUS.phone = { icon: 'agents', label: 'al teléfono' };
STATUS.nap = { icon: 'coffee', label: 'echando una siesta' };
STATUS.write = { icon: 'notes', label: 'en la pizarra' };
STATUS.dance = { icon: 'spark', label: 'bailando' };
STATUS.book = { icon: 'read', label: 'leyendo un libro' };

// ------------------------------------------------------------------ map ------

export const map = [];
export const roomOf = [];
for (let x = 0; x < COLS; x += 1) {
  map.push(new Array(ROWS).fill(WALL));
  roomOf.push(new Array(ROWS).fill(-1));
}

function carve(roomIndex) {
  const room = ROOMS[roomIndex];
  for (let x = room.x + 1; x < room.x + room.w - 1; x += 1) {
    for (let y = 1; y < ROWS - 1; y += 1) {
      map[x][y] = FLOOR;
      roomOf[x][y] = roomIndex;
    }
  }
}
ROOMS.forEach((_, index) => carve(index));

// Shared walls: punch a two-tile door between neighbours.
[11, 17, 24, 28, 33].forEach((x) => {
  map[x][3] = DOOR;
  map[x][4] = DOOR;
});

function put(x, y, type) {
  if (map[x] && y >= 0 && y < ROWS) map[x][y] = type;
}

// Main office: eight desks with chairs.
export const DESK_SPOTS = [];
[[2, 2], [4, 2], [6, 2], [8, 2], [2, 5], [4, 5], [6, 5], [8, 5]].forEach(([x, y]) => {
  put(x, y, DESK);
  put(x, y + 1, CHAIR);
  DESK_SPOTS.push({ x, y: y + 1 });
});
[[1, 1], [10, 1], [1, 7], [10, 7]].forEach(([x, y]) => put(x, y, PLANT));
put(10, 2, COFFEE);
put(10, 6, COOLER);
put(1, 4, PRINTER);
/** Where idle workers stroll to: coffee machine, water cooler, printer. */
export const BREAK_SPOTS = [{ x: 9, y: 2 }, { x: 9, y: 3 }, { x: 9, y: 6 }, { x: 9, y: 5 }, { x: 2, y: 4 }, { x: 1, y: 3 }];

// Server room: two banks of racks with a walkable corridor.
[13, 15].forEach((x) => {
  [1, 2, 5, 6, 7].forEach((y) => put(x, y, RACK));
});
export const SERVER_SPOTS = [
  { x: 14, y: 3 }, { x: 14, y: 4 }, { x: 16, y: 3 }, { x: 16, y: 4 }, { x: 12, y: 3 },
];

// MCP room: four terminals and their chairs.
export const MCP_SPOTS = [];
[[19, 2], [21, 2], [19, 5], [21, 5]].forEach(([x, y]) => {
  put(x, y, TERMINAL);
  put(x, y + 1, CHAIR);
  MCP_SPOTS.push({ x, y: y + 1 });
});

// Archive: two shelf walls with an aisle.
// Rows 3-4 stay open: they line up with the doors, otherwise the archive and
// the meeting room behind it are completely unreachable.
[25, 27].forEach((x) => {
  for (let y = 1; y <= 7; y += 1) {
    if (y === 3 || y === 4) continue;
    put(x, y, SHELF);
  }
});
export const ARCHIVE_SPOTS = [
  { x: 26, y: 2 }, { x: 26, y: 5 }, { x: 26, y: 1 }, { x: 26, y: 6 }, { x: 26, y: 7 },
];

// Meeting room: table plus chairs.
[[30, 3], [31, 3], [30, 4], [31, 4]].forEach(([x, y]) => put(x, y, TABLE));
export const MEETING_SPOTS = [
  { x: 30, y: 2 }, { x: 31, y: 2 }, { x: 30, y: 5 }, { x: 31, y: 5 },
];
[[30, 2], [31, 2], [30, 5], [31, 5]].forEach(([x, y]) => put(x, y, CHAIR));

// Patio exterior: árboles, bancos, mesa de picnic, canasta, jardín, estanque y fogata.
// La entrada es la puerta de la sala de reuniones (x=33, filas 3-4).
[[34, 1], [40, 1], [34, 7], [40, 7]].forEach(([x, y]) => put(x, y, TREE));
[[36, 1], [38, 1], [37, 3], [38, 3], [37, 5], [38, 5], [35, 3], [35, 5]].forEach(([x, y]) => put(x, y, BENCH));
[[37, 4], [38, 4]].forEach(([x, y]) => put(x, y, PICNIC));
put(40, 3, HOOP);
[[35, 7], [36, 7]].forEach(([x, y]) => put(x, y, FLOWERS));
[[38, 7], [39, 7]].forEach(([x, y]) => put(x, y, POND));
put(35, 4, FIREPIT);

/** Qué hacen los inactivos en el patio: estado + casilla. */
export const PATIO_ACTIVITIES = [
  { state: 'book', spot: { x: 36, y: 1 } },
  { state: 'play', spot: { x: 39, y: 3 } },
  { state: 'garden', spot: { x: 35, y: 6 } },
  { state: 'chat', spot: { x: 37, y: 3 } },
  { state: 'chill', spot: { x: 38, y: 1 } },
  { state: 'play', spot: { x: 39, y: 4 } },
  { state: 'chat', spot: { x: 38, y: 5 } },
  { state: 'garden', spot: { x: 36, y: 6 } },
  { state: 'chill', spot: { x: 38, y: 6 } },
  { state: 'chat', spot: { x: 35, y: 3 } },
  { state: 'chill', spot: { x: 39, y: 6 } },
  { state: 'dance', spot: { x: 36, y: 5 } },
  { state: 'dance', spot: { x: 36, y: 4 } },
  { state: 'chat', spot: { x: 35, y: 5 } },
];

/** Regar las plantas de la oficina y escribir en la pizarra de reuniones. */
export const WATER_SPOTS = [{ x: 2, y: 1 }, { x: 9, y: 1 }, { x: 2, y: 7 }, { x: 9, y: 7 }];
export const BOARD_SPOTS = [{ x: 30, y: 1 }, { x: 31, y: 1 }];

/** Hacia dónde mira el agente al llegar a una casilla (1 = derecha, -1 = izquierda). */
export const FACE_AT = {
  '9,2': 1, '9,3': 1, '9,6': 1, '9,5': 1, '2,4': -1, '1,3': -1, '39,3': 1, '39,4': 1, '30,1': 1, '31,1': 1,
  // plantas de la oficina: el agente mira hacia la maceta que riega
  '2,1': -1, '9,1': 1, '2,7': -1, '9,7': 1,
};

export function walkable(x, y) {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return false;
  const tile = map[x][y];
  return tile === FLOOR || tile === DOOR || tile === CHAIR || tile === BENCH;
}

let reachSet = null;

/** True when the tile can be reached on foot from the main office. */
export function reachable(x, y) {
  if (!reachSet) {
    reachSet = new Set();
    const first = DESK_SPOTS[0];
    const stack = [first];
    reachSet.add(`${first.x},${first.y}`);
    while (stack.length) {
      const node = stack.pop();
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = node.x + dx;
        const ny = node.y + dy;
        const id = `${nx},${ny}`;
        if (reachSet.has(id) || !walkable(nx, ny)) continue;
        reachSet.add(id);
        stack.push({ x: nx, y: ny });
      }
    }
  }
  return reachSet.has(`${x},${y}`);
}

/** Breadth-first path between two tiles over the walkable tiles. */
export function findPath(start, goal) {
  if (start.x === goal.x && start.y === goal.y) return [];
  const queue = [{ x: start.x, y: start.y, path: [] }];
  const seen = new Set([`${start.x},${start.y}`]);
  while (queue.length) {
    const node = queue.shift();
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = node.x + dx;
      const ny = node.y + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key) || !walkable(nx, ny)) continue;
      seen.add(key);
      const path = [...node.path, { x: nx, y: ny }];
      if (nx === goal.x && ny === goal.y) return path;
      queue.push({ x: nx, y: ny, path });
    }
  }
  return [];
}

// --------------------------------------------------------------- colours ----

export function shade(hex, amount) {
  const num = parseInt(hex.slice(1), 16);
  const clamp = (value) => Math.max(0, Math.min(255, value));
  const r = clamp(((num >> 16) & 255) + amount);
  const g = clamp(((num >> 8) & 255) + amount);
  const b = clamp((num & 255) + amount);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export function rgba(hex, alpha) {
  const num = parseInt(hex.slice(1), 16);
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}
