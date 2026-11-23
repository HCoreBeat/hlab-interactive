'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  clip: [['path', { d: 'M21 11.5l-8.6 8.6a5.2 5.2 0 01-7.4-7.4l9-9a3.4 3.4 0 014.8 4.8l-9 9a1.7 1.7 0 01-2.4-2.4l7.9-7.9' }]],
  notes: [['path', { d: 'M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z' }], ['path', { d: 'M8 3v18', opacity: '0.5' }], ['path', { d: 'M11 8h5M11 12h5M11 16h3' }], ['path', { d: 'M17 2v5l-1.5-1-1.5 1V2', fill: 'currentColor', opacity: '0.35' }]],
  assistant: [['rect', { x: 4, y: 6, width: 16, height: 14, rx: 5 }], ['path', { d: 'M12 3v3M8 12h.01M16 12h.01M9 16h6M2 12h2M20 12h2' }], ['circle', { cx: 12, cy: 3, r: 1 }]],
  person: [['circle', { cx: 12, cy: 8, r: 3 }], ['path', { d: 'M5 21v-2a7 7 0 0 1 14 0v2' }]],
  sessions: [['rect', { x: 3, y: 3, width: 15, height: 12, rx: 2.5 }], ['circle', { cx: 7.5, cy: 8, r: 1.8 }], ['path', { d: 'M11 7h4M11 10h3' }], ['path', { d: 'M6 18h13a2 2 0 0 0 2-2V8', opacity: '0.5' }], ['circle', { cx: 8, cy: 18, r: 1.5, opacity: '0.5' }], ['path', { d: 'M11 17h4', opacity: '0.5' }]],
  agents: [['circle', { cx: 8.5, cy: 7, r: 3 }], ['path', { d: 'M3 19v-1.5A4.5 4.5 0 0 1 7.5 13h2a4.5 4.5 0 0 1 4.5 4.5V19' }], ['circle', { cx: 16.5, cy: 8, r: 2.4, opacity: '0.75' }], ['path', { d: 'M14 19v-1a4 4 0 0 1 4-4h.8a4 4 0 0 1 4 4v1', opacity: '0.75' }], ['circle', { cx: 18.5, cy: 5, r: 1.4, fill: 'currentColor', stroke: 'none' }]],
  activity: [['path', { d: 'M3 12h3l2.2-5.5 3.4 11 2.6-7 1.8 3h5' }], ['rect', { x: 3, y: 18, width: 3, height: 3, rx: 1, opacity: '0.5' }], ['rect', { x: 10, y: 18, width: 3, height: 3, rx: 1, opacity: '0.5' }], ['rect', { x: 17, y: 18, width: 4, height: 3, rx: 1, opacity: '0.5' }]],
  files: [['path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1' }], ['path', { d: 'M3 8v9a2 2 0 0 0 2 2h9l6-6V9a2 2 0 0 0-2-2H5a2 2 0 0 0-2 1z' }], ['path', { d: 'M14 19v-4a2 2 0 0 1 2-2h4', opacity: '0.6' }], ['path', { d: 'M7 12h5M7 15h3', opacity: '0.7' }]],
  terminal: [['rect', { x: 3, y: 4, width: 18, height: 14, rx: 2.5 }], ['path', { d: 'M3 8h18' }], ['circle', { cx: 6, cy: 6, r: 0.7, fill: 'currentColor', stroke: 'none' }], ['circle', { cx: 8.5, cy: 6, r: 0.7, fill: 'currentColor', stroke: 'none', opacity: '0.6' }], ['path', { d: 'm7 12 2.5 2.5L7 17M12 17h4' }]],
  context: [['path', { d: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }], ['path', { d: 'M7 12h5M7 16h4', opacity: '0.7' }], ['rect', { x: 14, y: 12, width: 6, height: 4, rx: 1 }], ['path', { d: 'M16 12v4', opacity: '0.6' }]],
  mcp: [['rect', { x: 9, y: 8, width: 6, height: 5, rx: 1.5 }], ['circle', { cx: 12, cy: 4.5, r: 1.8 }], ['circle', { cx: 5, cy: 17.5, r: 1.8 }], ['circle', { cx: 19, cy: 17.5, r: 1.8 }], ['path', { d: 'M12 6.3v1.7M9.5 13l-3 3M14.5 13l3 3' }], ['path', { d: 'M11 10.5h2', opacity: '0.7' }]],
  inspector: [['circle', { cx: 10.5, cy: 10.5, r: 6 }], ['path', { d: 'm15 15 5.5 5.5' }], ['path', { d: 'M7.5 9h6M7.5 12h4' }], ['circle', { cx: 12.5, cy: 12, r: 0.8, fill: 'currentColor', stroke: 'none' }], ['path', { d: 'M3 18h3', opacity: '0.5' }]],
  office: [['path', { d: 'M3 21h18M5 21V7l7-4 7 4v14M9 10h2M14 10h2M9 14h2M14 14h2M10 21v-3h4v3' }]],
  folder: [['path', { d: 'M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }]],
  trash: [['path', { d: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  external: [['path', { d: 'M7 17 17 7M8 7h9v9' }]],
  coffee: [['path', { d: 'M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM16 10h2a2 2 0 0 1 0 4h-2M8 3v3M12 3v3' }]],
  think: [['path', { d: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z' }]],
  code: [['path', { d: 'm8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14' }]],
  git: [['circle', { cx: 6, cy: 5, r: 2, fill: 'currentColor', opacity: '0.9' }], ['circle', { cx: 6, cy: 19, r: 2, fill: 'currentColor', opacity: '0.9' }], ['circle', { cx: 18, cy: 12, r: 2, fill: 'currentColor', opacity: '0.9' }], ['path', { d: 'M6 7v10' }], ['path', { d: 'M8 6h4a4 4 0 0 1 4 4v0' }], ['path', { d: 'M16 14v0a4 4 0 0 1-4 4H8' }]],
  read: [['path', { d: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM8 7h7M8 11h5' }]],
  search: [['circle', { cx: 11, cy: 11, r: 6 }], ['path', { d: 'm16 16 5 5' }]],
  chevron: [['path', { d: 'm6 9 6 6 6-6' }]],
  lock: [['rect', { x: 5, y: 11, width: 14, height: 9, rx: 2 }], ['path', { d: 'M8 11V8a4 4 0 0 1 8 0v3' }]],
  alert: [['path', { d: 'M12 4 2 20h20zM12 10v4M12 17h.01' }]],
  globe: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18' }]],
  list: [['path', { d: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01' }]],
  wrench: [['path', { d: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-.6-.6-2.6z' }]],
  check: [['path', { d: 'm5 12 5 5 9-10' }]],
  clock: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]],
  stop: [['rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }]],
  ban: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'm5.6 5.6 12.8 12.8' }]],
  volume: [['path', { d: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12' }]],
  settings: [['circle', { cx: 12, cy: 12, r: 3 }], ['path', { d: 'm19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V4a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2.9z' }]],
  mute: [['path', { d: 'M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6' }]],
  pencil: [['path', { d: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4' }]],
  spark: [['path', { d: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6' }]],
  eye: [['path', { d: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
  map: [['path', { d: 'M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20zM9 4v13.5M15 6.5V20' }]],
  help: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M9.6 9a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01' }]],
};

export function uiIcon(name, size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attributes] of ICONS[name] || ICONS.activity) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    svg.appendChild(node);
  }
  return svg;
}
