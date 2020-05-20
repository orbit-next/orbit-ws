# orbit-ws

orbit-ws is a graphics adapter for orbitc with a Node.js server and a
browser-based client, communicating via websockets.

orbit-ws would not have been possible without the open-source FreeBASIC
runtime library [https://github.com/freebasic/fbc], which powers the current
OrbitV programs. Sections of the FreeBASIC runtime library have been
ported to JavaScript for use in the orbit-ws client.

## Setup

This project is in an experimental stage, and to set the location of
the orbitc executable, its working directory, and the server port,
the source file at `src/orbitws.ts` modified.

To install dependencies, run `npm install`.

To run the server, first set the location of the orbitc executable,
its working directory, and server port as required `src/orbitws.ts`.
Run `npx tsc` to rebuild, then run `node build/orbitws.js`.

Navigate to http://localhost:8080/ (or your chosen port) to use orbit-ws.

## Limitations

- `orbitc` location, etc. are hardcoded.
- the flood fill graphics operation is not yet supported.
- some keyboard keys may not have been correctly mapped.
- text input is confined to the visible portion of the screen
  and does not scroll.
- many more (compared to the FreeBASIC graphics library)

The goal of orbit-ws is not to achieve parity with FreeBASIC.
Instead, we only aim to support the features used by the current
OrbitV programs.
