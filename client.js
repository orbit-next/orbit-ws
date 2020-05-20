// note: for now everything in here assumes little endian


// source: https://en.wikibooks.org/wiki/QBasic/Advanced_Input
const EXTENDED_KEYS_MAP = new Map(Object.entries({
  'F1': 59,
  'F2': 60,
  'F3': 61,
  'F4': 62,
  'F5': 63,
  'F6': 64,
  'F7': 65,
  'F8': 66,
  'F9': 67,
  'F10': 68,
  'F11': 133,
  'F12': 134,
  'Home': 71,
  'ArrowUp': 72,
  'PageUp': 73,
  'ArrowLeft': 75,
  'ArrowRight': 77,
  'End': 79,
  'ArrowDown': 80,
  'PageDown': 81,
  'Insert': 82,
  'Delete': 83,
}));

const resolveKeyboardEvent = (ev) => {
  const { key } = ev;
  let keyBuf = [];

  if (key.length === 1) {
    keyBuf.push(key.charCodeAt(0));
  } else if (key === 'Enter') {
    keyBuf.push(0x0d); // CR
  } else if (key === 'Tab') {
    keyBuf.push(0x09); // Tab
  } else if (key === 'Backspace') {
    keyBuf.push(0x08); // backspace
  } else if (EXTENDED_KEYS_MAP.has(key)) {
    keyBuf.push(0);
    keyBuf.push(EXTENDED_KEYS_MAP.get(key));
  }

  return keyBuf;
};

class OrbitSocket {
  constructor(path) {
    const handleMessage = this.handleMessage.bind(this);
    const handleClose = this.handleClose.bind(this);
    const ws = new WebSocket(path);
    ws.onmessage = handleMessage;
    ws.onclose = handleClose;

    this.ws = ws;
    this.queue = [];
    this.done = false;
    this.notify = undefined;
    this.onclose = null;
  };

  handleMessage(ev) {
    if (globalThis.DEBUG) return;
    const p = ev.data.arrayBuffer();
    this.queue.push(p);
    if (this.notify) {
      this.notify(false);
    }
  }

  handleClose(ev) {
    this.done = true;
    if (this.notify) {
      this.notify(true);
    }
    if (this.onclose) {
      this.onclose(ev);
    }
  }

  // this mess turns the message events into an async iterator
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (!this.done) {
          if (this.queue.length === 0) {
            return new Promise(res => {
              this.notify = (done) => {
                if (done) {
                  this.done = true;
                  res({done: true});
                } else {
                  res({
                    done: false,
                    value: this.queue.shift(),
                  });
                }
                this.notify = undefined;
              };
            });
          }
          return Promise.resolve({
            done: false,
            value: this.queue.shift(),
          });
        }
        return Promise.resolve({done: true});
      }
    };
  }

  writeKey(ev) {
    const keyBuf = resolveKeyboardEvent(ev);

    if (keyBuf.length > 0) {
      this.ws.send(new Uint8Array(keyBuf));
    }
  }
}

async function* getBuffers(os) {
  for await (const promise of os) {
    yield new Uint8Array(await promise);
  }
}

const getInt64 = (i32a) => {
  const ls = i32a[0] < 0 ? i32a[0] + 0x80000000 : i32a[0];
  const ms = i32a[1] * 0x100000000;
  return ls + ms;
}

