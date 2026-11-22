'use strict';

function titleBarOverlayOptions(theme) {
  const light = theme === 'light';
  return {
    color: light ? '#ffffff' : '#161a21',
    symbolColor: light ? '#1b2230' : '#e8ecf3',
    height: 50,
  };
}

module.exports = { titleBarOverlayOptions };