async function* getMessages(bufgen, os) {
  let currentBuf = new Uint8Array(0);
  let pos = 0;
  let available = 0;
  let required = 1;
  let isReadingBody = false;
  let opcode;

  // handle the special case of print, which has a variable length body
  let hasBodyLength = false;
  for await (const newBuf of bufgen) {
    available += newBuf.length;
    const nextBuf = new Uint8Array(currentBuf.length + newBuf.length);
    nextBuf.set(currentBuf);
    nextBuf.set(newBuf, currentBuf.length);
    currentBuf = nextBuf;
    while (available >= required) {


      if (required < 1) {
        throw new TypeError();
      }
      if (isReadingBody) {
        if (opcode === 0x10 && !hasBodyLength) {
          // the memory alignment has to be 4 bytes for Int32Array, so we have to make a new buffer
          const sizeView = new Int32Array(currentBuf.slice(pos + 2, pos + (2 + 8)).buffer);
          const length = getInt64(sizeView);
          required += length;
          hasBodyLength = true;
        } else {
          const payload = currentBuf.slice(pos + 1, pos + required);
          pos += required;

          available -= required;
          // back to reading opcode
          isReadingBody = false;
          required = 1;
          // clean up currentBuf if it's too long
          if (pos >= 65536) {
            currentBuf = currentBuf.slice(pos);
            pos = 0;
          }

          yield {
            opcode,
            data: payload,
          };
        }
      } else {
        // switch opcode
        opcode = currentBuf[pos];
        isReadingBody = true;
        switch (opcode) {
          case 0x0:
            required = 0;
            break;
          case 0x10:
            // TODO
            required = 9;
            hasBodyLength = false;
            break;
          case 0x20:
            required = 2;
            break;
          case 0x21:
            required = 0;
            break;
          case 0x80:
            required = 4;
            break;
          case 0x81:
            required = 8;
            break;
          case 0x82:
            required = 4;
            break;
          case 0x83:
            required = 8;
            break;
          case 0x84:
          case 0x85:
            required = 0;
            break;
          case 0x90:
            required = 24;
            break;
          case 0x91:
            required = 16;
            break;
          case 0x92:
          case 0x93:
            required = 12;
            break;
          case 0x94:
            required = 16;
            break;
          default:
            os.ws.close();
            throw new TypeError(`Unsupported opcode ${opcode}`);
        }
        required++; // acount for the initial byte
      }
    }
  }
}

const $canvas = document.getElementById('canvas');
const $heading = document.getElementById('heading');

let bufgen;

const DEFAULT_PALETTE = [
  0x000000,
  0xaa0000,
  0x00aa00,
  0xaaaa00,
  0x0000aa,
  0xaa00aa,
  0x0055aa,
  0xaaaaaa,
  0x555555,
  0xff5555,
  0x55ff55,
  0xffff55,
  0x5555ff,
  0xff55ff,
  0x55ffff,
  0xffffff
].map(n => 0xff000000 | n); // set alpha to 255

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 480;
const CANVAS_CHAR_COLS = 80;
const CANVAS_CHAR_ROWS = 30;

class OrbitCanvas {
  // canvas data is in RGBA order so when viewed as an int32 it's ABGR from most significant to least significant
  static qbColorToRgba(qbColor) {
    const r = qbColor & 0x3f;
    const g = (qbColor >> 8) & 0x3f;
    const b = (qbColor >> 16) & 0x3f

    const rs = Math.round(r / 63 * 255);
    const gs = Math.round(g / 63 * 255);
    const bs = Math.round(b / 63 * 255);

    return rs | (gs << 8) | (bs << 16) | (0xff << 24);
  }

  constructor(canvas, font) {
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    this.canvas = canvas;
    this.font = font;
    const ctx = canvas.getContext('2d');
    this.ctx = ctx;
    const canvasData = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    this.canvasData = canvasData;
    this.dataBuf = new Int32Array(canvasData.data.buffer);
    // used to hold the "paletted" drawing. when a palette color changes, the already drawn
    // pixels of that palette color has to change to. this hold the drawing before
    // palette indexes have been converted to actual colors
    this.drawBuf = new Uint8Array(CANVAS_WIDTH * CANVAS_HEIGHT);
    this.palette = new Int32Array(DEFAULT_PALETTE); // this is stored in native canvas color format, not qb color format
    this.dirty = true;
    this.currentColor = 15;
    this.cursor = {x: 0, y: 0}; // the cursor here is 0 based

    this.refreshCanvas = this.refreshCanvas.bind(this);
    this.handleKeyboard = this.handleKeyboard.bind(this);

    document.addEventListener('keydown', this.handleKeyboard);
    requestAnimationFrame(this.refreshCanvas);

    this.inputChars = []; // using an array here for flexibility. all elements should be uint8
    this.isInputMode = false;
    this.inputCursor = {x: 0, y: 0};
  }

  refreshCanvas() {
    if (true) {
      this.drawToCanvas();
    }
    requestAnimationFrame(this.refreshCanvas);
  }

  startInput() {
    this.inputCursor.x = this.cursor.x;
    this.inputCursor.y = this.cursor.y;
    this.isInputMode = true;
    this.drawInputCursor(this.inputCursor);
  }

  drawInputCursor({x, y}) {
    const color = this.currentColor;
    const drawBuf = this.drawBuf;

    const baseX = x * 8;
    const baseY = y * 16;
    for (let row = 0; row < 16; row++) {
      const y = baseY + row;
      for (let col = 0; col < 8; col++) {
        const x = baseX + col;
        drawBuf[y * 640 + x] = row === 15 ? color : 0; // the cursor is a 1 pixel line on the last row
      }
    }
    this.dirty = true;
  }

  inputAddChar(char) {
    const cursor = this.inputCursor;
    if (char === 0x08) {
      // backspace
      if (this.inputChars.length > 0) {
        this.inputChars.pop();
        // blank out current position
        if (cursor.x < CANVAS_CHAR_COLS && cursor.y < CANVAS_CHAR_ROWS) {
          this.printChar(cursor, 0);
        }
        cursor.x--;
        if (cursor.x < 0) {
          cursor.x = 79;
          cursor.y--;
        }
      }
    } else if (char < 0x32 || char > 0x126) {
      // we pretend cr and lf and friends don't exist, it simplifies the logic
    } else {
      this.inputChars.push(char);

      if (cursor.x < CANVAS_CHAR_COLS && cursor.y < CANVAS_CHAR_ROWS) {
        this.printChar(cursor, char);
      }
      cursor.x++;
      if (cursor.x >= CANVAS_CHAR_COLS) {
        cursor.x = 0;
        cursor.y++;
      }
    }
    if (cursor.x < CANVAS_CHAR_COLS && cursor.y < CANVAS_CHAR_ROWS) {
      this.drawInputCursor(cursor);
    }
  }

  endInput() {
    this.isInputMode = false;
    // block out cursor
    this.printChar(this.inputCursor, 0);
  }

  handleKeyboard(ev) {
    // console.log(ev);
    ev.preventDefault();
    ev.stopPropagation();
    if (this.isInputMode) {
      const codes = resolveKeyboardEvent(ev);
      if (codes.length > 0) {
        this.inputAddChar(codes[0]);
      }
    }

    if (this.oninput) {
      this.oninput(ev)
    };
  }

  drawToCanvas() {
    const drawBuf = this.drawBuf;
    const dataBuf = this.dataBuf;
    const palette = this.palette;
    for (let i = 0; i < CANVAS_WIDTH * CANVAS_HEIGHT; i++) {
      dataBuf[i] = palette[drawBuf[i]];
    }
    this.ctx.putImageData(this.canvasData, 0, 0);
    this.dirty = false;
  }

  setPaletteItem(slot, color) {
    this.palette[slot] = OrbitCanvas.qbColorToRgba(color);
    this.dirty = true;
  }

  setCurrentColor(index) {
    this.currentColor = index;
  }

  setCursorLocation(x, y) {
    this.cursor.x = x;
    this.cursor.y = y;
  }

  clearAll() {
    this.drawBuf.fill(0);
    this.dirty = true;
  }

  printString(bytes, align) {
    const cursor = this.cursor;

    if (align) {
      throw new TypeError('Print alignment not yet implemented');
    }
    for (const c of bytes) {
      if (c === 0xa) {
        // LF
        cursor.x = 0;
        cursor.y++;
      } else if (c === 0xd) {
        // CR
        cursor.x = 0;
      } else {
        // auto wrap
        if (cursor.x >= CANVAS_CHAR_COLS) {
          cursor.x = 0;
          cursor.y++;
        }

        if (cursor.x < CANVAS_CHAR_COLS && cursor.y < CANVAS_CHAR_ROWS) {
          this.printChar(cursor, c);
        }
        cursor.x++;
      }
    }
  }

  printChar({x, y}, char) {
    const font = this.font;
    const color = this.currentColor;
    const drawBuf = this.drawBuf;

    const baseX = x * 8;
    const baseY = y * 16;
    for (let row = 0; row < 16; row++) {
      const fontRow = font[char * 16 + row];
      const y = baseY + row;
      for (let col = 0; col < 8; col++) {
        const x = baseX + col;
        drawBuf[y * CANVAS_WIDTH + x] = ((fontRow >> col) & 1) ? color : 0;
      }
    }
    this.dirty = true;
  }

  drawLine(x1, y1, x2, y2, color) {
    if (globalThis.DEBUG && color === 0) {
      debugger;
    }
    const drawBuf = this.drawBuf;
    let x = 0;
    let y = 0;
    let d = 0;
    let dx = 0;
    let dy = 0;
    let ax = 0;
    let ay = 0;
    let skip = 0;

    const xmin = 0;
    const xmax = CANVAS_WIDTH - 1;
    const ymin = 0;
    const ymax = CANVAS_HEIGHT - 1;

    if ((x1 < xmin) && (x2 < xmin)) {
      return;
    } else if ((x1 > xmax) && (x2 > xmax)) {
      return;
    } else if ((y1 < ymin) && (y2 < ymin)) {
      return;
    } else if ((y1 > ymax) && (y2 > ymax)) {
      return;
    }

    this.dirty = true;

    dx = x2 - x1;
    dy = y2 - y1;

    x2 = clamp(xmin, xmax, x2);
    y2 = clamp(ymin, ymax, y2);

    if (dx == 0) {
      if (y1 < ymin) {
        y1 = ymin;
      } else if (y1 > ymax) {
        y1 = ymax;
      }
      if (y1 > y2) {
        const tmp = y1;
        y1 = y2;
        y2 = tmp;
      }

      for (y = y1; y <= y2; y++) {
        drawBuf[y * CANVAS_WIDTH + x1] = color;
      }
    } else if (dy == 0) {
      if (x1 < xmin) {
        x1 = xmin;
      } else if (x1 > xmax) {
        x1 = xmax;
      }
      if (x1 > x2) {
        const tmp = y1;
        y1 = y2;
        y2 = tmp;
      }

      drawBuf.fill(color, y1 * CANVAS_WIDTH + x1, y1 * CANVAS_WIDTH + x2 + 1);
    } else {
      ax = ay = 1;
      if (dx < 0) {
        dx = -dx;
        ax = -1;
      }
      if (dy < 0) {
        dy = -dy;
        ay = -1;
      }

      d = (dx >= dy)? dy * 2 - dx : dy - dx * 2;
      dx *= 2;
      dy *= 2;

      x = clamp(xmin, xmax, x1);
      d += ax * (x - x1) * dy;

      y = clamp(ymin, ymax, y1);
      d -= ay * (y - y1) * dx;

      x2 = x2 + ax;
      y2 = y2 + ay;

      if (dx >= dy) {
        if (d >= dy) {
          skip = Math.trunc((d - dy) / dx) + 1;
          y += ay * skip;
          d -= skip * dx;
          if ((y < ymin) || (y > ymax)) {
            return;
          }
        } else if (d < (dy - dx)) {
          skip = Math.trunc(((dy - dx) - d) / dy) + 1;
          x += ax * skip;
          d += skip * dy;
          if ((x < xmin) || (x > xmax)) {
            return;
          }
        }

        while ((x != x2) && (y != y2)) {
          drawBuf[y * CANVAS_WIDTH + x] = color;
          if (d >= 0) {
            y += ay;
            d -= dx;
          }
          d += dy;
          x += ax;
        }
      } else {
        if (d < -dx) {
          skip = Math.trunc((-dx - d) / dy) + 1;
          x += ax * skip;
          d += skip * dy;
          if ((x < xmin) || (x > xmax))
            return;
        } else if (d > dy - dx) {
          skip = Math.trunc((d - (dy - dx)) / dx) + 1;
          y += ay * skip;
          d -= skip * dx;
          if ((y < ymin) || (y > ymax))
            return;
        }

        while ((y != y2) && (x != x2)) {
          drawBuf[y * CANVAS_WIDTH + x] = color;
          if (d <= 0) {
            x += ax;
            d += dy;
          }
          d -= dx;
          y += ay;
        }
      }
    }
  }

  _drawEllipseScanline(drawBuf, y, x1, x2, color) {
    if ((y >= 0) && (y < CANVAS_HEIGHT)) {
      if ((x1 >= 0) && (x1 < CANVAS_WIDTH)) {
        drawBuf[y * CANVAS_WIDTH + x1] = color;
      }
      if ((x2 >= 0) && (x2 < CANVAS_WIDTH)) {
        drawBuf[y * CANVAS_WIDTH + x2] = color;
      }
    }
  }

  _drawEllipse(x, y, radius, color) {
    const drawBuf = this.drawBuf;
    let d, x1, y1, x2, y2;
    let dxy, q, r, rx, ry;

    x1 = x - radius;
    x2 = x + radius;
    y1 = y2 = y;

    if (radius === 0) {
      drawBuf[y * CANVAS_WIDTH + x] = color;
      return;
    }

    this._drawEllipseScanline(drawBuf, y, x1, x2, color);

    q = radius * radius;
    dxy = q * 2;
    r = radius * q;
    rx = r * 2;
    ry = 0;
    d = radius;

    while (d > 0) {
      if (r > 0) {
        y1++;
        y2--;
        ry += dxy;
        r -= ry;
      }
      if (r <= 0) {
        d--;
        x1++;
        x2--;
        rx -= dxy;
        r += rx;
      }
      this._drawEllipseScanline(drawBuf, y1, x1, x2, color);
      this._drawEllipseScanline(drawBuf, y2, x1, x2, color);
    }
  }

  drawEllipse(x, y, radius, color) {
    if (radius <= 0.0) {
      return;
    }
    this._drawEllipse(Math.trunc(x), Math.trunc(y), radius, color);
    this.dirty = true;
  }

  setPointColor(x, y, color) {
    if (x >= 0 && x <= CANVAS_WIDTH && y >= 0 && y <= CANVAS_HEIGHT) {
      this.drawBuf[y * CANVAS_WIDTH + x] = color;
      this.dirty = true;
    }
  }
}

const getFont = () => fetch('/font.bin').then(res => res.arrayBuffer());

const clamp = (a, b, c) => c < a ? a : c > b ? b : c;

let oc;

const main = async () => {
  const font = new Uint8Array(await getFont());

  const os = new OrbitSocket('ws://localhost:8080/data');
  oc = new OrbitCanvas($canvas, font);
  bufgen = getBuffers(os);

  oc.oninput = os.writeKey.bind(os);

  os.onclose = (ev) => {
    alert('Server terminated the connection');
    $heading.textContent += ' [terminated]';
    $heading.classList.add('terminated');
  }

  for await (const msg of getMessages(bufgen, os)) {
    switch (msg.opcode) {
      case 0x0: {
        alert('Server sent end of program');
        return;
      }
      case 0x10: {
        const align = msg.data[0] !== 0;
        // we don't care about the length since we can assume the rest of msg.data is the string
        const bytes = msg.data.slice(1 + 8);
        oc.printString(bytes, align);
      } break;
      case 0x20: {
        oc.startInput();
      } break;
      case 0x21: {
        oc.endInput();
      } break;
      case 0x80: {
        const [mode] = new Int32Array(msg.data.buffer);
        if (mode !== 12) {
          throw new TypeError('Only screen mode 12 is supported');
        }
      } break;
      case 0x81: {
        const [slot, color] = new Int32Array(msg.data.buffer);
        if (!(slot >= 0 && slot <= 15)) {
          throw new TypeError('Out of bounds palette slot');
        }
        oc.setPaletteItem(slot, color);
      } break;
      case 0x82: {
        const [index] = new Int32Array(msg.data.buffer);
        if (!(index >= 0 && index <= 15)) {
          throw new TypeError('Out of bounds color');
        }
        oc.setCurrentColor(index);
      } break;
      case 0x83: {
        // note that row and col are 1 based. setCursorLocation uses x and y, which are 0 based
        const [row, col] = new Int32Array(msg.data.buffer);
        oc.setCursorLocation(clamp(1, CANVAS_CHAR_COLS, col) - 1, clamp(1, CANVAS_CHAR_ROWS, row) - 1);
      } break;
      case 0x84:
        oc.clearAll();
        break;
      case 0x85:
        alert('Beep');
        break;
      case 0x90: {
        const [x1, y1, x2, y2, color, boxfill] = new Int32Array(msg.data.buffer);
        if (!(color >= 0 && color <= 15)) {
          throw new TypeError('Out of bounds color');
        }
        oc.drawLine(x1, y1, x2, y2, color);
      } break;
      case 0x91: {
          const [x, y, radius, color] = new Int32Array(msg.data.buffer);
          oc.drawEllipse(x, y, radius, color);
      } break;
      case 0x92:
      case 0x93: {
        const [x, y, color] = new Int32Array(msg.data.buffer);
        if (!(color >= 0 && color <= 15)) {
          throw new TypeError('Out of bounds color');
        }
        oc.setPointColor(x, y, color);
      }
    }
  }
};

main();
